import { randomUUID } from 'node:crypto'
import type { Database } from './database'
import { getCurationProjection, type CuratedEvidence, type EffectiveTheme } from './curation'
import { generateReportNarrative } from './reportNarrative'

const REPORT_SCHEMA_VERSION = 'report-snapshot-v2'

type RunRow = {
  id: string
  projectId: string
  objective: string
  configuration: Record<string, unknown>
  status: string
  pipelineVersion: string
  counts: Record<string, unknown>
  qualityReport: Record<string, unknown> | null
  createdAt: string | Date
  completedAt: string | Date | null
}

type EvidenceDetail = {
  signalId: string
  reviewId: string
  quote: string
  quoteStart: number
  quoteEnd: number
  confidence: number
  originalText: string | null
  rating: number | null
  provider: string
  entity: string | null
  language: string | null
  sourceCreatedAt: string | Date | null
  sourceUrl: string | null
}

export class ReportError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message)
  }
}

function validateTitle(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new ReportError('REPORT_REQUEST_INVALID', 'Report title must be text.')
  const title = value.trim()
  if (!title || title.length > 160) throw new ReportError('REPORT_REQUEST_INVALID', 'Report title must contain 1 to 160 characters.')
  return title
}

async function loadRun(database: Database, runId: string): Promise<RunRow | null> {
  const result = await database.query<RunRow>(
    `SELECT id, project_id AS "projectId", objective, configuration, status,
      pipeline_version AS "pipelineVersion", counts, quality_report AS "qualityReport",
      created_at AS "createdAt", completed_at AS "completedAt"
     FROM analysis_runs WHERE id = $1`, [runId],
  )
  return result.rows[0] || null
}

async function loadEvidenceDetails(database: Database, runId: string) {
  const result = await database.query<EvidenceDetail>(
    `SELECT rs.id AS "signalId", rs.review_id AS "reviewId", rs.quote_text AS quote,
      rs.quote_start AS "quoteStart", rs.quote_end AS "quoteEnd", rs.confidence,
      r.body_original AS "originalText", r.rating_value AS rating, r.provider,
      r.entity_name AS entity, r.language, r.source_created_at AS "sourceCreatedAt", r.source_url AS "sourceUrl"
     FROM review_signals rs JOIN reviews r ON r.id = rs.review_id
     WHERE rs.analysis_run_id = $1 ORDER BY rs.id`, [runId],
  )
  return new Map(result.rows.map((item) => [item.signalId, item]))
}

function snapshotEvidence(evidence: CuratedEvidence[], details: Map<string, EvidenceDetail>) {
  return evidence
    .filter((item) => !item.excluded)
    .map((item) => {
      const detail = details.get(item.signalId)
      if (!detail) throw new ReportError('REPORT_EVIDENCE_MISSING', 'Curated evidence no longer resolves to its source review.', 409)
      if (detail.originalText?.slice(detail.quoteStart, detail.quoteEnd) !== detail.quote) {
        throw new ReportError('REPORT_EVIDENCE_INVALID', 'Curated evidence does not match the immutable source text.', 409)
      }
      return { ...structuredClone(detail), pinned: item.pinned }
    })
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.signalId.localeCompare(right.signalId))
}

function snapshotTheme(theme: EffectiveTheme, details: Map<string, EvidenceDetail>) {
  return {
    id: theme.id,
    machineThemeId: theme.machineThemeId,
    originThemeIds: [...theme.originThemeIds],
    rank: theme.rank,
    name: theme.name,
    summary: theme.summary,
    type: theme.type,
    sentiment: theme.sentiment,
    confidence: theme.confidence,
    evidence: snapshotEvidence(theme.evidence, details),
  }
}

function month(value: string | Date | null) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toISOString().slice(0, 7)
}

function chartData(themes: ReturnType<typeof snapshotTheme>[], details: Map<string, EvidenceDetail>) {
  const uniqueReviews = new Map<string, EvidenceDetail>()
  for (const detail of details.values()) if (!uniqueReviews.has(detail.reviewId)) uniqueReviews.set(detail.reviewId, detail)
  const ratings = new Map<number, number>()
  const timeline = new Map<string, number>()
  for (const review of uniqueReviews.values()) {
    if (review.rating !== null) ratings.set(review.rating, (ratings.get(review.rating) || 0) + 1)
    const key = month(review.sourceCreatedAt)
    timeline.set(key, (timeline.get(key) || 0) + 1)
  }
  return {
    ratingDistribution: [...ratings].sort(([left], [right]) => left - right).map(([rating, count]) => ({ rating, count })),
    reviewTimeline: [...timeline].sort(([left], [right]) => left.localeCompare(right)).map(([period, count]) => ({ period, count })),
    themePrevalence: themes.map((theme) => ({ themeId: theme.id, name: theme.name, reviewCount: new Set(theme.evidence.map((item) => item.reviewId)).size })),
  }
}

export async function createReportSnapshot(
  database: Database,
  input: { projectId?: unknown; analysisRunId?: unknown; title?: unknown },
) {
  const projectId = typeof input.projectId === 'string' ? input.projectId : ''
  const analysisRunId = typeof input.analysisRunId === 'string' ? input.analysisRunId : ''
  if (!projectId || !analysisRunId) throw new ReportError('REPORT_REQUEST_INVALID', 'Project and analysis run are required.')
  const title = validateTitle(input.title)
  const project = await database.query<{ name: string }>(`SELECT name FROM projects WHERE id = $1`, [projectId])
  if (!project.rows[0]) throw new ReportError('PROJECT_NOT_FOUND', 'Project not found.', 404)
  const run = await loadRun(database, analysisRunId)
  if (!run) throw new ReportError('ANALYSIS_RUN_NOT_FOUND', 'Analysis run not found.', 404)
  if (run.projectId !== projectId) throw new ReportError('REPORT_SCOPE_MISMATCH', 'Analysis run does not belong to this project.', 409)
  if (run.status !== 'completed') throw new ReportError('REPORT_ANALYSIS_NOT_READY', 'Analysis must complete before a report can be generated.', 409)

  const projection = await getCurationProjection(database, analysisRunId)
  if (!projection.session || !projection.readiness.isReady || projection.session.status !== 'ready') {
    throw new ReportError('REPORT_CURATION_NOT_READY', 'Curation must be marked ready before a report can be generated.', 409)
  }
  const publishableThemes = projection.effectiveThemes.filter((theme) => theme.publishable)
  if (publishableThemes.length === 0) throw new ReportError('REPORT_NO_PUBLISHABLE_THEMES', 'A ready report requires at least one publishable theme.', 409)

  const voiceMap = await database.query<{ artifact: Record<string, unknown>; synthesisVersion: string }>(
    `SELECT artifact, synthesis_version AS "synthesisVersion" FROM voice_maps WHERE analysis_run_id = $1`, [analysisRunId],
  )
  if (!voiceMap.rows[0]) throw new ReportError('REPORT_VOICE_MAP_NOT_READY', 'Voice Map synthesis is not available.', 409)
  const evidenceDetails = await loadEvidenceDetails(database, analysisRunId)
  const sourceCountResult = await database.query<{ count: number }>(
    `SELECT COUNT(DISTINCT r.provider)::int AS count
     FROM reviews r
     JOIN analysis_run_reviews arr ON arr.review_id = r.id
     WHERE arr.analysis_run_id = $1`,
    [analysisRunId],
  )
  const generatedAt = new Date().toISOString()
  const versionResult = await database.query<{ version: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM reports WHERE analysis_run_id = $1`, [analysisRunId],
  )
  const version = Number(versionResult.rows[0]?.version || 1)
  const id = randomUUID()
  const themes = publishableThemes.map((theme) => snapshotTheme(theme, evidenceDetails))
  const narrative = await generateReportNarrative({ projectName: project.rows[0].name, objective: run.objective, themes: publishableThemes }, { generatedAt })
  const snapshot = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    project: { id: projectId, name: project.rows[0].name },
    analysisRun: structuredClone(run),
    curation: {
      sessionId: projection.session.id,
      revision: projection.session.revision,
      readyAt: projection.session.readyAt,
    },
    versions: {
      pipeline: run.pipelineVersion,
      synthesis: voiceMap.rows[0].synthesisVersion,
      report: REPORT_SCHEMA_VERSION,
    },
    dataset: {
      counts: structuredClone(run.counts),
      qualityReport: structuredClone(run.qualityReport),
      sourceCount: Number(sourceCountResult.rows[0]?.count || 0),
    },
    narrative: {
      ...narrative,
      signals: publishableThemes.map((theme) => ({
        id: theme.id,
        rank: theme.rank,
        name: theme.name,
        summary: theme.summary,
        type: theme.type,
        sentiment: theme.sentiment,
        confidence: theme.confidence,
      })),
    },
    charts: chartData(themes, evidenceDetails),
    machineSynthesis: structuredClone(voiceMap.rows[0].artifact),
    themes,
  }
  const reportTitle = title || `${project.rows[0].name} Voice Map`
  await database.query(
    `INSERT INTO reports
      (id, project_id, analysis_run_id, curation_session_id, curation_revision, version, title, snapshot, generated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, projectId, analysisRunId, projection.session.id, projection.session.revision, version, reportTitle, JSON.stringify(snapshot), generatedAt],
  )
  return getReport(database, id)
}

const reportColumns = `id, project_id AS "projectId", analysis_run_id AS "analysisRunId",
  curation_session_id AS "curationSessionId", curation_revision AS "curationRevision",
  version, title, generated_at AS "generatedAt"`

export async function listReports(database: Database, projectId: string) {
  const result = await database.query(
    `SELECT ${reportColumns} FROM reports WHERE project_id = $1 ORDER BY generated_at DESC, id DESC`, [projectId],
  )
  return result.rows
}

export async function getReport(database: Database, reportId: string) {
  const result = await database.query(
    `SELECT ${reportColumns}, snapshot FROM reports WHERE id = $1`, [reportId],
  )
  return result.rows[0] || null
}
