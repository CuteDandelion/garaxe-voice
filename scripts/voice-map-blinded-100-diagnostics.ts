export type DiagnosticStage =
  | 'candidate_not_generated'
  | 'candidate_generated_not_selected_or_bounded'
  | 'pair_adjudicated_false'
  | 'complete_link_blocked_by_rejected_or_missing_cross_pair'

export type DiagnosticPairInput = {
  leftId: string
  rightId: string
  expectedRelation: 'same_topic'
  topicGroup: string
  category: string
  leftCategory: string
  rightCategory: string
  similarity: number
  selected: boolean
  adjudication: boolean | null
  adjudicationHash: string | null
  projectedTogether: boolean
  leftSourceHash: string
  rightSourceHash: string
}

export function classifyMissedPairs(pairs: DiagnosticPairInput[]) {
  const counts: Record<DiagnosticStage, number> = {
    candidate_not_generated: 0,
    candidate_generated_not_selected_or_bounded: 0,
    pair_adjudicated_false: 0,
    complete_link_blocked_by_rejected_or_missing_cross_pair: 0,
  }
  const classified = pairs.map((pair) => {
    if (pair.projectedTogether) throw new Error(`${pair.leftId}::${pair.rightId} is not a missed pair.`)
    let stage: DiagnosticStage
    let reason: string
    if (pair.leftCategory !== pair.rightCategory) {
      stage = 'candidate_not_generated'; reason = 'category_mismatch'
    } else if (pair.similarity < 0.84) {
      stage = 'candidate_not_generated'; reason = 'below_source_similarity_floor'
    } else if (!pair.selected) {
      stage = 'candidate_generated_not_selected_or_bounded'; reason = 'planner_selection_or_bound'
    } else if (pair.adjudication === false) {
      stage = 'pair_adjudicated_false'; reason = 'adjudicated_different_topic'
    } else {
      stage = 'complete_link_blocked_by_rejected_or_missing_cross_pair'
      reason = pair.adjudication === null ? 'missing_pair_decision' : 'another_cross_pair_blocked_component_merge'
    }
    counts[stage] += 1
    return { ...pair, stage, reason }
  })
  if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== pairs.length) throw new Error('Diagnostic ledger is incomplete.')
  return { counts, pairs: classified }
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const pairId = (left: string, right: string) => [left, right].sort().join('::')

export async function buildBlinded100Diagnostic(database: Database, runId: string, coverage: Array<{ originalText: string; themeIds: string[] }>) {
  const rows = await database.query<{ signalId: string; reviewId: string; sourceText: string; primaryCategory: string }>(
    `WITH ranked AS (
       SELECT rs.*, ROW_NUMBER() OVER (PARTITION BY rs.review_id ORDER BY rs.confidence DESC, LENGTH(rs.quote_text) DESC, rs.id) AS position
       FROM review_signals rs WHERE rs.analysis_run_id = $1 AND rs.attributes ? 'canonicalOutcome'
     )
     SELECT rs.id AS "signalId", rs.review_id AS "reviewId", r.body_original AS "sourceText",
       rs.attributes->'canonicalOutcome'->>'primaryCategory' AS "primaryCategory"
     FROM ranked rs JOIN reviews r ON r.id = rs.review_id WHERE rs.position = 1 ORDER BY rs.id`, [runId],
  )
  const provider = await createOnnxEmbeddingProvider()
  const vectors = await provider.embed(rows.rows.map((row) => row.sourceText))
  const plannerSignals = rows.rows.map((row) => ({
    reviewId: row.reviewId, signalTypes: [row.primaryCategory], aspect: '', label: '',
    sourceText: row.sourceText, primaryCategory: row.primaryCategory as any,
  }))
  const plan = categoryFirstGroupPlan(plannerSignals, vectors)
  const selected = new Set(plan.ambiguousPairs.map((pair) => pair.pairId))

  const jobs = await database.query<{ inputDigest: string; payload: unknown }>(
    `SELECT input_digest AS "inputDigest", result_payload AS payload FROM llm_jobs
     WHERE analysis_run_id = $1 AND kind LIKE 'candidate_pair_adjudication:%' AND state = 'succeeded'`, [runId],
  )
  const adjudications = new Map<string, { sameTopic: boolean; inputDigest: string; resultHash: string }>()
  for (const job of jobs.rows) {
    const resultHash = hash(JSON.stringify(job.payload))
    if (!Array.isArray(job.payload)) continue
    for (const decision of job.payload) if (decision && typeof decision === 'object'
      && typeof (decision as any).pairId === 'string' && typeof (decision as any).sameTopic === 'boolean') {
      adjudications.set((decision as any).pairId, { sameTopic: (decision as any).sameTopic, inputDigest: job.inputDigest, resultHash })
    }
  }

  const inputByText = new Map(blinded100Input.map((item) => [item.text, item]))
  const runtimeById = new Map(rows.rows.map((row, index) => [inputByText.get(row.sourceText)!.id, { ...row, index }]))
  const coverageById = new Map(coverage.map((item) => [inputByText.get(item.originalText)!.id, item]))
  const missed: DiagnosticPairInput[] = []
  const goldById = new Map(blinded100Rubric.map((item) => [item.id, item]))
  for (const pairGold of blinded100PairRubric.filter((pair) => pair.expectedMerge)) {
    const leftGold = goldById.get(pairGold.leftId)!
    const rightGold = goldById.get(pairGold.rightId)!
    const left = runtimeById.get(leftGold.id)!
    const right = runtimeById.get(rightGold.id)!
    const leftThemes = coverageById.get(leftGold.id)?.themeIds || []
    const rightThemes = coverageById.get(rightGold.id)?.themeIds || []
    const projectedTogether = leftThemes.some((themeId) => rightThemes.includes(themeId))
    if (projectedTogether) continue
    const runtimePairId = pairId(left.reviewId, right.reviewId)
    const decision = adjudications.get(runtimePairId)
    missed.push({
      leftId: leftGold.id, rightId: rightGold.id, expectedRelation: 'same_topic', topicGroup: leftGold.topicGroup, category: leftGold.category,
      leftCategory: left.primaryCategory, rightCategory: right.primaryCategory,
      similarity: vectors[left.index].reduce((sum, value, dimension) => sum + value * (vectors[right.index][dimension] || 0), 0),
      selected: selected.has(runtimePairId), adjudication: decision?.sameTopic ?? null,
      adjudicationHash: decision?.resultHash ?? null, projectedTogether,
      leftSourceHash: hash(left.sourceText), rightSourceHash: hash(right.sourceText),
      ...(decision ? { adjudicationInputDigest: decision.inputDigest } : {}),
    } as DiagnosticPairInput)
  }
  const result = classifyMissedPairs(missed)
  const byTopic = Object.fromEntries([...new Set(result.pairs.map((item) => item.topicGroup))].map((topic) => [topic,
    Object.fromEntries(Object.keys(result.counts).map((stage) => [stage, result.pairs.filter((item) => item.topicGroup === topic && item.stage === stage).length])),
  ]))
  const byCategory = Object.fromEntries([...new Set(result.pairs.map((item) => item.category))].map((category) => [category,
    Object.fromEntries(Object.keys(result.counts).map((stage) => [stage, result.pairs.filter((item) => item.category === category && item.stage === stage).length])),
  ]))
  return { runIdHash: hash(runId), totalMisses: result.pairs.length, counts: result.counts, byCategory, byTopic, pairs: result.pairs }
}
import { createHash } from 'node:crypto'
import type { Database } from '../server/database'
import { categoryFirstGroupPlan } from '../server/clusterInterpretation'
import { createOnnxEmbeddingProvider } from '../server/semanticAnalysis'
import { blinded100Input } from './voice-map-blinded-100-input'
import { blinded100PairRubric, blinded100Rubric } from './voice-map-blinded-100-rubric'
