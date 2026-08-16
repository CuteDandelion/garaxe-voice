import { createHash } from 'node:crypto'
import { freemem } from 'node:os'
import { performance } from 'node:perf_hooks'
import { PGlite } from '@electric-sql/pglite'
import { createOnnxEmbeddingProvider } from '../server/semanticAnalysis'
import { buildPairAdjudicationMessages, clusterInterpretationPolicyFromEnv, validatePairAdjudications, type PairAdjudicationCandidate } from '../server/clusterInterpretation'
import { LlmProviderError, openCodeGoProviderFromEnv } from '../server/llmProvider'
import {
  SIMILARITY_FLOOR, canonicalEmbeddings, evidenceFingerprint, fingerprint, fullAnalysis,
  incrementalExperimentFixture, measured, pairCandidates, provenanceFingerprint,
  savedDecisionsFor, withEmbeddings, type CompletionProvider, type Group, type Review,
} from './incremental-clustering-experiment'
import { blinded100Input } from './voice-map-blinded-100-input'

const pairIdFor = (left: string, right: string) => [left, right].sort().join('~')
const cosine = (left: number[], right: number[]) => left.reduce((sum, value, index) => sum + value * right[index], 0)
const requestCount = (pairs: number) => Math.ceil(pairs / 5)

async function diagnosticDecisions(
  provider: CompletionProvider, model: string, maxTokens: number, candidates: PairAdjudicationCandidate[], startedAt: number,
) {
  const batches = Array.from({ length: Math.ceil(candidates.length / 5) }, (_, index) => candidates.slice(index * 5, index * 5 + 5))
  const queuedAt = performance.now()
  const decisions = new Map<string, boolean>()
  const perCall: Array<{ batchIndex: number; pairCount: number; queueWaitMs: number; modelDurationMs: number; status: 'succeeded' | 'failed' }> = []
  let callsCompleted = 0
  let modelDurationMs = 0
  let totalQueueWaitMs = 0
  let queueWaitMs = 0
  for (const [batchIndex, batch] of batches.entries()) {
    const wait = performance.now() - queuedAt
    queueWaitMs = Math.max(queueWaitMs, wait)
    totalQueueWaitMs += wait
    const modelStartedAt = performance.now()
    try {
      const completion = await provider.complete({
        model, messages: buildPairAdjudicationMessages(batch), maxTokens,
        temperature: 0, json: true, enableThinking: false,
      })
      const duration = performance.now() - modelStartedAt
      modelDurationMs += duration
      const validated = validatePairAdjudications(batch, JSON.parse(completion.content))
      for (const decision of validated) decisions.set(decision.pairId, decision.sameTopic)
      callsCompleted += 1
      perCall.push({ batchIndex, pairCount: batch.length, queueWaitMs: wait, modelDurationMs: duration, status: 'succeeded' })
    } catch (error) {
      const duration = performance.now() - modelStartedAt
      modelDurationMs += duration
      perCall.push({ batchIndex, pairCount: batch.length, queueWaitMs: wait, modelDurationMs: duration, status: 'failed' })
      const providerError = error instanceof LlmProviderError ? error : null
      return {
        ok: false as const, decisions, plannedCalls: batches.length, callsAttempted: perCall.length, callsCompleted,
        retries: 0, perCall, modelDurationMs, queueWaitMs, totalQueueWaitMs,
        firstProviderCallMs: Math.max(0, queuedAt - startedAt),
        terminal: {
          state: 'failed' as const,
          code: providerError?.code || (error instanceof Error ? error.name : 'UNKNOWN'),
          status: providerError?.status ?? null,
          retryAfterMs: providerError?.retryAfterMs ?? null,
        },
      }
    }
  }
  return {
    ok: true as const, decisions, plannedCalls: batches.length, callsAttempted: perCall.length, callsCompleted,
    retries: 0, perCall, modelDurationMs, queueWaitMs, totalQueueWaitMs,
    firstProviderCallMs: Math.max(0, queuedAt - startedAt),
    terminal: { state: 'succeeded' as const, code: null, status: null, retryAfterMs: null },
  }
}

async function createLedger() {
  const database = new PGlite()
  await database.exec(`
    CREATE TABLE review_embeddings (workspace_id TEXT NOT NULL, review_id TEXT NOT NULL, vector JSONB NOT NULL, PRIMARY KEY (workspace_id, review_id));
    CREATE TABLE candidate_pairs (
      workspace_id TEXT NOT NULL, pair_id TEXT NOT NULL, left_review_id TEXT NOT NULL, right_review_id TEXT NOT NULL,
      similarity DOUBLE PRECISION NOT NULL, PRIMARY KEY (workspace_id, pair_id)
    );
    CREATE TABLE pair_decisions (
      workspace_id TEXT NOT NULL, pair_id TEXT NOT NULL, same_topic BOOLEAN NOT NULL,
      adjudication_count INTEGER NOT NULL CHECK (adjudication_count = 1), PRIMARY KEY (workspace_id, pair_id),
      FOREIGN KEY (workspace_id, pair_id) REFERENCES candidate_pairs(workspace_id, pair_id)
    );
  `)
  return database
}

async function appendReviews(
  database: PGlite, existing: Review[], appended: Review[], oracle: Map<string, boolean>, assertResources?: () => void,
  workspaceId = 'default',
) {
  let comparisons = 0
  let insertedDecisions = 0
  await database.transaction(async (transaction) => {
    for (const review of appended) {
      assertResources?.()
      await transaction.query('INSERT INTO review_embeddings (workspace_id, review_id, vector) VALUES ($1, $2, $3)',
        [workspaceId, review.id, JSON.stringify(review.vector)])
    }
    for (let index = 0; index < appended.length; index += 1) {
      const right = appended[index]
      for (const left of [...existing, ...appended.slice(0, index)]) {
        assertResources?.()
        comparisons += 1
        const similarity = cosine(left.vector, right.vector)
        if (similarity < SIMILARITY_FLOOR) continue
        const pairId = pairIdFor(left.id, right.id)
        const inserted = await transaction.query<{ pairId: string }>(
          `INSERT INTO candidate_pairs (workspace_id, pair_id, left_review_id, right_review_id, similarity)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING pair_id AS "pairId"`,
          [workspaceId, pairId, ...[left.id, right.id].sort(), similarity],
        )
        if (!inserted.rows.length) continue
        insertedDecisions += 1
        await transaction.query(
          'INSERT INTO pair_decisions (workspace_id, pair_id, same_topic, adjudication_count) VALUES ($1,$2,$3,1)',
          [workspaceId, pairId, oracle.get(pairId) ?? false],
        )
      }
    }
  })
  return { comparisons, insertedDecisions }
}

async function ledgerState(database: PGlite, validReviewIds: Set<string>, workspaceId = 'default') {
  const decisions = await database.query<{ pairId: string; sameTopic: boolean; adjudicationCount: number; leftId: string; rightId: string }>(
    `SELECT c.pair_id AS "pairId", d.same_topic AS "sameTopic", d.adjudication_count AS "adjudicationCount",
      c.left_review_id AS "leftId", c.right_review_id AS "rightId"
     FROM candidate_pairs c JOIN pair_decisions d USING (workspace_id, pair_id)
     WHERE c.workspace_id = $1 ORDER BY c.pair_id`, [workspaceId],
  )
  const map = new Map(decisions.rows.map((row) => [row.pairId, row.sameTopic]))
  return {
    map,
    count: decisions.rows.length,
    digest: createHash('sha256').update(decisions.rows.map((row) => `${row.pairId}:${row.sameTopic}`).join('\n')).digest('hex'),
    maxAdjudicationsPerPair: Math.max(0, ...decisions.rows.map((row) => row.adjudicationCount)),
    representativeProxyPairCount: decisions.rows.filter((row) => !validReviewIds.has(row.leftId) || !validReviewIds.has(row.rightId)).length,
  }
}

const equivalence = (fullGroups: Group[], incrementalGroups: Group[], fullLedger: string, incrementalLedger: string) => {
  const topic = fingerprint(fullGroups) === fingerprint(incrementalGroups)
  const evidence = evidenceFingerprint(fullGroups) === evidenceFingerprint(incrementalGroups)
  const provenance = provenanceFingerprint(fullGroups) === provenanceFingerprint(incrementalGroups)
  const candidateLedger = fullLedger === incrementalLedger
  return { exact: topic && evidence && provenance && candidateLedger, topic, evidence, provenance, candidateLedger }
}

export async function runCanonicalIncrementalLedgerExperiment(partitions: number[][] = [[20], [10, 10], [5, 5, 10]]) {
  const data = incrementalExperimentFixture()
  const raw = [...data.initial, ...data.appended]
  const provider = await createOnnxEmbeddingProvider()
  const cache = new Map<string, number[]>()
  const reviews = withEmbeddings(raw, await canonicalEmbeddings(provider, cache, raw.map((review) => review.text)))
  const initial = reviews.slice(0, 10)
  const appended = reviews.slice(10)
  const validReviewIds = new Set(reviews.map((review) => review.id))
  const oracle = savedDecisionsFor(reviews)

  const fullDatabase = await createLedger()
  const full = await measured(async (sampleRss) => {
    const work = await appendReviews(fullDatabase, [], reviews, oracle)
    const ledger = await ledgerState(fullDatabase, validReviewIds)
    const analysis = await fullAnalysis(reviews, ledger.map)
    sampleRss()
    return { work, ledger, groups: analysis.groups }
  })

  const partitionResults = []
  for (const sizes of partitions) {
    if (sizes.some((size) => !Number.isInteger(size) || size <= 0) || sizes.reduce((sum, size) => sum + size, 0) !== appended.length) {
      throw new Error('Append partitions must contain all 20 appended reviews exactly once.')
    }
    const database = await createLedger()
    try {
      const initialWork = await appendReviews(database, [], initial, oracle)
      const initialLedger = await ledgerState(database, validReviewIds)
      const run = await measured(async (sampleRss) => {
        const existing = [...initial]
        let offset = 0
        let comparisons = 0
        let unseenAdjudications = 0
        let partitionBoundRequestEquivalents = 0
        for (const size of sizes) {
          const chunk = appended.slice(offset, offset + size)
          const work = await appendReviews(database, existing, chunk, oracle)
          comparisons += work.comparisons
          unseenAdjudications += work.insertedDecisions
          partitionBoundRequestEquivalents += requestCount(work.insertedDecisions)
          existing.push(...chunk)
          offset += size
          sampleRss()
        }
        const ledger = await ledgerState(database, validReviewIds)
        const analysis = await fullAnalysis(reviews, ledger.map)
        return { comparisons, unseenAdjudications, partitionBoundRequestEquivalents, ledger, groups: analysis.groups }
      })
      partitionResults.push({
        sizes,
        initialLedgerCount: initialLedger.count,
        candidateLedgerCount: run.value.ledger.count,
        unseenAdjudications: run.value.unseenAdjudications,
        coalescedRequestEquivalents: requestCount(run.value.unseenAdjudications),
        partitionBoundRequestEquivalents: run.value.partitionBoundRequestEquivalents,
        deltaComparisons: run.value.comparisons,
        totalComparisons: initialWork.comparisons + run.value.comparisons,
        maxAdjudicationsPerPair: run.value.ledger.maxAdjudicationsPerPair,
        representativeProxyPairCount: run.value.ledger.representativeProxyPairCount,
        wallMs: run.wallMs, cpuMs: run.cpuMs, peakRssDeltaBytes: run.peakRssDeltaBytes,
        equivalence: equivalence(full.value.groups, run.value.groups, full.value.ledger.digest, run.value.ledger.digest),
      })
    } finally {
      await database.close()
    }
  }
  await fullDatabase.close()

  return {
    dataset: { initialReviews: 10, appendedReviews: 20, totalReviews: 30 },
    embedding: { id: provider.id, version: provider.version, dimensions: provider.dimensions, cacheEntries: cache.size },
    providerCalls: 0,
    full: {
      candidateLedgerCount: full.value.ledger.count,
      adjudicatedPairs: full.value.work.insertedDecisions,
      requestEquivalents: requestCount(full.value.work.insertedDecisions),
      comparisons: full.value.work.comparisons,
      wallMs: full.wallMs, cpuMs: full.cpuMs, peakRssDeltaBytes: full.peakRssDeltaBytes,
    },
    incrementalBaseline: {
      initialLedgerCount: partitionResults[0]?.initialLedgerCount || 0,
      unseenAdjudications: partitionResults[0]?.unseenAdjudications || 0,
      coalescedRequestEquivalents: partitionResults[0]?.coalescedRequestEquivalents || 0,
    },
    partitions: partitionResults,
  }
}

class ScaleResourceGuardError extends Error {}

const scaleRawFixture = (totalReviews: 50 | 100) => {
  const data = incrementalExperimentFixture()
  const extra = blinded100Input.slice(0, totalReviews - 30).map((review, index): Review => ({
    ...review,
    topic: `scale-topic-${String(index + 1).padStart(2, '0')}`,
    source: 'blinded_public_style',
    date: null,
    entity: null,
    vector: [],
  }))
  return [...data.initial, ...data.appended, ...extra]
}

export async function runCanonicalLedgerScaleExperiment(options: {
  totalReviews?: 50 | 100
  maxReviews?: number
  maxPairComparisons?: number
  maxRssDeltaBytes?: number
} = {}) {
  const totalReviews = options.totalReviews ?? 50
  const initialReviews = totalReviews === 100 ? 50 : 10
  const dataset = { initialReviews, appendedReviews: totalReviews - initialReviews, totalReviews }
  const requiredPairComparisons = totalReviews * (totalReviews - 1) / 2
  const maxReviews = options.maxReviews ?? totalReviews
  const maxPairComparisons = options.maxPairComparisons ?? requiredPairComparisons
  let baselineRssBytes = process.memoryUsage().rss
  let freeMemoryBytes = freemem()
  let maxRssDeltaBytes = options.maxRssDeltaBytes ?? 512 * 1024 * 1024
  const guard = {
    checkedBeforeAllocation: true as const,
    maxReviews,
    actualReviews: dataset.totalReviews,
    maxPairComparisons,
    requiredPairComparisons,
    baselineRssBytes,
    freeMemoryBytes,
    maxRssDeltaBytes,
  }
  if (dataset.totalReviews > maxReviews || guard.requiredPairComparisons > maxPairComparisons) return {
    aborted: true as const,
    abortReason: 'RESOURCE_GUARD' as const,
    dataset,
    providerCalls: 0 as const,
    guard,
    allocationsStarted: false as const,
    ledgerEngineInstances: 0 as const,
    cleanup: { ledgerEngine: 'not_created' as const, fullProjection: 'not_created' as const, incrementalProjection: 'not_created' as const },
  }

  let observedPeakRssDeltaBytes = 0
  const assertResources = () => {
    observedPeakRssDeltaBytes = Math.max(observedPeakRssDeltaBytes, process.memoryUsage().rss - baselineRssBytes)
    if (observedPeakRssDeltaBytes > maxRssDeltaBytes) throw new ScaleResourceGuardError('SCALE_RSS_GUARD_EXCEEDED')
  }
  const cleanup: {
    ledgerEngine: 'not_created' | 'open' | 'closed'
    fullProjection: 'not_created' | 'open' | 'closed'
    incrementalProjection: 'not_created' | 'open' | 'closed'
  } = {
    ledgerEngine: 'not_created', fullProjection: 'not_created', incrementalProjection: 'not_created',
  }

  const raw = scaleRawFixture(totalReviews)
  try {
    const embeddingProvider = await createOnnxEmbeddingProvider()
    const database = await createLedger()
    cleanup.ledgerEngine = 'open'
    try {
      baselineRssBytes = process.memoryUsage().rss
      freeMemoryBytes = freemem()
      maxRssDeltaBytes = options.maxRssDeltaBytes ?? 512 * 1024 * 1024
      guard.baselineRssBytes = baselineRssBytes
      guard.freeMemoryBytes = freeMemoryBytes
      guard.maxRssDeltaBytes = maxRssDeltaBytes
      const cache = new Map<string, number[]>()
      const vectors: number[][] = []
      for (const review of raw) {
        vectors.push(...await canonicalEmbeddings(embeddingProvider, cache, [review.text]))
        assertResources()
      }
      const reviews = withEmbeddings(raw, vectors)
      const initial = reviews.slice(0, dataset.initialReviews)
      const appended = reviews.slice(dataset.initialReviews)
      const oracle = savedDecisionsFor(reviews)
      const validReviewIds = new Set(reviews.map((review) => review.id))

      const project = async (incremental: boolean) => measured(async (sampleRss) => {
        assertResources()
        const key = incremental ? 'incrementalProjection' : 'fullProjection'
        cleanup[key] = 'open'
        try {
          if (incremental) {
            const initialWork = await appendReviews(database, [], initial, oracle, assertResources)
            const initialLedger = await ledgerState(database, validReviewIds)
            const appendWork = await appendReviews(database, initial, appended, oracle, assertResources)
            const ledger = await ledgerState(database, validReviewIds)
            const analysis = await fullAnalysis(reviews, ledger.map)
            sampleRss()
            assertResources()
            return { initialWork, initialLedger, appendWork, ledger, groups: analysis.groups }
          }
          const work = await appendReviews(database, [], reviews, oracle, assertResources)
          const ledger = await ledgerState(database, validReviewIds)
          const analysis = await fullAnalysis(reviews, ledger.map)
          sampleRss()
          assertResources()
          return { work, ledger, groups: analysis.groups }
        } finally {
          cleanup[key] = 'closed'
        }
      })

      const full = await project(false)
      await database.exec('DELETE FROM pair_decisions; DELETE FROM candidate_pairs; DELETE FROM review_embeddings;')
      assertResources()
      const incremental = await project(true)
      const exact = equivalence(full.value.groups, incremental.value.groups, full.value.ledger.digest, incremental.value.ledger.digest)
      observedPeakRssDeltaBytes = Math.max(
        observedPeakRssDeltaBytes, full.peakRssDeltaBytes, incremental.peakRssDeltaBytes,
      )
      return {
        aborted: !exact.exact,
        abortReason: exact.exact ? null : 'EQUIVALENCE_FAILED' as const,
        dataset,
        providerCalls: 0 as const,
        allocationsStarted: true as const,
        ledgerEngineInstances: 1 as const,
        embedding: { id: embeddingProvider.id, version: embeddingProvider.version, dimensions: embeddingProvider.dimensions, cacheEntries: cache.size },
        guard: { ...guard, passed: observedPeakRssDeltaBytes <= maxRssDeltaBytes },
        observedPeakRssDeltaBytes,
        full: {
          candidateLedgerCount: full.value.ledger.count,
          adjudicatedPairs: full.value.work.insertedDecisions,
          comparisons: full.value.work.comparisons,
          requestEquivalents: requestCount(full.value.work.insertedDecisions),
          wallMs: full.wallMs, cpuMs: full.cpuMs, peakRssDeltaBytes: full.peakRssDeltaBytes,
        },
        incremental: {
          initialLedgerCount: incremental.value.initialLedger.count,
          candidateLedgerCount: incremental.value.ledger.count,
          unseenAdjudications: incremental.value.appendWork.insertedDecisions,
          deltaComparisons: incremental.value.appendWork.comparisons,
          totalComparisons: incremental.value.initialWork.comparisons + incremental.value.appendWork.comparisons,
          requestEquivalents: requestCount(incremental.value.appendWork.insertedDecisions),
          maxAdjudicationsPerPair: incremental.value.ledger.maxAdjudicationsPerPair,
          representativeProxyPairCount: incremental.value.ledger.representativeProxyPairCount,
          wallMs: incremental.wallMs, cpuMs: incremental.cpuMs, peakRssDeltaBytes: incremental.peakRssDeltaBytes,
        },
        equivalence: exact,
        cleanup,
      }
    } finally {
      await database.close()
      cleanup.ledgerEngine = 'closed'
    }
  } catch (error) {
    if (!(error instanceof ScaleResourceGuardError)) throw error
    return {
      aborted: true as const,
      abortReason: 'RESOURCE_GUARD' as const,
      dataset,
      providerCalls: 0 as const,
      allocationsStarted: true as const,
      ledgerEngineInstances: 1 as const,
      guard: { ...guard, passed: false as const },
      observedPeakRssDeltaBytes,
      cleanup,
    }
  }
}

class FairnessGuardError extends Error {}

const distribution = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right)
  return {
    min: sorted[0] || 0,
    max: sorted.at(-1) || 0,
    p50: sorted[Math.floor((sorted.length - 1) * .5)] || 0,
    p95: sorted[Math.ceil(sorted.length * .95) - 1] || 0,
  }
}

export async function runProviderFreeFairnessExperiment(options: {
  maxWorkspaces?: number
  maxTotalPairComparisons?: number
  maxQueueWaitMs?: number
  maxRssDeltaBytes?: number
} = {}) {
  const workspaces = 3
  const reviewsPerWorkspace = 50
  const totalPairComparisonBudget = workspaces * 1_225 * 2
  const maxWorkspaces = options.maxWorkspaces ?? workspaces
  const maxTotalPairComparisons = options.maxTotalPairComparisons ?? totalPairComparisonBudget
  const maxQueueWaitMs = options.maxQueueWaitMs ?? 30_000
  const maxRssDeltaBytes = options.maxRssDeltaBytes ?? 512 * 1024 * 1024
  if (maxWorkspaces < workspaces || maxTotalPairComparisons < totalPairComparisonBudget) return {
    aborted: true as const,
    abortReason: 'RESOURCE_GUARD' as const,
    workspaces,
    providerCalls: 0 as const,
    allocationsStarted: false as const,
    ledgerEngineInstances: 0 as const,
    cleanup: { ledgerEngine: 'not_created' as const, openJobs: 0 as const },
  }

  const cleanup: { ledgerEngine: 'not_created' | 'open' | 'closed'; openJobs: number } = {
    ledgerEngine: 'not_created', openJobs: 0,
  }
  let baselineRssBytes = 0
  let observedPeakRssDeltaBytes = 0
  const assertResources = () => {
    observedPeakRssDeltaBytes = Math.max(observedPeakRssDeltaBytes, process.memoryUsage().rss - baselineRssBytes)
    if (observedPeakRssDeltaBytes > maxRssDeltaBytes) throw new FairnessGuardError('FAIRNESS_RSS_GUARD_EXCEEDED')
  }

  const embeddingProvider = await createOnnxEmbeddingProvider()
  const database = await createLedger()
  cleanup.ledgerEngine = 'open'
  try {
    baselineRssBytes = process.memoryUsage().rss
    const cache = new Map<string, number[]>()
    const raw = scaleRawFixture(50)
    const vectors: number[][] = []
    for (const review of raw) {
      vectors.push(...await canonicalEmbeddings(embeddingProvider, cache, [review.text]))
      assertResources()
    }
    const baseReviews = withEmbeddings(raw, vectors)
    const workspaceIds = ['workspace-1', 'workspace-2', 'workspace-3']
    const reviewsFor = (workspaceId: string) => baseReviews.map((review) => ({
      ...review,
      id: `${workspaceId}:${review.id}`,
      source: `${workspaceId}:${review.source}`,
      sourceUrl: `${review.sourceUrl}?workspace=${workspaceId}`,
    }))
    const clearWorkspace = (workspaceId: string) => database.transaction(async (transaction) => {
      await transaction.query('DELETE FROM pair_decisions WHERE workspace_id = $1', [workspaceId])
      await transaction.query('DELETE FROM candidate_pairs WHERE workspace_id = $1', [workspaceId])
      await transaction.query('DELETE FROM review_embeddings WHERE workspace_id = $1', [workspaceId])
    })
    const runJob = async (databaseWorkspaceId: string, workspaceId: string) => {
      const reviews = reviewsFor(workspaceId)
      const validReviewIds = new Set(reviews.map((review) => review.id))
      const oracle = savedDecisionsFor(reviews)
      const run = await measured(async (sampleRss) => {
        const work = await appendReviews(database, [], reviews, oracle, assertResources, databaseWorkspaceId)
        const ledger = await ledgerState(database, validReviewIds, databaseWorkspaceId)
        const analysis = await fullAnalysis(reviews, ledger.map)
        const foreign = await database.query<{ count: number }>(
          `SELECT COUNT(*)::INTEGER AS count FROM candidate_pairs
           WHERE workspace_id = $1 AND (left_review_id NOT LIKE $2 OR right_review_id NOT LIKE $2)`,
          [databaseWorkspaceId, `${workspaceId}:%`],
        )
        sampleRss()
        assertResources()
        return { work, ledger, groups: analysis.groups, foreignWorkspaceRows: foreign.rows[0]?.count || 0 }
      })
      return {
        candidateLedgerCount: run.value.ledger.count,
        comparisons: run.value.work.comparisons,
        fingerprints: {
          topic: fingerprint(run.value.groups),
          evidence: evidenceFingerprint(run.value.groups),
          provenance: provenanceFingerprint(run.value.groups),
          candidateLedger: run.value.ledger.digest,
        },
        foreignWorkspaceRows: run.value.foreignWorkspaceRows,
        wallMs: run.wallMs,
        cpuMs: run.cpuMs,
      }
    }

    const serial = new Map<string, Awaited<ReturnType<typeof runJob>>>()
    const total = await measured(async (sampleRss) => {
      for (const workspaceId of workspaceIds) {
        const databaseWorkspaceId = `serial:${workspaceId}`
        serial.set(workspaceId, await runJob(databaseWorkspaceId, workspaceId))
        await clearWorkspace(databaseWorkspaceId)
        sampleRss()
        assertResources()
      }

      const enqueueOrder: string[] = []
      const startOrder: string[] = []
      const finishOrder: string[] = []
      const pending: Array<{
        workspaceId: string
        queuedAt: number
        task: () => Promise<unknown>
        resolve: (value: unknown) => void
        reject: (error: unknown) => void
      }> = []
      let active = 0
      let peakActive = 0
      const drain = () => {
        if (active >= 1 || !pending.length) return
        const item = pending.shift()!
        active += 1
        peakActive = Math.max(peakActive, active)
        startOrder.push(item.workspaceId)
        void item.task().then(item.resolve, item.reject).finally(() => {
          active -= 1
          drain()
        })
      }
      const schedule = <T>(workspaceId: string, task: (queuedAt: number) => Promise<T>) => {
        enqueueOrder.push(workspaceId)
        const queuedAt = performance.now()
        return { queuedAt, promise: new Promise<T>((resolve, reject) => {
          pending.push({ workspaceId, queuedAt, task: () => task(queuedAt), resolve: resolve as (value: unknown) => void, reject })
          drain()
        }) }
      }

      const scheduled = workspaceIds.map((workspaceId) => {
        const progress = [{ value: 0, stage: 'queued' as const }]
        const scheduledJob = schedule(workspaceId, async (queuedAt) => {
          cleanup.openJobs += 1
          const startedAt = performance.now()
          const queueWaitMs = startedAt - queuedAt
          if (queueWaitMs > maxQueueWaitMs) throw new FairnessGuardError('FAIRNESS_QUEUE_WAIT_GUARD_EXCEEDED')
          progress.push({ value: 20, stage: 'ledger' as const })
          try {
            const concurrent = await runJob(`concurrent:${workspaceId}`, workspaceId)
            progress.push({ value: 70, stage: 'projection' as const })
            const reference = serial.get(workspaceId)!
            const exact = {
              topic: reference.fingerprints.topic === concurrent.fingerprints.topic,
              evidence: reference.fingerprints.evidence === concurrent.fingerprints.evidence,
              provenance: reference.fingerprints.provenance === concurrent.fingerprints.provenance,
              candidateLedger: reference.fingerprints.candidateLedger === concurrent.fingerprints.candidateLedger,
            }
            progress.push({ value: 100, stage: 'complete' as const })
            finishOrder.push(workspaceId)
            return {
              workspaceId,
              queueWaitMs,
              completionMs: performance.now() - queuedAt,
              starved: false,
              foreignWorkspaceRows: concurrent.foreignWorkspaceRows,
              progress,
              serial: reference,
              concurrent,
              equivalence: { exact: Object.values(exact).every(Boolean), ...exact },
            }
          } finally {
            cleanup.openJobs -= 1
          }
        })
        return scheduledJob.promise
      })
      const jobs = await Promise.all(scheduled)
      sampleRss()
      assertResources()
      return { jobs, scheduler: { maxActive: 1, peakActive, enqueueOrder, startOrder, finishOrder } }
    })
    const exact = total.value.jobs.every((job) => job.equivalence.exact && job.foreignWorkspaceRows === 0)
    const queueWaitMs = distribution(total.value.jobs.map((job) => job.queueWaitMs))
    const completionMs = distribution(total.value.jobs.map((job) => job.completionMs))
    return {
      aborted: !exact,
      abortReason: exact ? null : 'EQUIVALENCE_FAILED' as const,
      workspaces,
      reviewsPerWorkspace,
      providerCalls: 0 as const,
      allocationsStarted: true as const,
      ledgerEngineInstances: 1 as const,
      embedding: { id: embeddingProvider.id, version: embeddingProvider.version, dimensions: embeddingProvider.dimensions, cacheEntries: cache.size },
      scheduler: total.value.scheduler,
      guard: {
        passed: exact && queueWaitMs.max <= maxQueueWaitMs && observedPeakRssDeltaBytes <= maxRssDeltaBytes,
        maxWorkspaces,
        maxQueueWaitMs,
        maxRssDeltaBytes,
        totalPairComparisonBudget,
      },
      metrics: { queueWaitMs, completionMs },
      resources: { wallMs: total.wallMs, cpuMs: total.cpuMs, peakRssDeltaBytes: total.peakRssDeltaBytes },
      observedPeakRssDeltaBytes,
      jobs: total.value.jobs,
      cleanup,
    }
  } catch (error) {
    if (!(error instanceof FairnessGuardError)) throw error
    return {
      aborted: true as const,
      abortReason: 'RESOURCE_GUARD' as const,
      workspaces,
      reviewsPerWorkspace,
      providerCalls: 0 as const,
      allocationsStarted: true as const,
      ledgerEngineInstances: 1 as const,
      guard: { passed: false as const, maxWorkspaces, maxQueueWaitMs, maxRssDeltaBytes, totalPairComparisonBudget },
      observedPeakRssDeltaBytes,
      cleanup,
    }
  } finally {
    await database.close()
    cleanup.ledgerEngine = 'closed'
  }
}

export async function runLiveCanonicalLedgerExperiment(options: {
  completionProvider?: CompletionProvider
  model?: string
  maxTokens?: number
} = {}) {
  const policy = clusterInterpretationPolicyFromEnv()
  const completionProvider = options.completionProvider || openCodeGoProviderFromEnv()
  const model = options.model || policy?.model
  const maxTokens = options.maxTokens || policy?.maxOutputTokens
  if (!completionProvider || !model || !maxTokens) throw new Error('The isolated live canonical-ledger benchmark is not configured.')

  const data = incrementalExperimentFixture()
  const raw = [...data.initial, ...data.appended]
  const embeddingProvider = await createOnnxEmbeddingProvider()
  const cache = new Map<string, number[]>()
  const reviews = withEmbeddings(raw, await canonicalEmbeddings(embeddingProvider, cache, raw.map((review) => review.text)))
  const initial = reviews.slice(0, 10)
  const appended = reviews.slice(10)
  const oracle = savedDecisionsFor(reviews)
  const initialPairIds: string[] = []
  const fullPairIds: string[] = []
  await fullAnalysis(initial, oracle, initialPairIds)
  await fullAnalysis(reviews, oracle, fullPairIds)
  const initialIds = new Set(initialPairIds)
  const unseenPairIds = [...new Set(fullPairIds)].filter((pairId) => !initialIds.has(pairId)).sort()
  if (initialIds.size !== 6 || unseenPairIds.length !== 59) throw new Error('LIVE_CANONICAL_LEDGER_PLAN_DRIFT')

  const providerStarted = performance.now()
  const provider = await measured(() => diagnosticDecisions(
    completionProvider, model, maxTokens, pairCandidates(reviews, unseenPairIds), providerStarted,
  ))
  const providerResult = {
    calls: provider.value.callsCompleted,
    plannedCalls: provider.value.plannedCalls,
    callsAttempted: provider.value.callsAttempted,
    callsCompleted: provider.value.callsCompleted,
    retries: provider.value.retries,
    queueWaitMs: provider.value.queueWaitMs,
    totalQueueWaitMs: provider.value.totalQueueWaitMs,
    modelDurationMs: provider.value.modelDurationMs,
    wallMs: provider.wallMs,
    cpuMs: provider.cpuMs,
    peakRssDeltaBytes: provider.peakRssDeltaBytes,
    perCall: provider.value.perCall,
    terminal: provider.value.terminal,
  }
  const cleanup: { fullProjection: 'not_created' | 'open' | 'closed' | 'close_failed'; incrementalProjection: 'not_created' | 'open' | 'closed' | 'close_failed' } = {
    fullProjection: 'not_created', incrementalProjection: 'not_created',
  }
  if (!provider.value.ok) return {
    aborted: true,
    abortReason: 'PROVIDER_FAILED',
    dataset: { initialReviews: 10, appendedReviews: 20, totalReviews: 30 },
    model,
    decisions: { initialSaved: initialIds.size, newlyAdjudicated: provider.value.decisions.size, total: initialIds.size + provider.value.decisions.size },
    provider: providerResult,
    cleanup,
    equivalence: { evaluated: false as const },
  }
  const decisions = new Map<string, boolean>()
  for (const pairId of initialIds) decisions.set(pairId, oracle.get(pairId) ?? false)
  for (const pairId of unseenPairIds) {
    const decision = provider.value.decisions.get(pairId)
    if (decision === undefined) throw new Error(`LIVE_CANONICAL_LEDGER_DECISION_MISSING:${pairId}`)
    decisions.set(pairId, decision)
  }

  const validReviewIds = new Set(reviews.map((review) => review.id))
  const project = async (incremental: boolean) => measured(async (sampleRss) => {
    const database = await createLedger()
    const cleanupKey = incremental ? 'incrementalProjection' : 'fullProjection'
    cleanup[cleanupKey] = 'open'
    try {
      if (incremental) {
        await appendReviews(database, [], initial, decisions)
        await appendReviews(database, initial, appended, decisions)
      } else {
        await appendReviews(database, [], reviews, decisions)
      }
      const ledger = await ledgerState(database, validReviewIds)
      const analysis = await fullAnalysis(reviews, ledger.map)
      sampleRss()
      return { ledger, groups: analysis.groups }
    } finally {
      try {
        await database.close()
        cleanup[cleanupKey] = 'closed'
      } catch (error) {
        cleanup[cleanupKey] = 'close_failed'
        throw error
      }
    }
  })
  const full = await project(false)
  const incremental = await project(true)
  const exact = equivalence(full.value.groups, incremental.value.groups, full.value.ledger.digest, incremental.value.ledger.digest)
  const path = (measurement: typeof full) => ({
    candidateLedgerCount: measurement.value.ledger.count,
    firstFullyCoveredEvidenceMs: provider.wallMs + measurement.wallMs,
    completionMs: provider.wallMs + measurement.wallMs,
    cpuMs: provider.cpuMs + measurement.cpuMs,
    peakRssDeltaBytes: Math.max(provider.peakRssDeltaBytes, measurement.peakRssDeltaBytes),
  })
  return {
    aborted: !exact.exact,
    abortReason: exact.exact ? null : 'EQUIVALENCE_FAILED',
    dataset: { initialReviews: 10, appendedReviews: 20, totalReviews: 30 },
    model,
    decisions: { initialSaved: initialIds.size, newlyAdjudicated: unseenPairIds.length, total: decisions.size },
    provider: providerResult,
    cleanup,
    full: path(full),
    incremental: path(incremental),
    equivalence: { evaluated: true as const, ...exact },
  }
}
