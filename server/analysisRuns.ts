import { randomUUID } from 'node:crypto'
import type { Database } from './database'
import { preprocessReviews, type PreprocessingConfig, type PreprocessingReview } from './preprocessing'
import { analyzeSemantically, createDeterministicTestEmbeddingProvider, DETERMINISTIC_TEST_CLUSTERING_OPTIONS, SEMANTIC_ANALYSIS_VERSION } from './semanticAnalysis'
import { formThemes, synthesizeVoiceMap, THEME_ENGINE_VERSION } from './themeEngine'
import { enqueueClusterInterpretation, settleClusterInterpretationRuns } from './clusterInterpretation'

export const ANALYSIS_PIPELINE_VERSION = 'semantic-voice-map-v5'

export const analysisObjectives = [
  'full_voice_map',
  'complaints',
  'positive_language',
  'operational_issues',
  'purchase_drivers',
  'location_comparison',
] as const

export type AnalysisObjective = (typeof analysisObjectives)[number]

export type AnalysisConfiguration = {
  objective: AnalysisObjective
  dateFrom?: string
  dateTo?: string
  entities: string[]
  ratings: number[]
  languages: string[]
  writtenOnly: boolean
  minTextLength: number
}

type ReviewRow = {
  id: string
  bodyOriginal: string | null
  ratingValue: number | null
  language: string | null
  sourceCreatedAt: string | null
  entityName: string | null
  canonicalHash: string
  isRatingOnly: boolean
}

function uniqueStrings(value: unknown, field: string) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`INVALID_${field.toUpperCase()}`)
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))]
}

function validDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`INVALID_${field.toUpperCase()}`)
  return value
}

export function validateAnalysisConfiguration(value: unknown): AnalysisConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CONFIGURATION')
  const input = value as Record<string, unknown>
  if (typeof input.objective !== 'string' || !analysisObjectives.includes(input.objective as AnalysisObjective)) throw new Error('INVALID_OBJECTIVE')
  const dateFrom = validDate(input.dateFrom, 'date_from')
  const dateTo = validDate(input.dateTo, 'date_to')
  if (dateFrom && dateTo && Date.parse(dateFrom) > Date.parse(dateTo)) throw new Error('INVALID_DATE_RANGE')
  const ratings = input.ratings === undefined ? [] : input.ratings
  if (!Array.isArray(ratings) || ratings.some((rating) => typeof rating !== 'number' || !Number.isFinite(rating) || rating < 0 || rating > 5)) {
    throw new Error('INVALID_RATINGS')
  }
  const minTextLength = input.minTextLength === undefined ? 3 : input.minTextLength
  if (!Number.isInteger(minTextLength) || Number(minTextLength) < 0 || Number(minTextLength) > 10_000) throw new Error('INVALID_MIN_TEXT_LENGTH')
  if (input.writtenOnly !== undefined && typeof input.writtenOnly !== 'boolean') throw new Error('INVALID_WRITTEN_ONLY')
  return {
    objective: input.objective as AnalysisObjective,
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    entities: uniqueStrings(input.entities, 'entities'),
    ratings: [...new Set(ratings as number[])].sort((left, right) => left - right),
    languages: uniqueStrings(input.languages, 'languages').map((language) => language.toLowerCase()),
    writtenOnly: input.writtenOnly === undefined ? true : input.writtenOnly,
    minTextLength: Number(minTextLength),
  }
}

function preprocessingConfiguration(configuration: AnalysisConfiguration): PreprocessingConfig {
  return {
    objective: configuration.objective,
    writtenOnly: configuration.writtenOnly,
    minTextLength: configuration.minTextLength,
    languages: configuration.languages,
    dateFrom: configuration.dateFrom,
    dateTo: configuration.dateTo,
    entityNames: configuration.entities,
    ratings: configuration.ratings,
  }
}

export async function createAnalysisRun(database: Database, projectId: string, configuration: AnalysisConfiguration) {
  const id = randomUUID()
  const snapshot = structuredClone(configuration)
  await database.query(
    `INSERT INTO analysis_runs (id, project_id, objective, configuration, status, stage, pipeline_version)
     VALUES ($1, $2, $3, $4, 'queued', 'queued', $5)`,
    [id, projectId, snapshot.objective, JSON.stringify(snapshot), ANALYSIS_PIPELINE_VERSION],
  )
  return { id, projectId, configuration: snapshot, objective: snapshot.objective, status: 'queued', stage: 'queued', pipelineVersion: ANALYSIS_PIPELINE_VERSION }
}

export async function processAnalysisRun(database: Database, runId: string) {
  try {
    const run = await database.query<{ projectId: string; organizationId: string; configuration: AnalysisConfiguration }>(
      `UPDATE analysis_runs SET status = 'assembling_dataset', stage = 'assembling_dataset', started_at = COALESCE(started_at, NOW())
       WHERE id = $1 AND status = 'queued' RETURNING project_id AS "projectId",
       (SELECT organization_id FROM project_organizations WHERE project_id = analysis_runs.project_id ORDER BY organization_id LIMIT 1) AS "organizationId",
       configuration`,
      [runId],
    )
    if (!run.rows[0]) return
    const source = await database.query<ReviewRow>(
      `SELECT id, body_original AS "bodyOriginal", rating_value AS "ratingValue", language,
        source_created_at AS "sourceCreatedAt", entity_name AS "entityName", canonical_hash AS "canonicalHash",
        is_rating_only AS "isRatingOnly"
       FROM reviews WHERE project_id = $1 ORDER BY imported_at ASC, id ASC`,
      [run.rows[0].projectId],
    )
    await database.query(`UPDATE analysis_runs SET status = 'preprocessing', stage = 'preprocessing' WHERE id = $1`, [runId])
    const reviews: PreprocessingReview[] = source.rows.map((review) => ({
      id: review.id,
      bodyOriginal: review.bodyOriginal,
      ratingValue: review.ratingValue,
      language: review.language,
      sourceCreatedAt: review.sourceCreatedAt,
      entityName: review.entityName,
      canonicalHash: review.canonicalHash,
      isRatingOnly: review.isRatingOnly,
    }))
    const result = preprocessReviews(reviews, preprocessingConfiguration(run.rows[0].configuration))
    const byReason = result.reviews.reduce<Record<string, number>>((counts, review) => {
      if (review.status === 'excluded') counts[review.reason] = (counts[review.reason] || 0) + 1
      return counts
    }, {})
    const counts = {
      found: result.reviews.length,
      included: result.reviews.filter((review) => review.status === 'included').length,
      excluded: result.reviews.filter((review) => review.status === 'excluded').length,
      byReason,
    }
    await database.transaction(async (transaction) => {
      for (const review of result.reviews) {
        await transaction.query(
          `INSERT INTO analysis_run_reviews
            (analysis_run_id, review_id, inclusion_status, exclusion_reason, normalized_text, preprocessing_version)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [runId, review.reviewId, review.status, review.status === 'excluded' ? review.reason : null, review.normalizedText, result.qualityReport.preprocessingVersion],
        )
      }
    })
    await database.query(`UPDATE analysis_runs SET stage = 'extracting_signals', counts = $2, quality_report = $3 WHERE id = $1`, [runId, JSON.stringify(counts), JSON.stringify(result.qualityReport)])
    const includedIds = new Set(result.reviews.filter((review) => review.status === 'included').map((review) => review.reviewId))
    const includedSource = source.rows.filter((review) => includedIds.has(review.id))
    const extractionInput = includedSource.map((review) => ({
      reviewId: review.id,
      text: review.bodyOriginal,
      rating: review.ratingValue,
      language: review.language,
      entity: review.entityName,
      sourceCreatedAt: review.sourceCreatedAt,
    }))
    const semantic = await analyzeSemantically(
      extractionInput,
      process.env.NODE_ENV === 'test' ? createDeterministicTestEmbeddingProvider() : undefined,
      undefined,
      process.env.NODE_ENV === 'test' ? DETERMINISTIC_TEST_CLUSTERING_OPTIONS : undefined,
    )
    const extracted = semantic.signals
    const signals = extracted.map((signal) => ({ ...signal, id: `${runId}:${signal.id}` }))
    await database.query(
      `UPDATE analysis_runs SET stage = 'forming_themes', quality_report = quality_report || $2::jsonb WHERE id = $1`,
      [runId, JSON.stringify({ semanticAnalysis: semantic.metadata })],
    )
    const minimumIndependentEvidence = includedSource.length < 10 ? 1 : 3
    const formedThemes = formThemes(signals, includedSource.map((review) => ({
      id: review.id,
      ratingValue: review.ratingValue,
      language: review.language,
      entityName: review.entityName,
      sourceCreatedAt: review.sourceCreatedAt,
      canonicalHash: review.canonicalHash,
    })), { minimumIndependentEvidence })
    const themes = formedThemes.map((theme) => ({ ...theme, id: `${runId}:${theme.id}` }))
    const voiceMap = synthesizeVoiceMap(themes, includedSource)
    await database.transaction(async (transaction) => {
      for (const signal of signals) {
        await transaction.query(
          `INSERT INTO review_signals
            (id, analysis_run_id, review_id, signal_type, label, normalized_aspect, sentiment, emotion,
             confidence, quote_text, quote_start, quote_end, attributes, extractor_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [signal.id, runId, signal.reviewId, signal.signalType, signal.label, signal.normalizedAspect, signal.sentiment,
            signal.emotion || null, signal.confidence, signal.quoteText, signal.quoteStart, signal.quoteEnd,
            JSON.stringify(signal.attributes), SEMANTIC_ANALYSIS_VERSION],
        )
      }
      for (const theme of themes) {
        await transaction.query(
          `INSERT INTO themes
            (id, analysis_run_id, name, description, theme_type, sentiment, confidence, rank, metrics, validation, engine_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [theme.id, runId, theme.name, theme.summary, theme.signalType,
            theme.metrics.sentimentBreakdown[0]?.value || 'mixed', theme.metrics.confidenceLabel, theme.rank,
            JSON.stringify(theme.metrics), JSON.stringify({ status: theme.validationStatus, evidence: theme.evidence, repeatedPhrases: theme.repeatedPhrases }), THEME_ENGINE_VERSION],
        )
        for (const signalId of theme.evidence.signalIds) {
          const signal = signals.find((candidate) => candidate.id === signalId)
          if (!signal) continue
          await transaction.query(
            `INSERT INTO theme_evidence (theme_id, signal_id, review_id, evidence_strength, is_representative)
             VALUES ($1,$2,$3,$4,$5)`,
            [theme.id, signal.id, signal.reviewId, signal.confidence,
              theme.evidence.representativeQuotes.some((quote) => quote.signalId === signal.id)],
          )
        }
      }
      await transaction.query(
        `INSERT INTO voice_maps (analysis_run_id, artifact, synthesis_version) VALUES ($1,$2,$3)`,
        [runId, JSON.stringify({ voiceMap, validationThreshold: minimumIndependentEvidence }), THEME_ENGINE_VERSION],
      )
      await transaction.query(
        `UPDATE analysis_runs SET stage = 'interpreting_clusters' WHERE id = $1`,
        [runId],
      )
    })
    const enrichment = await enqueueClusterInterpretation(database, {
      organizationId: run.rows[0].organizationId,
      projectId: run.rows[0].projectId,
      analysisRunId: runId,
    })
    await database.query(
      `UPDATE analysis_runs SET status = 'interpreting_clusters',
        quality_report = quality_report || $2::jsonb WHERE id = $1`,
      [runId, JSON.stringify({ clusterInterpretation: enrichment })],
    )
    await settleClusterInterpretationRuns(database)
  } catch (error) {
    await database.query(
      `UPDATE analysis_runs SET status = 'failed', stage = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1`,
      [runId, error instanceof Error ? error.message : 'Analysis pipeline failed.'],
    )
  }
}

const runColumns = `id, project_id AS "projectId", objective, configuration, status, stage,
  pipeline_version AS "pipelineVersion", counts, quality_report AS "qualityReport", error_message AS "errorMessage",
  created_at AS "createdAt", started_at AS "startedAt", completed_at AS "completedAt"`

type AnalysisRunRecord = Record<string, unknown> & { id: string; status: string }

async function attachLlmProgress(database: Database, run: AnalysisRunRecord) {
  const jobs = await database.query<{
    total: number
    queued: number
    waiting: number
    inFlight: number
    succeeded: number
    fallback: number
    failed: number
    provider: string | null
    model: string | null
    updatedAt: string | null
  }>(
    `SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE state = 'queued')::int AS queued,
      COUNT(*) FILTER (WHERE state IN ('budget_wait','rate_wait','retry_wait'))::int AS waiting,
      COUNT(*) FILTER (WHERE state IN ('leased','running'))::int AS "inFlight",
      COUNT(*) FILTER (WHERE state = 'succeeded')::int AS succeeded,
      COUNT(*) FILTER (WHERE state = 'fallback_completed')::int AS fallback,
      COUNT(*) FILTER (WHERE state IN ('dead_lettered','cancelled'))::int AS failed,
      MIN(provider) AS provider, MIN(model) AS model, MAX(updated_at) AS "updatedAt"
     FROM llm_jobs WHERE analysis_run_id = $1`,
    [run.id],
  )
  const counts = jobs.rows[0]
  if (!counts || counts.total === 0) return { ...run, llmProgress: null }
  const themes = await database.query<{ validated: number; interpreted: number }>(
    `SELECT COUNT(*) FILTER (WHERE validation->>'status' = 'validated')::int AS validated,
      COUNT(*) FILTER (WHERE validation->>'status' = 'validated' AND validation ? 'interpretationCandidate')::int AS interpreted
     FROM themes WHERE analysis_run_id = $1`,
    [run.id],
  )
  const completed = counts.succeeded + counts.fallback + counts.failed
  const validatedThemes = themes.rows[0]?.validated ?? 0
  const interpretedThemes = themes.rows[0]?.interpreted ?? 0
  return {
    ...run,
    llmProgress: {
      ...counts,
      completed,
      remaining: Math.max(0, counts.total - completed),
      percent: Math.min(100, Math.round((completed / counts.total) * 100)),
      validatedThemes,
      interpretedThemes,
      coverage: validatedThemes > 0 ? interpretedThemes / validatedThemes : 0,
    },
  }
}

export async function getAnalysisRun(database: Database, runId: string) {
  const result = await database.query<AnalysisRunRecord>(`SELECT ${runColumns} FROM analysis_runs WHERE id = $1`, [runId])
  return result.rows[0] ? attachLlmProgress(database, result.rows[0]) : null
}

export async function listAnalysisRuns(database: Database, projectId: string) {
  const result = await database.query<AnalysisRunRecord>(`SELECT ${runColumns} FROM analysis_runs WHERE project_id = $1 ORDER BY created_at DESC, id DESC`, [projectId])
  return Promise.all(result.rows.map((run) => run.status === 'interpreting_clusters' ? attachLlmProgress(database, run) : { ...run, llmProgress: null }))
}

export async function listAnalysisRunReviews(database: Database, runId: string, status?: string, reason?: string, limit = 200) {
  const parameters: unknown[] = [runId]
  const conditions = ['arr.analysis_run_id = $1']
  if (status) {
    parameters.push(status)
    conditions.push(`arr.inclusion_status = $${parameters.length}`)
  }
  if (reason) {
    parameters.push(reason)
    conditions.push(`arr.exclusion_reason = $${parameters.length}`)
  }
  parameters.push(limit)
  const result = await database.query(
    `SELECT arr.review_id AS "reviewId", arr.inclusion_status AS "inclusionStatus", arr.exclusion_reason AS "exclusionReason",
      arr.normalized_text AS "normalizedText", arr.preprocessing_version AS "preprocessingVersion",
      r.body_original AS "originalText", r.rating_value AS "ratingValue", r.language, r.entity_name AS "entityName"
     FROM analysis_run_reviews arr JOIN reviews r ON r.id = arr.review_id
     WHERE ${conditions.join(' AND ')} ORDER BY arr.review_id ASC LIMIT $${parameters.length}`,
    parameters,
  )
  return result.rows
}
