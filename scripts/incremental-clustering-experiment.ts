import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { PGlite } from '@electric-sql/pglite'
import { incrementalFeedbackBatches } from './voice-map-incremental-20-input'
import { independentHoldoutInput } from './voice-map-independent-10-input'
import { createOnnxEmbeddingProvider, type EmbeddingProvider } from '../server/semanticAnalysis'
import {
  buildPairAdjudicationMessages, clusterInterpretationPolicyFromEnv, validatePairAdjudications,
  type PairAdjudicationCandidate,
} from '../server/clusterInterpretation'
import { openCodeGoProviderFromEnv, type CompleteRequest, type LlmCompletion } from '../server/llmProvider'

export type Review = {
  id: string
  topic: string
  text: string
  source: string
  date: string | null
  entity: string | null
  sourceUrl: string
  vector: number[]
}
export type Group = { topicId: string; reviews: Review[]; representative: number[] }

type Measurement = {
  embeddedReviews: number
  candidateCount: number
  adjudicationDecisions: number
  providerCalls: 0
  modelRequestEquivalents: { categorization: number; pairAdjudication: number; total: number }
  wallMs: number
  cpuMs: number
  peakRssDeltaBytes: number
}

export const SIMILARITY_FLOOR = .84
const pairIdFor = (left: string, right: string) => [left, right].sort().join('~')
const normalizeEmbeddingContent = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('und')
export const canonicalEmbeddingKey = (modelVersion: string, text: string) => createHash('sha256')
  .update(`${modelVersion}\0${normalizeEmbeddingContent(text)}`).digest('hex')

export async function canonicalEmbeddings(provider: EmbeddingProvider, cache: Map<string, number[]>, texts: string[]) {
  const vectors: number[][] = []
  for (const text of texts) {
    const normalized = normalizeEmbeddingContent(text)
    const key = canonicalEmbeddingKey(provider.version, text)
    let vector = cache.get(key)
    if (!vector) {
      ;[vector] = await provider.embed([normalized])
      if (!vector || vector.length !== provider.dimensions) throw new Error(`Invalid canonical embedding for ${key}.`)
      cache.set(key, [...vector])
    }
    vectors.push([...vector])
  }
  return vectors
}

const normalize = (vector: number[]) => {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0)) || 1
  return vector.map((value) => value / magnitude)
}

const cosine = (left: number[], right: number[]) => left.reduce((total, value, index) => total + value * right[index], 0)

export const incrementalExperimentFixture = () => {
  const initialRaw = incrementalFeedbackBatches[0].comments.map((comment) => ({
    ...comment, source: incrementalFeedbackBatches[0].source, topic: comment.entity,
  }))
  const appendedRaw = [
    ...incrementalFeedbackBatches[1].comments.map((comment) => ({
      ...comment, source: incrementalFeedbackBatches[1].source, topic: comment.entity,
    })),
    ...independentHoldoutInput.map((comment, index) => ({
      ...comment, source: 'independent_public', topic: `independent-topic-${Math.floor(index / 2) + 1}`,
      date: null, entity: null,
    })),
  ]
  const topics = [...new Set([...initialRaw, ...appendedRaw].map((review) => review.topic))].sort()
  const review = (input: typeof initialRaw[number] | typeof appendedRaw[number]): Review => ({
    ...input,
    vector: topics.map((topic) => topic === input.topic ? 1 : 0),
  })
  return { initial: initialRaw.map(review), appended: appendedRaw.map(review) }
}

export const mean = (vectors: number[][]) => normalize(vectors[0].map((_, dimension) =>
  vectors.reduce((total, vector) => total + vector[dimension], 0) / vectors.length))

export const fingerprint = (groups: Group[]) => createHash('sha256').update(JSON.stringify(groups
  .map((group) => group.reviews.map((review) => review.id).sort())
  .sort((left, right) => left[0].localeCompare(right[0])))).digest('hex')

const membershipKeys = (groups: Group[]) => groups.map((group) => group.reviews.map((review) => review.id).sort().join('|')).sort()

export const evidenceFingerprint = (groups: Group[]) => createHash('sha256').update(JSON.stringify(groups
  .flatMap((group) => group.reviews.map(({ id, text }) => ({ id, text })))
  .sort((left, right) => left.id.localeCompare(right.id)))).digest('hex')

export const provenanceFingerprint = (groups: Group[]) => createHash('sha256').update(JSON.stringify(groups
  .flatMap((group) => group.reviews.map(({ id, source, date, entity, sourceUrl }) => ({ id, source, date, entity, sourceUrl })))
  .sort((left, right) => left.id.localeCompare(right.id)))).digest('hex')

export const requestEquivalents = (embeddedReviews: number, adjudicationDecisions: number) => {
  const categorization = Math.ceil(embeddedReviews / 5)
  const pairAdjudication = Math.ceil(adjudicationDecisions / 5)
  return { categorization, pairAdjudication, total: categorization + pairAdjudication }
}

export const measured = async <T>(operation: (sampleRss: () => void) => Promise<T> | T) => {
  const startedAt = performance.now()
  const cpuStartedAt = process.cpuUsage()
  const rssStartedAt = process.memoryUsage().rss
  let peakRss = rssStartedAt
  const sampleRss = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }
  const sampler = setInterval(sampleRss, 5)
  sampler.unref()
  let value: T
  try {
    value = await operation(sampleRss)
  } finally {
    clearInterval(sampler)
    sampleRss()
  }
  const cpu = process.cpuUsage(cpuStartedAt)
  return {
    value,
    wallMs: performance.now() - startedAt,
    cpuMs: (cpu.user + cpu.system) / 1_000,
    peakRssDeltaBytes: Math.max(0, peakRss - rssStartedAt),
  }
}

export const fullAnalysis = async (all: Review[], savedDecisions?: Map<string, boolean>, eligiblePairIds?: string[]) => {
  let candidateCount = 0
  let adjudicationDecisions = 0
  const parent = all.map((_, index) => index)
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]))
  const result = await measured((sampleRss) => {
    for (let left = 0; left < all.length; left += 1) for (let right = left + 1; right < all.length; right += 1) {
      candidateCount += 1
      if (cosine(all[left].vector, all[right].vector) < SIMILARITY_FLOOR) continue
      adjudicationDecisions += 1
      const pairId = pairIdFor(all[left].id, all[right].id)
      eligiblePairIds?.push(pairId)
      if ((savedDecisions?.get(pairId) ?? all[left].topic === all[right].topic)) parent[root(right)] = root(left)
      sampleRss()
    }
    const members = new Map<number, Review[]>()
    all.forEach((review, index) => members.set(root(index), [...(members.get(root(index)) || []), review]))
    return [...members.values()].map((groupReviews) => ({
      topicId: groupReviews.map((review) => review.id).sort()[0],
      reviews: groupReviews,
      representative: mean(groupReviews.map((review) => review.vector)),
    }))
  })
  return {
    groups: result.value,
    measurement: {
      embeddedReviews: all.length, candidateCount, adjudicationDecisions, providerCalls: 0,
      modelRequestEquivalents: requestEquivalents(all.length, adjudicationDecisions),
      wallMs: result.wallMs, cpuMs: result.cpuMs, peakRssDeltaBytes: result.peakRssDeltaBytes,
    },
  }
}

const createExperimentDatabase = async () => {
  const database = new PGlite()
  await database.exec(`
    CREATE TABLE experiment_embeddings (review_id TEXT PRIMARY KEY, run_scope TEXT NOT NULL, vector JSONB NOT NULL);
    CREATE TABLE experiment_topic_representatives (topic_id TEXT PRIMARY KEY, run_scope TEXT NOT NULL, vector JSONB NOT NULL, member_count INTEGER NOT NULL);
    CREATE TABLE experiment_lineage (review_id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, parent_topic_id TEXT, source_run TEXT NOT NULL, provenance JSONB NOT NULL, evidence_hash TEXT NOT NULL);
    CREATE TABLE experiment_pair_decisions (pair_id TEXT PRIMARY KEY, same_topic BOOLEAN NOT NULL);
  `)
  return database
}

const persistGroups = async (database: PGlite, groups: Group[], sourceRun: string) => {
  await database.transaction(async (transaction) => {
    for (const group of groups) {
      await transaction.query('INSERT INTO experiment_topic_representatives VALUES ($1, $2, $3, $4)',
        [group.topicId, sourceRun, JSON.stringify(group.representative), group.reviews.length])
      for (const [index, review] of group.reviews.entries()) {
        await transaction.query('INSERT INTO experiment_embeddings VALUES ($1, $2, $3)', [review.id, sourceRun, JSON.stringify(review.vector)])
        await transaction.query('INSERT INTO experiment_lineage VALUES ($1, $2, $3, $4, $5, $6)', [
          review.id, group.topicId, index ? group.reviews[0].id : null, sourceRun,
          JSON.stringify({ source: review.source, date: review.date, entity: review.entity, sourceUrl: review.sourceUrl }),
          createHash('sha256').update(review.text).digest('hex'),
        ])
      }
    }
  })
}

const persistInitial = (database: PGlite, groups: Group[]) => persistGroups(database, groups, 'initial-10')

export const savedDecisionsFor = (reviews: Review[]) => new Map(reviews.flatMap((left, leftIndex) =>
  reviews.slice(leftIndex + 1).map((right) => [pairIdFor(left.id, right.id), left.topic === right.topic] as const)))

const persistSavedDecisions = (database: PGlite, decisions: Map<string, boolean>) => database.transaction(async (transaction) => {
  for (const [pairId, sameTopic] of decisions) await transaction.query(
    'INSERT INTO experiment_pair_decisions VALUES ($1, $2)', [pairId, sameTopic])
})

const loadSavedDecisions = async (database: PGlite) => new Map((await database.query<{ pair_id: string; same_topic: boolean }>(
  'SELECT pair_id, same_topic FROM experiment_pair_decisions')).rows.map((row) => [row.pair_id, row.same_topic]))

const loadPersistedGroups = async (database: PGlite, corpus: Review[]) => {
  const byId = new Map(corpus.map((review) => [review.id, review]))
  const rows = (await database.query<{ review_id: string; topic_id: string; vector: number[] }>(`
    SELECT l.review_id, l.topic_id, e.vector
    FROM experiment_lineage l JOIN experiment_embeddings e ON e.review_id = l.review_id
    ORDER BY l.review_id`)).rows
  const grouped = new Map<string, Review[]>()
  for (const row of rows) {
    const review = byId.get(row.review_id)
    if (!review) throw new Error(`Missing experiment review ${row.review_id}.`)
    grouped.set(row.topic_id, [...(grouped.get(row.topic_id) || []), { ...review, vector: row.vector }])
  }
  const representatives = new Map((await database.query<{ topic_id: string; vector: number[] }>(
    'SELECT topic_id, vector FROM experiment_topic_representatives')).rows.map((row) => [row.topic_id, row.vector]))
  return [...grouped].map(([topicId, reviews]) => ({ topicId, reviews, representative: representatives.get(topicId) || mean(reviews.map((review) => review.vector)) }))
}

const incrementalAnalysis = async (
  database: PGlite, initialGroups: Group[], appended: Review[], savedDecisions?: Map<string, boolean>, eligiblePairIds?: string[],
) => {
  const groups = initialGroups.map((group) => ({ ...group, reviews: [...group.reviews], representative: [...group.representative] }))
  let candidateCount = 0
  let adjudicationDecisions = 0
  const result = await measured(async (sampleRss) => {
    const lineage: Array<{ review: Review; topicId: string; parentTopicId: string | null }> = []
    for (const review of appended) {
      let assigned: Group | undefined
      for (const group of groups) {
        candidateCount += 1
        if (cosine(review.vector, group.representative) < SIMILARITY_FLOOR) continue
        adjudicationDecisions += 1
        const pairId = pairIdFor(review.id, group.reviews[0].id)
        eligiblePairIds?.push(pairId)
        if ((savedDecisions?.get(pairId) ?? review.topic === group.reviews[0].topic)) { assigned = group; break }
      }
      if (!assigned) {
        assigned = { topicId: review.id, reviews: [], representative: review.vector }
        groups.push(assigned)
      }
      const parentTopicId = assigned.reviews[0]?.id || null
      assigned.reviews.push(review)
      assigned.representative = mean(assigned.reviews.map((member) => member.vector))
      lineage.push({ review, topicId: assigned.topicId, parentTopicId })
      sampleRss()
    }
    await database.transaction(async (transaction) => {
      for (const { review, topicId, parentTopicId } of lineage) {
        await transaction.query('INSERT INTO experiment_embeddings VALUES ($1, $2, $3)', [review.id, 'append-20', JSON.stringify(review.vector)])
        await transaction.query('INSERT INTO experiment_lineage VALUES ($1, $2, $3, $4, $5, $6)', [
          review.id, topicId, parentTopicId, 'append-20',
          JSON.stringify({ source: review.source, date: review.date, entity: review.entity, sourceUrl: review.sourceUrl }),
          createHash('sha256').update(review.text).digest('hex'),
        ])
      }
      for (const group of groups) await transaction.query(`INSERT INTO experiment_topic_representatives VALUES ($1, $2, $3, $4)
          ON CONFLICT (topic_id) DO UPDATE SET run_scope = EXCLUDED.run_scope, vector = EXCLUDED.vector, member_count = EXCLUDED.member_count`,
        [group.topicId, 'append-20', JSON.stringify(group.representative), group.reviews.length])
    })
    return groups
  })
  return {
    groups: result.value,
    measurement: {
      embeddedReviews: appended.length, candidateCount, adjudicationDecisions, providerCalls: 0,
      modelRequestEquivalents: requestEquivalents(appended.length, adjudicationDecisions),
      wallMs: result.wallMs, cpuMs: result.cpuMs, peakRssDeltaBytes: result.peakRssDeltaBytes,
    },
  }
}

const counts = async (database: PGlite) => {
  const count = async (table: string) => Number((await database.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`)).rows[0].count)
  return {
    embeddings: await count('experiment_embeddings'),
    representatives: await count('experiment_topic_representatives'),
    lineage: await count('experiment_lineage'),
  }
}

export const estimateQuadraticResources = (segments: number, bytesPerSimilarity = 8) => ({
  segments,
  pairCount: segments * (segments - 1) / 2,
  matrixBytes: segments * segments * bytesPerSimilarity,
})

export async function runIncrementalClusteringExperiment() {
  const data = incrementalExperimentFixture()
  const all = [...data.initial, ...data.appended]
  const initial = await fullAnalysis(data.initial)
  const full = await fullAnalysis(all)
  const database = await createExperimentDatabase()
  try {
    await persistInitial(database, initial.groups)
    const incremental = await incrementalAnalysis(database, initial.groups, data.appended)
    const fullFingerprint = fingerprint(full.groups)
    const incrementalFingerprint = fingerprint(incremental.groups)
    const fullEvidenceFingerprint = evidenceFingerprint(full.groups)
    const incrementalEvidenceFingerprint = evidenceFingerprint(incremental.groups)
    const fullProvenanceFingerprint = provenanceFingerprint(full.groups)
    const incrementalProvenanceFingerprint = provenanceFingerprint(incremental.groups)
    const evidence = incremental.groups.flatMap((group) => group.reviews.map((review) => review.id))
    return {
      dataset: {
        initialReviews: data.initial.length, appendedReviews: data.appended.length, totalReviews: all.length,
        sourceCount: new Set(all.map((review) => review.source)).size,
        missingDateCount: all.filter((review) => !review.date).length,
      },
      full: full.measurement as Measurement,
      incremental: incremental.measurement as Measurement,
      persistence: await counts(database),
      persistenceTransactions: { initial: 1, incremental: 1, total: 2 },
      equivalence: {
        exact: fullFingerprint === incrementalFingerprint
          && fullEvidenceFingerprint === incrementalEvidenceFingerprint
          && fullProvenanceFingerprint === incrementalProvenanceFingerprint
          && new Set(evidence).size === all.length,
        evidenceCount: evidence.length,
        uniqueEvidenceCount: new Set(evidence).size,
        fullFingerprint,
        incrementalFingerprint,
        fullEvidenceFingerprint,
        incrementalEvidenceFingerprint,
        fullProvenanceFingerprint,
        incrementalProvenanceFingerprint,
      },
      quadraticRiskAt10k: estimateQuadraticResources(10_000),
    }
  } finally {
    await database.close()
  }
}

export const withEmbeddings = (reviews: Review[], vectors: number[][]) => reviews.map((review, index) => ({ ...review, vector: vectors[index] }))

export async function runPinnedDifferentialReplay(provider?: EmbeddingProvider) {
  const embeddingProvider = provider || await createOnnxEmbeddingProvider()
  const data = incrementalExperimentFixture()
  const all = [...data.initial, ...data.appended]
  const savedDecisions = savedDecisionsFor(all)
  const fullDatabase = await createExperimentDatabase()
  const incrementalDatabase = await createExperimentDatabase()
  try {
    await persistSavedDecisions(fullDatabase, savedDecisions)
    await persistSavedDecisions(incrementalDatabase, savedDecisions)
    const loadedFullDecisions = await loadSavedDecisions(fullDatabase)
    const loadedIncrementalDecisions = await loadSavedDecisions(incrementalDatabase)

    const canonicalCache = new Map<string, number[]>()
    let embeddingInferenceCalls = 0
    const countedProvider: EmbeddingProvider = {
      ...embeddingProvider,
      embed: async (texts) => {
        embeddingInferenceCalls += 1
        return embeddingProvider.embed(texts)
      },
    }
    const canonicalization = await measured(async (sampleRss) => {
      await canonicalEmbeddings(countedProvider, canonicalCache, all.map((review) => review.text))
      sampleRss()
    })
    const initialVectors = await canonicalEmbeddings(countedProvider, canonicalCache, data.initial.map((review) => review.text))
    const initial = await fullAnalysis(withEmbeddings(data.initial, initialVectors), loadedIncrementalDecisions)
    await persistInitial(incrementalDatabase, initial.groups)

    const fullRun = await measured(async (sampleRss) => {
      const vectors = await canonicalEmbeddings(countedProvider, canonicalCache, all.map((review) => review.text))
      const analysis = await fullAnalysis(withEmbeddings(all, vectors), loadedFullDecisions)
      await persistGroups(fullDatabase, analysis.groups, 'full-30')
      sampleRss()
      return analysis
    })
    const incrementalRun = await measured(async (sampleRss) => {
      const vectors = await canonicalEmbeddings(countedProvider, canonicalCache, data.appended.map((review) => review.text))
      const persistedGroups = await loadPersistedGroups(incrementalDatabase, data.initial)
      const analysis = await incrementalAnalysis(
        incrementalDatabase, persistedGroups, withEmbeddings(data.appended, vectors), loadedIncrementalDecisions)
      sampleRss()
      return analysis
    })

    const fullGroups = fullRun.value.groups
    const incrementalGroups = incrementalRun.value.groups
    const fullTopicFingerprint = fingerprint(fullGroups)
    const incrementalTopicFingerprint = fingerprint(incrementalGroups)
    const fullEvidenceFingerprint = evidenceFingerprint(fullGroups)
    const incrementalEvidenceFingerprint = evidenceFingerprint(incrementalGroups)
    const fullProvenanceFingerprint = provenanceFingerprint(fullGroups)
    const incrementalProvenanceFingerprint = provenanceFingerprint(incrementalGroups)
    const fullMemberships = membershipKeys(fullGroups)
    const incrementalMemberships = membershipKeys(incrementalGroups)
    const membershipDifference = {
      onlyFull: fullMemberships.filter((membership) => !incrementalMemberships.includes(membership)),
      onlyIncremental: incrementalMemberships.filter((membership) => !fullMemberships.includes(membership)),
    }
    const differingPairs = new Set([...membershipDifference.onlyFull, ...membershipDifference.onlyIncremental].flatMap((membership) => {
      const ids = membership.split('|')
      return ids.flatMap((left, index) => ids.slice(index + 1).map((right) => pairIdFor(left, right)))
    }))
    const fullVectors = new Map(fullGroups.flatMap((group) => group.reviews.map((review) => [review.id, review.vector] as const)))
    const incrementalVectors = new Map(incrementalGroups.flatMap((group) => group.reviews.map((review) => [review.id, review.vector] as const)))
    return {
      dataset: { initialReviews: 10, appendedReviews: 20, totalReviews: 30 },
      embedding: { id: embeddingProvider.id, version: embeddingProvider.version, dimensions: embeddingProvider.dimensions },
      canonicalization: {
        cacheEntries: canonicalCache.size,
        embeddingInferenceCalls,
        wallMs: canonicalization.wallMs,
        cpuMs: canonicalization.cpuMs,
        peakRssDeltaBytes: canonicalization.peakRssDeltaBytes,
      },
      savedAdjudicationOutputs: savedDecisions.size,
      full: {
        ...fullRun.value.measurement, wallMs: fullRun.wallMs, cpuMs: fullRun.cpuMs,
        peakRssDeltaBytes: fullRun.peakRssDeltaBytes, persistenceTransactions: 1,
      },
      incremental: {
        ...incrementalRun.value.measurement, wallMs: incrementalRun.wallMs, cpuMs: incrementalRun.cpuMs,
        peakRssDeltaBytes: incrementalRun.peakRssDeltaBytes, persistenceTransactions: 1,
      },
      persistence: { full: await counts(fullDatabase), incremental: await counts(incrementalDatabase) },
      equivalence: {
        exact: fullTopicFingerprint === incrementalTopicFingerprint
          && fullEvidenceFingerprint === incrementalEvidenceFingerprint
          && fullProvenanceFingerprint === incrementalProvenanceFingerprint,
        topic: fullTopicFingerprint === incrementalTopicFingerprint,
        evidence: fullEvidenceFingerprint === incrementalEvidenceFingerprint,
        provenance: fullProvenanceFingerprint === incrementalProvenanceFingerprint,
        fullTopicFingerprint, incrementalTopicFingerprint,
        fullEvidenceFingerprint, incrementalEvidenceFingerprint,
        fullProvenanceFingerprint, incrementalProvenanceFingerprint,
        membershipDifference,
        differingPairSimilarities: [...differingPairs].map((pairId) => {
          const [left, right] = pairId.split('~')
          return {
            pairId,
            full: Number(cosine(fullVectors.get(left) || [], fullVectors.get(right) || []).toFixed(6)),
            incremental: Number(cosine(incrementalVectors.get(left) || [], incrementalVectors.get(right) || []).toFixed(6)),
          }
        }),
      },
    }
  } finally {
    await fullDatabase.close()
    await incrementalDatabase.close()
  }
}

export type CompletionProvider = { complete(input: CompleteRequest): Promise<LlmCompletion> }

export const pairCandidates = (reviews: Review[], pairIds: string[]): PairAdjudicationCandidate[] => {
  const byId = new Map(reviews.map((review) => [review.id, review]))
  return [...new Set(pairIds)].map((pairId) => {
    const [leftId, rightId] = pairId.split('~')
    const left = byId.get(leftId)
    const right = byId.get(rightId)
    if (!left || !right) throw new Error(`Missing live benchmark pair ${pairId}.`)
    const side = (review: Review) => ({
      reviewId: review.id, primaryCategory: 'desired_outcome' as const,
      topic: review.topic, label: review.topic, quoteText: review.text,
    })
    return { pairId, left: side(left), right: side(right) }
  })
}

export async function liveDecisions(
  provider: CompletionProvider, model: string, maxTokens: number, candidates: PairAdjudicationCandidate[], startedAt: number,
) {
  const batches = Array.from({ length: Math.ceil(candidates.length / 5) }, (_, index) => candidates.slice(index * 5, index * 5 + 5))
  const queuedAt = performance.now()
  const decisions = new Map<string, boolean>()
  let modelDurationMs = 0
  let totalQueueWaitMs = 0
  let queueWaitMs = 0
  for (const batch of batches) {
    const wait = performance.now() - queuedAt
    queueWaitMs = Math.max(queueWaitMs, wait)
    totalQueueWaitMs += wait
    const modelStartedAt = performance.now()
    const completion = await provider.complete({
      model, messages: buildPairAdjudicationMessages(batch), maxTokens,
      temperature: 0, json: true, enableThinking: false,
    })
    modelDurationMs += performance.now() - modelStartedAt
    const validated = validatePairAdjudications(batch, JSON.parse(completion.content))
    for (const decision of validated) decisions.set(decision.pairId, decision.sameTopic)
  }
  return {
    decisions, providerCalls: batches.length, retries: 0, modelDurationMs,
    queueWaitMs, totalQueueWaitMs, firstProviderCallMs: batches.length ? Math.max(0, queuedAt - startedAt) : 0,
  }
}

export async function runLiveProviderDifferentialReplay(options: {
  embeddingProvider?: EmbeddingProvider
  completionProvider?: CompletionProvider
  model?: string
  maxTokens?: number
} = {}) {
  const embeddingProvider = options.embeddingProvider || await createOnnxEmbeddingProvider()
  const policy = clusterInterpretationPolicyFromEnv()
  const completionProvider = options.completionProvider || openCodeGoProviderFromEnv()
  const model = options.model || policy?.model
  const maxTokens = options.maxTokens || policy?.maxOutputTokens
  if (!completionProvider || !model || !maxTokens) throw new Error('The isolated live-provider benchmark is not configured.')

  const data = incrementalExperimentFixture()
  const all = [...data.initial, ...data.appended]
  const canonicalCache = new Map<string, number[]>()
  const canonicalization = await measured(async (sampleRss) => {
    await canonicalEmbeddings(embeddingProvider, canonicalCache, all.map((review) => review.text))
    sampleRss()
  })
  const initialReviews = withEmbeddings(data.initial, await canonicalEmbeddings(embeddingProvider, canonicalCache, data.initial.map((review) => review.text)))
  const allReviews = withEmbeddings(all, await canonicalEmbeddings(embeddingProvider, canonicalCache, all.map((review) => review.text)))
  const appendedReviews = withEmbeddings(data.appended, await canonicalEmbeddings(embeddingProvider, canonicalCache, data.appended.map((review) => review.text)))
  const savedDecisions = savedDecisionsFor(allReviews)
  const initial = await fullAnalysis(initialReviews, savedDecisions)

  const fullPairIds: string[] = []
  await fullAnalysis(allReviews, savedDecisions, fullPairIds)
  const planningDatabase = await createExperimentDatabase()
  const incrementalPairIds: string[] = []
  try {
    await incrementalAnalysis(planningDatabase, initial.groups, appendedReviews, savedDecisions, incrementalPairIds)
  } finally {
    await planningDatabase.close()
  }

  const runFull = async () => {
    const database = await createExperimentDatabase()
    const startedAt = Date.now()
    const started = performance.now()
    try {
      const result = await measured(async (sampleRss) => {
        const provider = await liveDecisions(completionProvider, model, maxTokens, pairCandidates(allReviews, fullPairIds), started)
        const used: string[] = []
        const analysis = await fullAnalysis(allReviews, provider.decisions, used)
        if (used.some((pairId) => !provider.decisions.has(pairId))) throw new Error('LIVE_FULL_CANDIDATE_DRIFT')
        const evidence = analysis.groups.flatMap((group) => group.reviews.map((review) => review.id))
        if (evidence.length !== all.length || new Set(evidence).size !== all.length) throw new Error('LIVE_FULL_EVIDENCE_INCOMPLETE')
        const firstFullyCoveredEvidenceMs = performance.now() - started
        await persistGroups(database, analysis.groups, 'live-full-30')
        sampleRss()
        return { analysis, provider, firstFullyCoveredEvidenceMs }
      })
      return {
        groups: result.value.analysis.groups, startedAt, completedAt: Date.now(),
        candidateCount: result.value.analysis.measurement.candidateCount,
        adjudicationDecisions: result.value.analysis.measurement.adjudicationDecisions,
        persistence: await counts(database), persistenceTransactions: 1,
        ...result.value.provider, firstFullyCoveredEvidenceMs: result.value.firstFullyCoveredEvidenceMs,
        completionMs: result.wallMs, cpuMs: result.cpuMs, peakRssDeltaBytes: result.peakRssDeltaBytes,
      }
    } finally { await database.close() }
  }

  const runIncremental = async () => {
    const database = await createExperimentDatabase()
    await persistInitial(database, initial.groups)
    const startedAt = Date.now()
    const started = performance.now()
    try {
      const result = await measured(async (sampleRss) => {
        const provider = await liveDecisions(completionProvider, model, maxTokens, pairCandidates(allReviews, incrementalPairIds), started)
        const used: string[] = []
        const persistedGroups = await loadPersistedGroups(database, initialReviews)
        const analysis = await incrementalAnalysis(database, persistedGroups, appendedReviews, provider.decisions, used)
        if (used.some((pairId) => !provider.decisions.has(pairId))) throw new Error('LIVE_INCREMENTAL_CANDIDATE_DRIFT')
        const evidence = analysis.groups.flatMap((group) => group.reviews.map((review) => review.id))
        if (evidence.length !== all.length || new Set(evidence).size !== all.length) throw new Error('LIVE_INCREMENTAL_EVIDENCE_INCOMPLETE')
        sampleRss()
        return { analysis, provider, firstFullyCoveredEvidenceMs: performance.now() - started }
      })
      return {
        groups: result.value.analysis.groups, startedAt, completedAt: Date.now(),
        candidateCount: result.value.analysis.measurement.candidateCount,
        adjudicationDecisions: result.value.analysis.measurement.adjudicationDecisions,
        persistence: await counts(database), persistenceTransactions: 1,
        ...result.value.provider, firstFullyCoveredEvidenceMs: result.value.firstFullyCoveredEvidenceMs,
        completionMs: result.wallMs, cpuMs: result.cpuMs, peakRssDeltaBytes: result.peakRssDeltaBytes,
      }
    } finally { await database.close() }
  }

  const full = await runFull()
  const incremental = await runIncremental()
  const fullTopicFingerprint = fingerprint(full.groups)
  const incrementalTopicFingerprint = fingerprint(incremental.groups)
  const fullEvidenceFingerprint = evidenceFingerprint(full.groups)
  const incrementalEvidenceFingerprint = evidenceFingerprint(incremental.groups)
  const fullProvenanceFingerprint = provenanceFingerprint(full.groups)
  const incrementalProvenanceFingerprint = provenanceFingerprint(incremental.groups)
  const equivalence = {
    topic: fullTopicFingerprint === incrementalTopicFingerprint,
    evidence: fullEvidenceFingerprint === incrementalEvidenceFingerprint,
    provenance: fullProvenanceFingerprint === incrementalProvenanceFingerprint,
    fullTopicFingerprint, incrementalTopicFingerprint,
    fullEvidenceFingerprint, incrementalEvidenceFingerprint,
    fullProvenanceFingerprint, incrementalProvenanceFingerprint,
  }
  const exact = equivalence.topic && equivalence.evidence && equivalence.provenance
  return {
    aborted: !exact, abortReason: exact ? null : 'EQUIVALENCE_FAILED',
    dataset: { initialReviews: 10, appendedReviews: 20, totalReviews: 30 },
    embedding: { id: embeddingProvider.id, version: embeddingProvider.version, dimensions: embeddingProvider.dimensions },
    canonicalization: { cacheEntries: canonicalCache.size, wallMs: canonicalization.wallMs, cpuMs: canonicalization.cpuMs, peakRssDeltaBytes: canonicalization.peakRssDeltaBytes },
    full: { ...full, groups: undefined }, incremental: { ...incremental, groups: undefined },
    equivalence: { exact, ...equivalence },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  console.log(JSON.stringify(await runIncrementalClusteringExperiment(), null, 2))
}
