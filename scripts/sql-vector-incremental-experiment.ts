import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { Pool, type PoolClient } from 'pg'
import { createOnnxEmbeddingProvider } from '../server/semanticAnalysis'
import {
  SIMILARITY_FLOOR, canonicalEmbeddingKey, canonicalEmbeddings, evidenceFingerprint, fingerprint, fullAnalysis,
  incrementalExperimentFixture, liveDecisions, mean, measured, pairCandidates, provenanceFingerprint,
  requestEquivalents, savedDecisionsFor, withEmbeddings, type CompletionProvider, type Group, type Review,
} from './incremental-clustering-experiment'
import { clusterInterpretationPolicyFromEnv } from '../server/clusterInterpretation'
import { openCodeGoProviderFromEnv } from '../server/llmProvider'

const schema = 'sql_vector_experiment'
const pairIdFor = (left: string, right: string) => [left, right].sort().join('~')
const vectorLiteral = (vector: number[]) => `[${vector.join(',')}]`
const percentile = (values: number[], ratio: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)] || 0

async function setup(client: PoolClient) {
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions`)
  await client.query(`
    CREATE TABLE ${schema}.review_embeddings (
      project_id uuid NOT NULL, model_version text NOT NULL, review_id text NOT NULL,
      content_hash text NOT NULL, topic_id text NOT NULL, source text NOT NULL,
      provenance jsonb NOT NULL, embedding extensions.vector(384) NOT NULL,
      PRIMARY KEY (project_id, model_version, review_id)
    );
    CREATE TABLE ${schema}.topic_representatives (
      project_id uuid NOT NULL, model_version text NOT NULL, topic_id text NOT NULL,
      anchor_review_id text NOT NULL, member_count integer NOT NULL,
      embedding extensions.vector(384) NOT NULL,
      PRIMARY KEY (project_id, model_version, topic_id)
    );
    CREATE INDEX topic_representatives_hnsw ON ${schema}.topic_representatives
      USING hnsw (embedding extensions.vector_cosine_ops);
  `)
  // The 30-row fixture is below PostgreSQL's natural ANN crossover, so force the real HNSW path for this scale-validity experiment.
  await client.query("SET enable_seqscan = off; SET enable_sort = off; SET hnsw.iterative_scan = 'strict_order'")
}

async function persistReview(client: PoolClient, projectId: string, modelVersion: string, topicId: string, review: Review) {
  await client.query(`INSERT INTO ${schema}.review_embeddings
    (project_id,model_version,review_id,content_hash,topic_id,source,provenance,embedding)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::extensions.vector)`, [
    projectId, modelVersion, review.id, canonicalEmbeddingKey(modelVersion, review.text), topicId, review.source,
    JSON.stringify({ date: review.date, entity: review.entity, sourceUrl: review.sourceUrl }), vectorLiteral(review.vector),
  ])
}

async function persistRepresentative(client: PoolClient, projectId: string, modelVersion: string, group: Group) {
  await client.query(`INSERT INTO ${schema}.topic_representatives
    (project_id,model_version,topic_id,anchor_review_id,member_count,embedding)
    VALUES ($1,$2,$3,$4,$5,$6::extensions.vector)
    ON CONFLICT (project_id,model_version,topic_id) DO UPDATE
    SET anchor_review_id=EXCLUDED.anchor_review_id,member_count=EXCLUDED.member_count,embedding=EXCLUDED.embedding`, [
    projectId, modelVersion, group.topicId, group.reviews[0].id, group.reviews.length, vectorLiteral(group.representative),
  ])
}

async function persistGroups(client: PoolClient, projectId: string, modelVersion: string, groups: Group[]) {
  await client.query('BEGIN')
  try {
    for (const group of groups) {
      await persistRepresentative(client, projectId, modelVersion, group)
      for (const review of group.reviews) await persistReview(client, projectId, modelVersion, group.topicId, review)
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function nearest(client: PoolClient, projectId: string, modelVersion: string, vector: number[]) {
  const started = performance.now()
  const result = await client.query<{
    topicId: string; anchorReviewId: string; memberCount: number; similarity: number; embedding: string
  }>(`SELECT topic_id AS "topicId",anchor_review_id AS "anchorReviewId",member_count AS "memberCount",
      1-(embedding <=> $3::extensions.vector) AS similarity,embedding::text
    FROM ${schema}.topic_representatives
    WHERE project_id=$1 AND model_version=$2 AND 1-(embedding <=> $3::extensions.vector) >= $4
    ORDER BY embedding <=> $3::extensions.vector LIMIT 4`, [projectId, modelVersion, vectorLiteral(vector), SIMILARITY_FLOOR])
  return { rows: result.rows.map((row) => ({ ...row, similarity: Number(row.similarity), embedding: JSON.parse(row.embedding) as number[] })), latencyMs: performance.now() - started }
}

async function exactTopic(client: PoolClient, projectId: string, modelVersion: string, review: Review) {
  const result = await client.query<{ topicId: string }>(`SELECT topic_id AS "topicId"
    FROM ${schema}.review_embeddings WHERE project_id=$1 AND model_version=$2 AND content_hash=$3 LIMIT 1`, [
    projectId, modelVersion, canonicalEmbeddingKey(modelVersion, review.text),
  ])
  return result.rows[0]?.topicId
}

async function indexedPlan(client: PoolClient, projectId: string, modelVersion: string, vector: number[]) {
  const result = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN (COSTS OFF)
    SELECT topic_id FROM ${schema}.topic_representatives
    WHERE project_id=$1 AND model_version=$2
    ORDER BY embedding <=> $3::extensions.vector LIMIT 4`, [projectId, modelVersion, vectorLiteral(vector)])
  return result.rows.map((row) => row['QUERY PLAN']).join('\n')
}

type SqlVectorOptions = {
  fullDecisions?: Map<string, boolean>
  incrementalDecisions?: Map<string, boolean>
  expectedIncrementalPairIds?: string[]
}

export async function runSqlVectorIncrementalExperiment(connectionString: string, options: SqlVectorOptions = {}) {
  const pool = new Pool({ connectionString, max: 1 })
  const client = await pool.connect()
  try {
    await setup(client)
    const vectorVersion = (await client.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname='vector'")).rows[0]?.extversion || ''
    const provider = await createOnnxEmbeddingProvider()
    const data = incrementalExperimentFixture()
    const all = [...data.initial, ...data.appended]
    const cache = new Map<string, number[]>()
    await canonicalEmbeddings(provider, cache, all.map((review) => review.text))
    const initialReviews = withEmbeddings(data.initial, await canonicalEmbeddings(provider, cache, data.initial.map((review) => review.text)))
    const appendedReviews = withEmbeddings(data.appended, await canonicalEmbeddings(provider, cache, data.appended.map((review) => review.text)))
    const allReviews = [...initialReviews, ...appendedReviews]
    const decisions = savedDecisionsFor(allReviews)
    const fullDecisions = options.fullDecisions || decisions
    const incrementalDecisions = options.incrementalDecisions || decisions
    const fullProjectId = randomUUID()
    const incrementalProjectId = randomUUID()
    const fullPairIds: string[] = []
    const incrementalPairIds: string[] = []

    const full = await measured(async (sampleRss) => {
      const analysis = await fullAnalysis(allReviews, fullDecisions, fullPairIds)
      await persistGroups(client, fullProjectId, provider.version, analysis.groups)
      sampleRss()
      return analysis
    })

    const initial = await fullAnalysis(initialReviews, decisions)
    await persistGroups(client, incrementalProjectId, provider.version, initial.groups)
    await client.query(`ANALYZE ${schema}.topic_representatives`)
    const groups = initial.groups.map((group) => ({ ...group, reviews: [...group.reviews], representative: [...group.representative] }))
    const retrievalLatencies: number[] = []
    let retrievedCandidates = 0
    let judgmentCandidates = 0
    let clearMatches = 0
    let newTopics = 0
    const incremental = await measured(async (sampleRss) => {
      for (const review of appendedReviews) {
        const exactTopicId = await exactTopic(client, incrementalProjectId, provider.version, review)
        const matches = exactTopicId
          ? { rows: [] as Awaited<ReturnType<typeof nearest>>['rows'], latencyMs: 0 }
          : await nearest(client, incrementalProjectId, provider.version, review.vector)
        retrievalLatencies.push(matches.latencyMs)
        retrievedCandidates += matches.rows.length
        if (exactTopicId) clearMatches += 1
        judgmentCandidates += matches.rows.length
        for (const match of matches.rows) incrementalPairIds.push(pairIdFor(review.id, match.anchorReviewId))
        const selected = matches.rows.find((match) => incrementalDecisions.get(pairIdFor(review.id, match.anchorReviewId)) === true)
        let group = exactTopicId
          ? groups.find((candidate) => candidate.topicId === exactTopicId)
          : selected ? groups.find((candidate) => candidate.topicId === selected.topicId) : undefined
        if (!group) {
          newTopics += 1
          group = { topicId: review.id, reviews: [], representative: review.vector }
          groups.push(group)
        }
        group.reviews.push(review)
        group.representative = mean(group.reviews.map((member) => member.vector))
        await client.query('BEGIN')
        try {
          await persistReview(client, incrementalProjectId, provider.version, group.topicId, review)
          await persistRepresentative(client, incrementalProjectId, provider.version, group)
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
        sampleRss()
      }
      return groups
    })

    await client.query(`ANALYZE ${schema}.topic_representatives`)
    const plan = await indexedPlan(client, incrementalProjectId, provider.version, appendedReviews[0].vector)
    const fullGroups = full.value.groups
    const incrementalGroups = incremental.value
    const fullTopic = fingerprint(fullGroups)
    const incrementalTopic = fingerprint(incrementalGroups)
    const fullEvidence = evidenceFingerprint(fullGroups)
    const incrementalEvidence = evidenceFingerprint(incrementalGroups)
    const fullProvenance = provenanceFingerprint(fullGroups)
    const incrementalProvenance = provenanceFingerprint(incrementalGroups)
    const equivalence = {
      topic: fullTopic === incrementalTopic, evidence: fullEvidence === incrementalEvidence,
      provenance: fullProvenance === incrementalProvenance,
      fullTopicFingerprint: fullTopic, incrementalTopicFingerprint: incrementalTopic,
      fullEvidenceFingerprint: fullEvidence, incrementalEvidenceFingerprint: incrementalEvidence,
      fullProvenanceFingerprint: fullProvenance, incrementalProvenanceFingerprint: incrementalProvenance,
    }
    const memberships = (groups: Group[]) => groups.map((group) => group.reviews.map((review) => review.id).sort().join('|')).sort()
    const fullMemberships = memberships(fullGroups)
    const incrementalMemberships = memberships(incrementalGroups)
    const uniqueFullPairIds = [...new Set(fullPairIds)].sort()
    const uniqueIncrementalPairIds = [...new Set(incrementalPairIds)].sort()
    const expectedIncrementalPairIds = options.expectedIncrementalPairIds && [...new Set(options.expectedIncrementalPairIds)].sort()
    if (expectedIncrementalPairIds && JSON.stringify(uniqueIncrementalPairIds) !== JSON.stringify(expectedIncrementalPairIds)) {
      throw new Error('LIVE_SQL_VECTOR_CANDIDATE_DRIFT')
    }
    return {
      dataset: { initialReviews: 10, appendedReviews: 20, totalReviews: 30 },
      vector: { version: vectorVersion, dimensions: provider.dimensions, indexUsed: /Index Scan using topic_representatives_hnsw/.test(plan), plan },
      embedding: { id: provider.id, version: provider.version, cacheEntries: cache.size },
      candidatePairIds: { full: uniqueFullPairIds, incremental: uniqueIncrementalPairIds },
      full: {
        topicCount: fullGroups.length,
        candidateCount: full.value.measurement.candidateCount,
        adjudicationDecisions: full.value.measurement.adjudicationDecisions,
        modelRequestEquivalents: full.value.measurement.modelRequestEquivalents,
        wallMs: full.wallMs, cpuMs: full.cpuMs, peakRssDeltaBytes: full.peakRssDeltaBytes,
      },
      incremental: {
        topicCount: incrementalGroups.length,
        retrievedCandidates, judgmentCandidates, clearMatches, newTopics,
        modelRequestEquivalents: requestEquivalents(appendedReviews.length, judgmentCandidates),
        retrieval: { samples: retrievalLatencies.length, p50Ms: percentile(retrievalLatencies, .5), p95Ms: percentile(retrievalLatencies, .95) },
        uniqueEvidenceCount: new Set(incrementalGroups.flatMap((group) => group.reviews.map((review) => review.id))).size,
        wallMs: incremental.wallMs, cpuMs: incremental.cpuMs, peakRssDeltaBytes: incremental.peakRssDeltaBytes,
      },
      equivalence: {
        exact: equivalence.topic && equivalence.evidence && equivalence.provenance, ...equivalence,
        membershipDifference: {
          onlyFull: fullMemberships.filter((membership) => !incrementalMemberships.includes(membership)),
          onlyIncremental: incrementalMemberships.filter((membership) => !fullMemberships.includes(membership)),
        },
      },
    }
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    client.release()
    await pool.end()
  }
}

export async function runLiveSqlVectorDifferentialExperiment(connectionString: string, options: {
  completionProvider?: CompletionProvider
  model?: string
  maxTokens?: number
} = {}) {
  const policy = clusterInterpretationPolicyFromEnv()
  const completionProvider = options.completionProvider || openCodeGoProviderFromEnv()
  const model = options.model || policy?.model
  const maxTokens = options.maxTokens || policy?.maxOutputTokens
  if (!completionProvider || !model || !maxTokens) throw new Error('The isolated live SQL-vector benchmark is not configured.')

  const plan = await runSqlVectorIncrementalExperiment(connectionString)
  if (plan.candidatePairIds.full.length !== 65 || plan.candidatePairIds.incremental.length !== 52) {
    throw new Error(`LIVE_SQL_VECTOR_PLAN_DRIFT:${plan.candidatePairIds.full.length}:${plan.candidatePairIds.incremental.length}`)
  }
  const data = incrementalExperimentFixture()
  const reviews = [...data.initial, ...data.appended]

  const fullStarted = performance.now()
  const fullProvider = await measured(() => liveDecisions(
    completionProvider, model, maxTokens, pairCandidates(reviews, plan.candidatePairIds.full), fullStarted,
  ))
  const incrementalStarted = performance.now()
  const incrementalProvider = await measured(() => liveDecisions(
    completionProvider, model, maxTokens, pairCandidates(reviews, plan.candidatePairIds.incremental), incrementalStarted,
  ))
  if (fullProvider.value.retries || incrementalProvider.value.retries) throw new Error('LIVE_SQL_VECTOR_RETRY_ABORT')
  for (const pairId of plan.candidatePairIds.full) {
    if (!fullProvider.value.decisions.has(pairId)) throw new Error(`LIVE_SQL_VECTOR_FULL_DECISION_MISSING:${pairId}`)
  }
  for (const pairId of plan.candidatePairIds.incremental) {
    if (!incrementalProvider.value.decisions.has(pairId)) throw new Error(`LIVE_SQL_VECTOR_INCREMENTAL_DECISION_MISSING:${pairId}`)
  }

  const replay = await runSqlVectorIncrementalExperiment(connectionString, {
    fullDecisions: fullProvider.value.decisions,
    incrementalDecisions: incrementalProvider.value.decisions,
    expectedIncrementalPairIds: plan.candidatePairIds.incremental,
  })
  const path = (provider: typeof fullProvider, analysis: typeof replay.full | typeof replay.incremental) => ({
    candidateCount: 'candidateCount' in analysis ? analysis.candidateCount : analysis.judgmentCandidates,
    providerCalls: provider.value.providerCalls,
    queueWaitMs: provider.value.queueWaitMs,
    totalQueueWaitMs: provider.value.totalQueueWaitMs,
    modelDurationMs: provider.value.modelDurationMs,
    retries: provider.value.retries,
    firstFullyCoveredEvidenceMs: provider.wallMs + analysis.wallMs,
    completionMs: provider.wallMs + analysis.wallMs,
    cpuMs: provider.cpuMs + analysis.cpuMs,
    peakRssDeltaBytes: Math.max(provider.peakRssDeltaBytes, analysis.peakRssDeltaBytes),
  })
  return {
    aborted: !replay.equivalence.exact,
    abortReason: replay.equivalence.exact ? null : 'EQUIVALENCE_FAILED',
    dataset: replay.dataset,
    model,
    vector: replay.vector,
    full: path(fullProvider, replay.full),
    incremental: path(incrementalProvider, replay.incremental),
    equivalence: replay.equivalence,
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const connectionString = process.env.SQL_VECTOR_EXPERIMENT_DATABASE_URL
  if (!connectionString) throw new Error('SQL_VECTOR_EXPERIMENT_DATABASE_URL is required.')
  console.log(JSON.stringify(await runSqlVectorIncrementalExperiment(connectionString), null, 2))
}
