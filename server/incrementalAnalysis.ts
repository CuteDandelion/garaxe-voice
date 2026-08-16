import { createHash } from 'node:crypto'
import type { DatabaseClient } from './database'
import type { EmbeddingProvider } from './semanticAnalysis'

export type SemanticContract = {
  pipelineVersion: string
  preprocessingVersion: string
  embeddingModel: string
  embeddingVersion: string
  promptVersion: string
  schemaVersion: string
  model: string
  candidateVersion: string
  routingPolicy: string
}

export type PersistedReviewDecision = {
  reviewId: string
  contentHash: string
  contractKey: string
  outcome: Record<string, unknown>
}

export type PersistedPairDecision = {
  pairId: string
  contractKey: string
  sameTopic: boolean
}

export type PersistedAspectDecision = {
  aspectKey: string
  signalFingerprint: string
  contractKey: string
  outcome: Record<string, unknown>
}

export const aspectSemanticsEnabled = (environment: NodeJS.ProcessEnv = process.env) =>
  environment.VOICE_LAB_ASPECT_SEMANTICS_ENABLED === 'true'

const normalizedAspectPart = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')

export const canonicalAspectIdentity = (signalType: string, normalizedAspect: string) =>
  `${normalizedAspectPart(signalType)}:${normalizedAspectPart(normalizedAspect)}`

export const canonicalAspectKey = (input: {
  contentHash: string; signalType: string; quoteText: string; quoteStart: number; quoteEnd: number
}) => createHash('sha256').update(JSON.stringify({
  contentHash: input.contentHash,
  signalType: normalizedAspectPart(input.signalType),
  quoteText: input.quoteText.normalize('NFKC'), quoteStart: input.quoteStart, quoteEnd: input.quoteEnd,
})).digest('hex')

export const canonicalAspectFingerprint = (input: Parameters<typeof canonicalAspectKey>[0]) =>
  createHash('sha256').update(JSON.stringify({
    contentHash: input.contentHash, signalType: normalizedAspectPart(input.signalType),
    quoteText: input.quoteText.normalize('NFKC'), quoteStart: input.quoteStart, quoteEnd: input.quoteEnd,
  })).digest('hex')

export const canonicalEmbeddingContentHash = (text: string) => createHash('sha256')
  .update(text.normalize('NFKC').trim()).digest('hex')

export async function incrementalSemanticStateAvailable(database: DatabaseClient) {
  try {
    const result = await database.query<{ available: boolean }>(
      `SELECT to_regclass('public.project_review_semantic_decisions') IS NOT NULL
        AND to_regclass('public.project_review_pair_decisions') IS NOT NULL
        AND to_regclass('public.analysis_run_pair_decisions') IS NOT NULL
        AND to_regclass('public.project_semantic_embeddings') IS NOT NULL AS available`,
    )
    return result.rows[0]?.available === true
  } catch {
    return false
  }
}

export async function aspectSemanticStateAvailable(database: DatabaseClient) {
  try {
    const result = await database.query<{ available: boolean }>(
      `SELECT to_regclass('public.project_aspect_semantic_decisions') IS NOT NULL
        AND to_regclass('public.analysis_run_aspect_decisions') IS NOT NULL AS available`,
    )
    return result.rows[0]?.available === true
  } catch {
    return false
  }
}

export async function aspectRuntimeEnabled(database: DatabaseClient, environment: NodeJS.ProcessEnv = process.env) {
  return aspectSemanticsEnabled(environment) && await aspectSemanticStateAvailable(database)
}

export function projectCachedEmbeddingProvider(database: DatabaseClient, projectId: string, provider: EmbeddingProvider): EmbeddingProvider {
  if (provider.dimensions !== 384) return provider
  return {
    ...provider,
    async embed(texts: string[]) {
      if (!await incrementalSemanticStateAvailable(database)) return provider.embed(texts)
      const hashes = texts.map(canonicalEmbeddingContentHash)
      const existing = await database.query<{ contentHash: string; embedding: string }>(
        `SELECT content_hash AS "contentHash", embedding::text AS embedding
         FROM project_semantic_embeddings
         WHERE project_id = $1 AND embedding_model = $2 AND embedding_version = $3
           AND content_hash = ANY($4::text[])`,
        [projectId, provider.id, provider.version, hashes],
      )
      const vectors = new Map(existing.rows.map((row) => [row.contentHash, JSON.parse(row.embedding) as number[]]))
      const missing = texts.flatMap((text, index) => vectors.has(hashes[index]) ? [] : [{ text, hash: hashes[index] }])
      if (missing.length) {
        const generated = await provider.embed(missing.map((item) => item.text))
        for (const [index, item] of missing.entries()) {
          const vector = generated[index]
          if (!vector || vector.length !== provider.dimensions) throw new Error('Semantic embedding output does not match the configured model.')
          await database.query(
            `INSERT INTO project_semantic_embeddings
              (project_id,content_hash,embedding_model,embedding_version,dimensions,embedding)
             VALUES ($1,$2,$3,$4,$5,$6::extensions.vector) ON CONFLICT DO NOTHING`,
            [projectId, item.hash, provider.id, provider.version, provider.dimensions, JSON.stringify(vector)],
          )
          vectors.set(item.hash, vector)
        }
      }
      return hashes.map((hash) => vectors.get(hash)!)
    },
  }
}

export const semanticContractKey = (contract: SemanticContract) => createHash('sha256')
  .update(JSON.stringify(contract)).digest('hex')

export function compatibleReviewDecisionPlan(
  reviews: Array<{ reviewId: string; contentHash: string }>,
  stored: PersistedReviewDecision[],
  contract: SemanticContract,
  requiredExistingReviewIds = new Set<string>(),
) {
  const contractKey = semanticContractKey(contract)
  const byReview = new Map(stored.filter((item) => item.contractKey === contractKey)
    .map((item) => [item.reviewId, item]))
  const currentReviewIds = new Set(reviews.map((review) => review.reviewId))
  const incompatibleExisting = [...requiredExistingReviewIds].some((reviewId) => !currentReviewIds.has(reviewId)) || reviews.some((review) => {
    if (!requiredExistingReviewIds.has(review.reviewId)) return false
    const decision = byReview.get(review.reviewId)
    return !decision || decision.contentHash !== review.contentHash
  })
  if (incompatibleExisting) return {
    reusable: [] as PersistedReviewDecision[], unseenReviewIds: reviews.map((review) => review.reviewId), compatible: false,
  }
  const reusable = reviews.flatMap((review) => {
    const decision = byReview.get(review.reviewId)
    return decision?.contentHash === review.contentHash ? [decision] : []
  })
  const reused = new Set(reusable.map((item) => item.reviewId))
  return { reusable, unseenReviewIds: reviews.filter((review) => !reused.has(review.reviewId)).map((review) => review.reviewId), compatible: true }
}

export function compatiblePairDecisionPlan(pairIds: string[], stored: PersistedPairDecision[], contract: SemanticContract) {
  const contractKey = semanticContractKey(contract)
  const byPair = new Map(stored.filter((item) => item.contractKey === contractKey).map((item) => [item.pairId, item]))
  const reusable = pairIds.flatMap((pairId) => byPair.has(pairId) ? [byPair.get(pairId)!] : [])
  return { reusable, unseenPairIds: pairIds.filter((pairId) => !byPair.has(pairId)) }
}

export function compatibleAspectDecisionPlan(
  signals: Array<{ signalId: string; aspectKey: string; signalFingerprint: string }>,
  stored: PersistedAspectDecision[], contract: SemanticContract, requiredExistingAspectKeys = new Set<string>(),
) {
  const contractKey = semanticContractKey(contract)
  const byAspect = new Map(stored.filter((item) => item.contractKey === contractKey).map((item) => [item.aspectKey, item]))
  const currentKeys = new Set(signals.map((signal) => signal.aspectKey))
  const incompatible = [...requiredExistingAspectKeys].some((aspectKey) => !currentKeys.has(aspectKey))
    || signals.some((signal) => requiredExistingAspectKeys.has(signal.aspectKey)
      && byAspect.get(signal.aspectKey)?.signalFingerprint !== signal.signalFingerprint)
  if (incompatible) return { reusable: [] as Array<PersistedAspectDecision & { signalId: string }>,
    unseenSignalIds: signals.map((signal) => signal.signalId), compatible: false }
  const reusable = signals.flatMap((signal) => {
    const decision = byAspect.get(signal.aspectKey)
    return decision?.signalFingerprint === signal.signalFingerprint ? [{ ...decision, signalId: signal.signalId }] : []
  })
  const reused = new Set(reusable.map((item) => item.signalId))
  return { reusable, unseenSignalIds: signals.filter((signal) => !reused.has(signal.signalId)).map((signal) => signal.signalId), compatible: true }
}

type AspectSignalRow = {
  signalId: string; reviewId: string; contentHash: string; signalType: string; normalizedAspect: string
  quoteText: string; quoteStart: number; quoteEnd: number
}

const withAspectIdentity = (row: AspectSignalRow) => ({ ...row,
  topicIdentity: canonicalAspectIdentity(row.signalType, row.normalizedAspect),
  aspectKey: canonicalAspectKey(row), signalFingerprint: canonicalAspectFingerprint(row),
})

async function aspectSignalsForRun(database: DatabaseClient, runId: string) {
  const result = await database.query<AspectSignalRow>(
    `SELECT rs.id AS "signalId", rs.review_id AS "reviewId", r.canonical_hash AS "contentHash",
      rs.signal_type AS "signalType", rs.normalized_aspect AS "normalizedAspect", rs.quote_text AS "quoteText",
      rs.quote_start AS "quoteStart", rs.quote_end AS "quoteEnd"
     FROM review_signals rs JOIN analysis_run_reviews arr
       ON arr.analysis_run_id = rs.analysis_run_id AND arr.review_id = rs.review_id
     JOIN reviews r ON r.id = rs.review_id
     WHERE rs.analysis_run_id = $1 AND arr.inclusion_status = 'included' ORDER BY rs.review_id, rs.id`, [runId],
  )
  return result.rows.map(withAspectIdentity)
}

async function aspectSignalForRun(database: DatabaseClient, runId: string, signalId: string) {
  const result = await database.query<AspectSignalRow>(
    `SELECT rs.id AS "signalId", rs.review_id AS "reviewId", r.canonical_hash AS "contentHash",
      rs.signal_type AS "signalType", rs.normalized_aspect AS "normalizedAspect", rs.quote_text AS "quoteText",
      rs.quote_start AS "quoteStart", rs.quote_end AS "quoteEnd"
     FROM review_signals rs JOIN analysis_run_reviews arr
       ON arr.analysis_run_id = rs.analysis_run_id AND arr.review_id = rs.review_id
     JOIN reviews r ON r.id = rs.review_id
     WHERE rs.analysis_run_id = $1 AND rs.id = $2 AND arr.inclusion_status = 'included'`, [runId, signalId],
  )
  return result.rows[0] ? withAspectIdentity(result.rows[0]) : null
}

export async function reuseCompatibleAspectDecisions(database: DatabaseClient, runId: string, contract: SemanticContract) {
  if (!await aspectSemanticStateAvailable(database)) return { compatible: false, reused: 0, unseenSignalIds: [] as string[] }
  const run = await database.query<{ projectId: string; configuration: unknown; pipelineVersion: string }>(
    `SELECT project_id AS "projectId", configuration, pipeline_version AS "pipelineVersion" FROM analysis_runs WHERE id = $1`, [runId],
  )
  if (!run.rows[0] || run.rows[0].pipelineVersion !== contract.pipelineVersion) {
    return { compatible: false, reused: 0, unseenSignalIds: [] as string[] }
  }
  const current = await aspectSignalsForRun(database, runId)
  const base = await database.query<{ id: string }>(
    `SELECT id FROM analysis_runs WHERE project_id = $1 AND id <> $2 AND status = 'completed'
      AND pipeline_version = $3 AND configuration = $4::jsonb
     ORDER BY completed_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1`,
    [run.rows[0].projectId, runId, contract.pipelineVersion, JSON.stringify(run.rows[0].configuration)],
  )
  if (!base.rows[0]) return { compatible: false, reused: 0, unseenSignalIds: current.map((signal) => signal.signalId) }
  const required = new Set((await aspectSignalsForRun(database, base.rows[0].id)).map((signal) => signal.aspectKey))
  const contractKey = semanticContractKey(contract)
  const stored = await database.query<PersistedAspectDecision>(
    `SELECT aspect_key AS "aspectKey", signal_fingerprint AS "signalFingerprint", contract_key AS "contractKey", outcome
     FROM project_aspect_semantic_decisions WHERE project_id = $1 AND contract_key = $2`,
    [run.rows[0].projectId, contractKey],
  )
  const plan = compatibleAspectDecisionPlan(current, stored.rows, contract, required)
  if (!plan.compatible) return { compatible: false, reused: 0, unseenSignalIds: plan.unseenSignalIds }
  for (const decision of plan.reusable) {
    const signal = current.find((item) => item.signalId === decision.signalId)!
    await database.query(`UPDATE review_signals SET attributes = attributes || $3::jsonb WHERE id = $1 AND analysis_run_id = $2`,
      [signal.signalId, runId, JSON.stringify({ canonicalOutcome: decision.outcome })])
    await database.query(
      `INSERT INTO analysis_run_aspect_decisions
        (analysis_run_id,project_id,signal_id,review_id,aspect_key,contract_key)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [runId, run.rows[0].projectId, signal.signalId, signal.reviewId, signal.aspectKey, contractKey],
    )
  }
  return { compatible: true, reused: plan.reusable.length, unseenSignalIds: plan.unseenSignalIds }
}

export async function persistAspectSemanticDecision(
  database: DatabaseClient, runId: string, signalId: string, outcome: Record<string, unknown>, contract: SemanticContract,
) {
  if (!await aspectSemanticStateAvailable(database)) return false
  const signal = await aspectSignalForRun(database, runId, signalId)
  if (!signal) return false
  const run = await database.query<{ projectId: string }>(`SELECT project_id AS "projectId" FROM analysis_runs WHERE id = $1`, [runId])
  if (!run.rows[0]) return false
  const contractKey = semanticContractKey(contract)
  const payload = JSON.stringify(outcome)
  await database.query(
    `INSERT INTO project_aspect_semantic_decisions
      (project_id,review_id,aspect_key,topic_identity,signal_fingerprint,contract_key,outcome,response_hash,source_analysis_run_id,source_signal_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) ON CONFLICT DO NOTHING`,
    [run.rows[0].projectId, signal.reviewId, signal.aspectKey, signal.topicIdentity, signal.signalFingerprint,
      contractKey, payload, createHash('sha256').update(payload).digest('hex'), runId, signal.signalId],
  )
  await database.query(
    `INSERT INTO analysis_run_aspect_decisions
      (analysis_run_id,project_id,signal_id,review_id,aspect_key,contract_key)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [runId, run.rows[0].projectId, signal.signalId, signal.reviewId, signal.aspectKey, contractKey],
  )
  return true
}

export async function reuseCompatibleReviewDecisions(database: DatabaseClient, runId: string, contract: SemanticContract) {
  if (!await incrementalSemanticStateAvailable(database)) return { compatible: false, reused: 0, unseenReviewIds: [] as string[] }
  const run = await database.query<{ projectId: string; configuration: unknown; pipelineVersion: string }>(
    `SELECT project_id AS "projectId", configuration, pipeline_version AS "pipelineVersion"
     FROM analysis_runs WHERE id = $1`, [runId],
  )
  if (!run.rows[0] || run.rows[0].pipelineVersion !== contract.pipelineVersion) {
    return { compatible: false, reused: 0, unseenReviewIds: [] as string[] }
  }
  const base = await database.query<{ id: string }>(
    `SELECT id FROM analysis_runs
     WHERE project_id = $1 AND id <> $2 AND status = 'completed'
       AND pipeline_version = $3 AND configuration = $4::jsonb
     ORDER BY completed_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1`,
    [run.rows[0].projectId, runId, contract.pipelineVersion, JSON.stringify(run.rows[0].configuration)],
  )
  const current = await database.query<{ reviewId: string; contentHash: string }>(
    `SELECT arr.review_id AS "reviewId", r.canonical_hash AS "contentHash"
     FROM analysis_run_reviews arr JOIN reviews r ON r.id = arr.review_id
     WHERE arr.analysis_run_id = $1 AND arr.inclusion_status = 'included'
       AND arr.preprocessing_version = $2 ORDER BY arr.review_id`,
    [runId, contract.preprocessingVersion],
  )
  if (!base.rows[0]) return { compatible: false, reused: 0, unseenReviewIds: current.rows.map((row) => row.reviewId) }
  const baseReviews = await database.query<{ reviewId: string }>(
    `SELECT review_id AS "reviewId" FROM analysis_run_reviews
     WHERE analysis_run_id = $1 AND inclusion_status = 'included' AND preprocessing_version = $2`,
    [base.rows[0].id, contract.preprocessingVersion],
  )
  const contractKey = semanticContractKey(contract)
  const stored = await database.query<PersistedReviewDecision>(
    `SELECT review_id AS "reviewId", content_hash AS "contentHash", contract_key AS "contractKey", outcome
     FROM project_review_semantic_decisions WHERE project_id = $1 AND contract_key = $2`,
    [run.rows[0].projectId, contractKey],
  )
  const plan = compatibleReviewDecisionPlan(current.rows, stored.rows, contract, new Set(baseReviews.rows.map((row) => row.reviewId)))
  if (!plan.compatible) return { compatible: false, reused: 0, unseenReviewIds: plan.unseenReviewIds }
  for (const decision of plan.reusable) {
    await database.query(
      `WITH target AS (
         SELECT id FROM review_signals WHERE analysis_run_id = $1 AND review_id = $2
         ORDER BY confidence DESC, LENGTH(quote_text) DESC, quote_start, id LIMIT 1
       )
       UPDATE review_signals SET attributes = attributes || $3::jsonb
       WHERE id IN (SELECT id FROM target)`,
      [runId, decision.reviewId, JSON.stringify({ canonicalOutcome: decision.outcome })],
    )
  }
  return { compatible: true, reused: plan.reusable.length, unseenReviewIds: plan.unseenReviewIds }
}

export async function persistReviewSemanticDecision(
  database: DatabaseClient, runId: string, reviewId: string, outcome: Record<string, unknown>, contract: SemanticContract,
) {
  if (!await incrementalSemanticStateAvailable(database)) return false
  const payload = JSON.stringify(outcome)
  await database.query(
    `INSERT INTO project_review_semantic_decisions
      (project_id, review_id, content_hash, contract_key, outcome, response_hash, source_analysis_run_id)
     SELECT ar.project_id, r.id, r.canonical_hash, $3, $4::jsonb, $5, ar.id
     FROM analysis_runs ar JOIN reviews r ON r.project_id = ar.project_id
     WHERE ar.id = $1 AND r.id = $2
     ON CONFLICT (project_id, review_id, contract_key) DO NOTHING`,
    [runId, reviewId, semanticContractKey(contract), payload, createHash('sha256').update(payload).digest('hex')],
  )
  return true
}

const reviewsFromPairId = (pairId: string) => {
  const values = pairId.split('::')
  return values.length === 2 ? values.sort() as [string, string] : null
}

export async function reuseCompatiblePairDecisions(
  database: DatabaseClient, runId: string, pairIds: string[], contract: SemanticContract,
) {
  if (!await incrementalSemanticStateAvailable(database)) return { reusable: [] as PersistedPairDecision[], unseenPairIds: pairIds }
  const run = await database.query<{ projectId: string }>(`SELECT project_id AS "projectId" FROM analysis_runs WHERE id = $1`, [runId])
  if (!run.rows[0]) return { reusable: [] as PersistedPairDecision[], unseenPairIds: pairIds }
  const contractKey = semanticContractKey(contract)
  const stored = await database.query<{ leftReviewId: string; rightReviewId: string; sameTopic: boolean }>(
    `SELECT left_review_id AS "leftReviewId", right_review_id AS "rightReviewId", same_topic AS "sameTopic"
     FROM project_review_pair_decisions WHERE project_id = $1 AND contract_key = $2`,
    [run.rows[0].projectId, contractKey],
  )
  const plan = compatiblePairDecisionPlan(pairIds, stored.rows.map((row) => ({
    pairId: `${row.leftReviewId}::${row.rightReviewId}`, contractKey, sameTopic: row.sameTopic,
  })), contract)
  for (const decision of plan.reusable) {
    const reviews = reviewsFromPairId(decision.pairId)
    if (!reviews) continue
    await database.query(
      `INSERT INTO analysis_run_pair_decisions
        (analysis_run_id, project_id, left_review_id, right_review_id, contract_key, same_topic)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [runId, run.rows[0].projectId, reviews[0], reviews[1], contractKey, decision.sameTopic],
    )
  }
  return plan
}

export async function persistPairDecisions(
  database: DatabaseClient, runId: string, decisions: Array<{ pairId: string; sameTopic: boolean }>, contract: SemanticContract,
) {
  if (!await incrementalSemanticStateAvailable(database)) return false
  const run = await database.query<{ projectId: string }>(`SELECT project_id AS "projectId" FROM analysis_runs WHERE id = $1`, [runId])
  if (!run.rows[0]) return false
  const contractKey = semanticContractKey(contract)
  for (const decision of decisions) {
    const reviews = reviewsFromPairId(decision.pairId)
    if (!reviews) throw new Error('INVALID_CANONICAL_PAIR_ID')
    const responseHash = createHash('sha256').update(JSON.stringify(decision)).digest('hex')
    await database.query(
      `INSERT INTO project_review_pair_decisions
        (project_id,left_review_id,right_review_id,contract_key,same_topic,response_hash,source_analysis_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [run.rows[0].projectId, reviews[0], reviews[1], contractKey, decision.sameTopic, responseHash, runId],
    )
    await database.query(
      `INSERT INTO analysis_run_pair_decisions
        (analysis_run_id,project_id,left_review_id,right_review_id,contract_key,same_topic)
       SELECT $1,$2,$3,$4,$5,same_topic FROM project_review_pair_decisions
       WHERE project_id=$2 AND left_review_id=$3 AND right_review_id=$4 AND contract_key=$5
       ON CONFLICT DO NOTHING`,
      [runId, run.rows[0].projectId, reviews[0], reviews[1], contractKey],
    )
  }
  return true
}

export async function acceptedRunPairIds(database: DatabaseClient, runId: string) {
  if (!await incrementalSemanticStateAvailable(database)) return null
  const result = await database.query<{ leftReviewId: string; rightReviewId: string }>(
    `SELECT left_review_id AS "leftReviewId", right_review_id AS "rightReviewId"
     FROM analysis_run_pair_decisions WHERE analysis_run_id = $1 AND same_topic = true`, [runId],
  )
  return new Set(result.rows.map((row) => `${row.leftReviewId}::${row.rightReviewId}`))
}
