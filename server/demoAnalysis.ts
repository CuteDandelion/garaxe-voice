import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Database, DatabaseClient } from './database'
import { ANALYSIS_PIPELINE_VERSION, createAnalysisRun, type AnalysisConfiguration } from './analysisRuns'
import { clusterInterpretationPolicyFromEnv, dominantActionableCategory, LLM_INTERPRETED_ENGINE_VERSION } from './clusterInterpretation'
import { getVoiceMapArtifact } from './voiceMapRepository'
import { getCurationProjection, type CurationProjection } from './curation'
import { canonicalOutcome, type CanonicalCategory } from './canonicalOutcome'
import { DEMO_COMMENT_ALLOWANCE, CsvValidationError, parseCsv, preflightCsv, validateImportRow, type CanonicalField, type ColumnMapping, type CsvRow } from '../src/lib/csv'

export { DEMO_COMMENT_ALLOWANCE }

export const DEMO_RETENTION_MS = 24 * 60 * 60 * 1_000
export const DEMO_MAX_STARTS_PER_HOUR = 20
export const DEMO_MAX_INPUT_BYTES = 16 * 1024
export const DEMO_MIN_REVIEWS = 1
export const DEMO_MAX_REVIEWS = DEMO_COMMENT_ALLOWANCE
export const DEMO_QUOTA_COOLDOWN_MS = 8 * 60 * 60 * 1_000
export const DEMO_MAX_CURATION_ACTIONS = 50
export const DEMO_DEFAULT_CLIENT_STARTS_PER_HOUR = 3
export const DEMO_DEFAULT_GLOBAL_ACTIVE_RUNS = 2
export const DEMO_DEFAULT_CLIENT_ACTIVE_RUNS = 1

export const demoAnalysisSchemaSql = `
CREATE TABLE IF NOT EXISTS demo_analysis_sessions (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  analysis_run_id UUID NOT NULL UNIQUE REFERENCES analysis_runs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS demo_analysis_sessions_expiry_idx ON demo_analysis_sessions(expires_at);
CREATE INDEX IF NOT EXISTS demo_analysis_sessions_created_idx ON demo_analysis_sessions(created_at);
`

export const demoAdmissionSchemaSql = `
ALTER TABLE demo_analysis_sessions ADD COLUMN IF NOT EXISTS client_key TEXT NOT NULL DEFAULT 'legacy';
CREATE INDEX IF NOT EXISTS demo_analysis_sessions_client_created_idx ON demo_analysis_sessions(client_key, created_at);
`

export class DemoAnalysisError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message)
  }
}

const configuration: AnalysisConfiguration = {
  objective: 'full_voice_map', entities: [], ratings: [], languages: [], writtenOnly: true, minTextLength: 3,
}

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

export type DemoAnalysisSession = {
  id: string
  token: string
  organizationId: string
  projectId: string
  analysisRunId: string
  createdAt: string
  expiresAt: string
}

type DemoImportSummary = { addedRecords: number; duplicateRecords: number; notImportedRecords: number }

export type DemoAnalysisStatus = Omit<DemoAnalysisSession, 'token'> & {
  status: string
  stage: string
  counts: Record<string, unknown>
  qualityReport: Record<string, unknown> | null
  errorMessage: string | null
  quota: DemoQuota
}

export type DemoQuota = { remaining: number; resetAt: string | null; freshDemoAvailable: boolean }

function demoMappedValue(row: CsvRow, mapping: ColumnMapping, field: CanonicalField) {
  const column = Object.keys(mapping).find((header) => mapping[header] === field)
  return column ? row[column]?.trim() || null : null
}

function parseDemoCsv(input: { fileName?: unknown; rawCsv?: unknown; mapping?: unknown }, minRows = DEMO_MIN_REVIEWS, maxRows = DEMO_MAX_REVIEWS) {
  if (typeof input.fileName !== 'string' || !input.fileName.toLowerCase().endsWith('.csv') || typeof input.rawCsv !== 'string' || !input.mapping || typeof input.mapping !== 'object') {
    throw new DemoAnalysisError('DEMO_INPUT_INVALID', 'Choose a CSV file and complete its column mapping before starting the demo.', 400)
  }
  if (Buffer.byteLength(input.rawCsv, 'utf8') > DEMO_MAX_INPUT_BYTES) {
    throw new DemoAnalysisError('DEMO_INPUT_TOO_LARGE', `Demo feedback is limited to ${DEMO_MAX_INPUT_BYTES / 1024} KB.`, 413)
  }
  try {
    const parsed = parseCsv(input.rawCsv)
    const mapping = input.mapping as ColumnMapping
    const preflight = preflightCsv(parsed, mapping)
    if (!preflight.valid) throw new DemoAnalysisError('DEMO_INPUT_INVALID', [...preflight.columnErrors, ...preflight.rowErrors].map((item) => item.message).join(' '), 400)
    if (parsed.rows.length < minRows || parsed.rows.length > maxRows
      || parsed.rows.some((row) => { const text = demoMappedValue(row, mapping, 'review_text') || ''; return text.length < 20 || text.length > 1_000 })) {
      const rowRange = Number.isFinite(maxRows) ? `${minRows} to ${maxRows} CSV rows` : `at least ${minRows} CSV row`
      throw new DemoAnalysisError('DEMO_INPUT_INVALID', `Provide ${rowRange}, each with 20 to 1,000 characters of comment text.`, 400)
    }
    return { ...parsed, mapping, fileName: input.fileName, rawCsv: input.rawCsv }
  } catch (error) {
    if (error instanceof DemoAnalysisError) throw error
    throw new DemoAnalysisError('DEMO_INPUT_INVALID', error instanceof CsvValidationError ? error.message : 'The CSV could not be read.', 400)
  }
}

async function storeDemoCsv(transaction: DatabaseClient, projectId: string, imported: ReturnType<typeof parseDemoCsv>, createdAt: string, capacity = DEMO_COMMENT_ALLOWANCE) {
  const importJobId = randomUUID()
  await transaction.query(
    `INSERT INTO import_jobs
      (id, project_id, file_name, status, total_rows, processed_rows, usable_rows, written_rows,
       source_media_type, source_encoding, source_content, source_hash, created_at, completed_at)
     VALUES ($1,$2,$3,'completed',$4,$4,0,0,'text/csv','utf8',$5,$6,$7,$7)`,
    [importJobId, projectId, imported.fileName, imported.rows.length, Buffer.from(imported.rawCsv), digest(imported.rawCsv), createdAt],
  )
  const seenExternalIds = new Set<string>()
  let addedRecords = 0
  let duplicateRecords = 0
  let notImportedRecords = 0
  for (const [index, row] of imported.rows.entries()) {
    const validation = validateImportRow(row, imported.mapping)
    if (!validation.valid) throw new DemoAnalysisError('DEMO_INPUT_INVALID', 'The CSV changed after validation.', 400)
    if (seenExternalIds.has(validation.externalId)) { duplicateRecords += 1; continue }
    seenExternalIds.add(validation.externalId)
    const existing = await transaction.query('SELECT 1 FROM reviews WHERE project_id = $1 AND external_review_id = $2 LIMIT 1', [projectId, validation.externalId])
    if (existing.rows[0]) { duplicateRecords += 1; continue }
    if (addedRecords >= capacity) { notImportedRecords += 1; continue }
    const sourceRecordId = randomUUID()
    const payload = { ...row, demo: true, row: index + 2 }
    await transaction.query(
      `INSERT INTO review_source_records
        (id, import_job_id, project_id, row_number, raw_payload, payload_hash, imported_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [sourceRecordId, importJobId, projectId, index + 2, JSON.stringify(payload), digest(JSON.stringify(payload)), createdAt],
    )
    const reviewText = validation.text
    const inserted = await transaction.query(
      `INSERT INTO reviews
        (id, project_id, source_record_id, external_review_id, provider, entity_name, rating_value, rating_scale,
         body_original, language, source_created_at, canonical_hash, metadata, imported_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, 5),$9,$10,$11,$12,$13,$14)
       ON CONFLICT (project_id, canonical_hash) DO NOTHING RETURNING id`,
      [randomUUID(), projectId, sourceRecordId, validation.externalId, validation.source,
        demoMappedValue(row, imported.mapping, 'entity'), validation.rating, validation.ratingScale, reviewText,
        demoMappedValue(row, imported.mapping, 'language'), validation.reviewDate && /^\d{4}-\d{2}-\d{2}$/.test(validation.reviewDate)
          ? `${validation.reviewDate}T00:00:00Z` : validation.reviewDate || null,
        digest(`${validation.externalId}\0${reviewText}`), JSON.stringify({ demo: true }), createdAt],
    )
    if (inserted.rows[0]) addedRecords += 1
    else duplicateRecords += 1
  }
  await transaction.query(
    `UPDATE import_jobs SET usable_rows = $2, written_rows = $2, duplicate_rows = $3 WHERE id = $1`,
    [importJobId, addedRecords, duplicateRecords],
  )
  return { addedRecords, duplicateRecords, notImportedRecords }
}

async function demoQuota(database: DatabaseClient, projectId: string, now: Date): Promise<DemoQuota> {
  const result = await database.query<{ count: number; latest: string | null }>(
    `SELECT COUNT(*)::int AS count, MAX(imported_at)::text AS latest FROM reviews WHERE project_id = $1`, [projectId],
  )
  const count = Number(result.rows[0]?.count || 0)
  const used = count % DEMO_COMMENT_ALLOWANCE
  if (used > 0 || count === 0) return { remaining: DEMO_COMMENT_ALLOWANCE - used, resetAt: null, freshDemoAvailable: false }
  const resetAt = new Date(new Date(result.rows[0]!.latest!).getTime() + DEMO_QUOTA_COOLDOWN_MS)
  return now.getTime() < resetAt.getTime()
    ? { remaining: 0, resetAt: resetAt.toISOString(), freshDemoAvailable: false }
    : { remaining: 0, resetAt: null, freshDemoAvailable: true }
}

export async function createDemoAnalysisSession(
  database: Database,
  input: { fileName?: unknown; rawCsv?: unknown; mapping?: unknown; clientKey?: string },
  environment: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<DemoAnalysisSession & DemoImportSummary> {
  const imported = parseDemoCsv(input, DEMO_MIN_REVIEWS, Number.POSITIVE_INFINITY)
  if (!clusterInterpretationPolicyFromEnv(environment)) {
    throw new DemoAnalysisError('DEMO_ANALYSIS_UNAVAILABLE', 'Voice Map intelligence is not available right now.', 503)
  }
  await cleanupExpiredDemoAnalysisSessions(database, now)
  const positiveLimit = (name: string, fallback: number) => {
    const value = Number(environment[name] || fallback)
    return Number.isSafeInteger(value) && value > 0 ? value : fallback
  }
  const clientKey = input.clientKey?.trim() || digest('unidentified-client')
  const clientStartsPerHour = positiveLimit('GARAXE_DEMO_CLIENT_STARTS_PER_HOUR', DEMO_DEFAULT_CLIENT_STARTS_PER_HOUR)
  const globalActiveLimit = positiveLimit('GARAXE_DEMO_GLOBAL_ACTIVE_RUNS', DEMO_DEFAULT_GLOBAL_ACTIVE_RUNS)
  const clientActiveLimit = positiveLimit('GARAXE_DEMO_CLIENT_ACTIVE_RUNS', DEMO_DEFAULT_CLIENT_ACTIVE_RUNS)

  const sessionId = randomUUID()
  const organizationId = randomUUID()
  const projectId = randomUUID()
  const analysisRunId = randomUUID()
  const token = randomBytes(32).toString('base64url')
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + DEMO_RETENTION_MS).toISOString()

  let importSummary = { addedRecords: 0, duplicateRecords: 0, notImportedRecords: 0 }
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['voice-lab-demo-admission'])
    const limits = await transaction.query<{ recent: number; clientRecent: number; active: number; clientActive: number }>(
      `SELECT
        COUNT(*) FILTER (WHERE d.created_at >= $1)::int AS recent,
        COUNT(*) FILTER (WHERE d.client_key = $2 AND d.created_at >= $1)::int AS "clientRecent",
        COUNT(*) FILTER (WHERE r.status NOT IN ('completed','failed'))::int AS active,
        COUNT(*) FILTER (WHERE d.client_key = $2 AND r.status NOT IN ('completed','failed'))::int AS "clientActive"
       FROM demo_analysis_sessions d JOIN analysis_runs r ON r.id = d.analysis_run_id`,
      [new Date(now.getTime() - 60 * 60 * 1_000).toISOString(), clientKey],
    )
    const current = limits.rows[0] || { recent: 0, clientRecent: 0, active: 0, clientActive: 0 }
    if (current.recent >= DEMO_MAX_STARTS_PER_HOUR || current.clientRecent >= clientStartsPerHour) {
      throw new DemoAnalysisError('DEMO_RATE_LIMITED', 'This demo client has reached its hourly run limit. Try again later.', 429)
    }
    if (current.active >= globalActiveLimit || current.clientActive >= clientActiveLimit) {
      throw new DemoAnalysisError('DEMO_CONCURRENCY_LIMITED', 'The public demo is already processing its active run limit. Try again after a run finishes.', 429)
    }
    const latest = await transaction.query<{ projectId: string }>(
      `SELECT project_id AS "projectId" FROM demo_analysis_sessions
       WHERE client_key = $1 ORDER BY created_at DESC LIMIT 1`, [clientKey],
    )
    if (latest.rows[0]) {
      const quota = await demoQuota(transaction, latest.rows[0].projectId, now)
      if (quota.remaining === 0 && !quota.freshDemoAvailable) {
        throw new DemoAnalysisError('DEMO_CAPACITY_EXCEEDED', `This demo reached ${DEMO_COMMENT_ALLOWANCE} accepted comments. A new demo is available after ${quota.resetAt}.`, 429)
      }
    }
    await transaction.query('INSERT INTO organizations (id, name, created_at) VALUES ($1,$2,$3)', [organizationId, 'Voice Map temporary demo', createdAt])
    await transaction.query('INSERT INTO projects (id, name, primary_decision, created_at) VALUES ($1,$2,$3,$4)', [projectId, 'Temporary Voice Map demo', 'sample analysis', createdAt])
    await transaction.query('INSERT INTO project_organizations (project_id, organization_id, created_at) VALUES ($1,$2,$3)', [projectId, organizationId, createdAt])
    importSummary = await storeDemoCsv(transaction, projectId, imported, createdAt)
    await transaction.query(
      `INSERT INTO analysis_runs
        (id, project_id, objective, configuration, status, stage, pipeline_version, created_at)
       VALUES ($1,$2,$3,$4,'queued','queued',$5,$6)`,
      [analysisRunId, projectId, configuration.objective, JSON.stringify(configuration), ANALYSIS_PIPELINE_VERSION, createdAt],
    )
    await transaction.query(
      `INSERT INTO demo_analysis_sessions
        (id, token_hash, organization_id, project_id, analysis_run_id, client_key, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [sessionId, digest(token), organizationId, projectId, analysisRunId, clientKey, createdAt, expiresAt],
    )
  })
  return { id: sessionId, token, organizationId, projectId, analysisRunId, createdAt, expiresAt, ...importSummary }
}

export async function appendDemoAnalysisSessionCsv(
  database: Database,
  token: string,
  input: { fileName?: unknown; rawCsv?: unknown; mapping?: unknown },
  environment: NodeJS.ProcessEnv = process.env,
  now = new Date(),
) {
  const imported = parseDemoCsv(input, 1, Number.POSITIVE_INFINITY)
  if (!clusterInterpretationPolicyFromEnv(environment)) throw new DemoAnalysisError('DEMO_ANALYSIS_UNAVAILABLE', 'Voice Map intelligence is not available right now.', 503)
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DemoAnalysisError('DEMO_SESSION_NOT_FOUND', 'The demo session was not found or has expired.', 404)
  return database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-lab-demo:${digest(token)}`])
    const session = await transaction.query<DemoAnalysisSession & { status: string }>(
      `SELECT d.id, d.organization_id AS "organizationId", d.project_id AS "projectId", d.analysis_run_id AS "analysisRunId",
        d.created_at AS "createdAt", d.expires_at AS "expiresAt", r.status
       FROM demo_analysis_sessions d JOIN analysis_runs r ON r.id = d.analysis_run_id
       WHERE d.token_hash = $1 AND d.expires_at > $2 FOR UPDATE OF d`, [digest(token), now.toISOString()],
    )
    const current = session.rows[0]
    if (!current) throw new DemoAnalysisError('DEMO_SESSION_NOT_FOUND', 'The demo session was not found or has expired.', 404)
    if (current.status !== 'completed') throw new DemoAnalysisError('DEMO_ANALYSIS_ACTIVE', 'Wait for the current demo analysis to finish before adding another CSV.', 409)
    const quotaBefore = await demoQuota(transaction, current.projectId, now)
    const importSummary = await storeDemoCsv(transaction, current.projectId, imported, now.toISOString(), quotaBefore.remaining)
    if (importSummary.addedRecords === 0) {
      if (!importSummary.notImportedRecords) return { ...current, token, ...importSummary, quota: quotaBefore }
      if (quotaBefore.freshDemoAvailable) throw new DemoAnalysisError('DEMO_SESSION_EXHAUSTED', 'This temporary demo is complete. Start a new demo for the next allowance.', 409)
      throw new DemoAnalysisError('DEMO_CAPACITY_EXCEEDED', `This demo reached ${DEMO_COMMENT_ALLOWANCE} accepted comments. More can be added after ${quotaBefore.resetAt}.`, 429)
    }
    const run = await createAnalysisRun(transaction, current.projectId, configuration)
    await transaction.query('UPDATE demo_analysis_sessions SET analysis_run_id = $2 WHERE id = $1', [current.id, run.id])
    return { ...current, token, analysisRunId: run.id, ...importSummary, quota: await demoQuota(transaction, current.projectId, now) }
  })
}

export async function getDemoAnalysisSession(database: Database, token: string, now = new Date()): Promise<DemoAnalysisStatus | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const result = await database.query<DemoAnalysisStatus>(
    `SELECT d.id, d.organization_id AS "organizationId", d.project_id AS "projectId",
      d.analysis_run_id AS "analysisRunId", d.created_at AS "createdAt", d.expires_at AS "expiresAt",
      r.status, r.stage, r.counts, r.quality_report AS "qualityReport", r.error_message AS "errorMessage"
     FROM demo_analysis_sessions d JOIN analysis_runs r ON r.id = d.analysis_run_id
     WHERE d.token_hash = $1 AND d.expires_at > $2`,
    [digest(token), now.toISOString()],
  )
  return result.rows[0] ? { ...result.rows[0], quota: await demoQuota(database, result.rows[0].projectId, now) } : null
}

export function demoRunUsesOpenCode(session: Pick<DemoAnalysisStatus, 'status' | 'qualityReport'>) {
  const interpretation = session.qualityReport?.clusterInterpretation
  if (!interpretation || typeof interpretation !== 'object' || Array.isArray(interpretation)) return false
  const state = interpretation as Record<string, unknown>
  const jobs = state.jobs as Record<string, unknown> | undefined
  const emergingSignals = state.emergingSignals as Record<string, unknown> | undefined
  const categorizedTotal = Number(emergingSignals?.total)
  const categorizedCount = Number(emergingSignals?.interpreted)
  return session.status === 'completed'
    && (state.state === 'completed' || state.state === 'partial_fallback')
    && state.engineVersion === LLM_INTERPRETED_ENGINE_VERSION
    && Number(jobs?.failed || 0) === 0
    && categorizedTotal > 0
    && categorizedCount === categorizedTotal
    && Number(emergingSignals?.coverage) === 1
}

type PublicDemoTheme = {
  id: string
  name: string
  topic: string
  summary: string
  type: string
  signalTypes: string[]
  categories: string[]
  confidence: string
  origin: 'model_confirmed' | 'user_curated'
  evidence: Array<Record<string, unknown>>
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function isPublishableDemoTheme(theme: Record<string, unknown>) {
  const validation = record(theme.validation) ? theme.validation : {}
  const candidate = record(validation.interpretationCandidate) ? validation.interpretationCandidate : null
  return validation.status === 'validated' && candidate?.publicationAction === 'publish' && candidate.groupingAction !== 'split'
}

export function publicDemoCurationProjection(projection: CurationProjection): CurationProjection {
  const publicTheme = (theme: CurationProjection['effectiveThemes'][number]) => ({
    ...theme,
    evidence: theme.evidence.map((item) => ({ ...item, provider: 'Demo submission' })),
  })
  return { ...projection, machineThemes: projection.machineThemes.map(publicTheme), effectiveThemes: projection.effectiveThemes.map(publicTheme) }
}

export type AnalysisCoverageItem = {
  reviewId: string
  originalText: string
  source: { provider: string; entity: string | null; rating: number | null; ratingScale: number | null; language: string | null; sourceCreatedAt: string | null; sourceUrl: string | null }
  disposition: 'recurring' | 'emerging' | 'user_curated' | 'error' | 'excluded'
  reason: string
  themeIds: string[]
  signals: Array<{ label: string; topic: string | null; signalType: string; signalTypes: string[]; category: ActionableCategory; categories: ActionableCategory[]; sentiment: 'positive' | 'neutral' | 'negative'; confidence: number; quote: string; interpretedBy: 'analysis_engine' | 'deterministic' }>
}

export type ActionableCategory = CanonicalCategory

export function actionableCategory(signalType: string): ActionableCategory {
  if (signalType === 'objection') return 'objection'
  if (signalType === 'emotion') return 'emotion'
  if (['desired_outcome', 'praise', 'purchase_trigger'].includes(signalType)) return 'desired_outcome'
  if (signalType === 'feature_request') return 'desired_outcome'
  if (signalType === 'pain' || signalType === 'operational_issue') return 'pain'
  return 'other'
}

export function actionableCategories(signalTypes: string[], evidence = '') {
  const normalized = signalTypes.map((signalType) => signalType === 'operational_issue' ? 'pain'
    : ['feature_request', 'purchase_trigger', 'praise'].includes(signalType) ? 'desired_outcome' : signalType)
  return [dominantActionableCategory(normalized, evidence)]
}

export function dominantCoverageSignals<T extends { interpretedBy: 'analysis_engine' | 'deterministic' }>(signals: T[], aspectMode = false) {
  const interpreted = signals.filter((signal) => signal.interpretedBy === 'analysis_engine')
  const selected = interpreted.length ? interpreted : signals
  return aspectMode ? selected : selected.slice(0, 1)
}

function interpretedSignalTypes(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const signalTypes = (value as Record<string, unknown>).signalTypes
  return Array.isArray(signalTypes) ? signalTypes.filter((item): item is string => typeof item === 'string') : []
}

export async function getAnalysisCoverage(database: Database, runId: string): Promise<AnalysisCoverageItem[]> {
  const run = await database.query<{ aspectSemantics: boolean }>(
    `SELECT COALESCE((quality_report->'categoryFirstProjection'->>'aspectSemantics')::boolean, false) AS "aspectSemantics"
     FROM analysis_runs WHERE id = $1`, [runId],
  )
  const aspectMode = run.rows[0]?.aspectSemantics === true
  const reviews = await database.query<{ reviewId: string; originalText: string; inclusionStatus: string; exclusionReason: string | null; provider: string; entity: string | null; rating: number | null; ratingScale: number | null; language: string | null; sourceCreatedAt: string | null; sourceUrl: string | null }>(
    `SELECT arr.review_id AS "reviewId", COALESCE(r.body_original, '') AS "originalText", arr.inclusion_status AS "inclusionStatus", arr.exclusion_reason AS "exclusionReason",
      r.provider, r.entity_name AS entity, r.rating_value AS rating, r.rating_scale AS "ratingScale", r.language,
      r.source_created_at AS "sourceCreatedAt", r.source_url AS "sourceUrl"
     FROM analysis_run_reviews arr JOIN reviews r ON r.id = arr.review_id WHERE arr.analysis_run_id = $1 ORDER BY r.imported_at, r.id`, [runId],
  )
  const signals = await database.query<{ id: string; reviewId: string; label: string; signalType: string; confidence: number; quote: string; attributes: Record<string, unknown>; interpretedBy: 'analysis_engine' | 'deterministic' }>(
    `SELECT id, review_id AS "reviewId", label, signal_type AS "signalType", confidence, quote_text AS quote, attributes,
      CASE WHEN attributes ? 'canonicalOutcome' OR attributes ? 'emergingInterpretation' THEN 'analysis_engine' ELSE 'deterministic' END AS "interpretedBy"
     FROM review_signals WHERE analysis_run_id = $1 ORDER BY review_id, confidence DESC, id`, [runId],
  )
  const evidence = await database.query<{ signalId: string; reviewId: string; themeId: string; reviewCount: number; validation: Record<string, unknown> }>(
    `SELECT DISTINCT te.signal_id AS "signalId", te.review_id AS "reviewId", t.id AS "themeId",
      COALESCE((t.metrics->>'independentReviewCount')::int, 0) AS "reviewCount", t.validation
     FROM theme_evidence te JOIN themes t ON t.id = te.theme_id WHERE t.analysis_run_id = $1`, [runId],
  )
  const signalsByReview = new Map<string, typeof signals.rows>()
  for (const signal of signals.rows) signalsByReview.set(signal.reviewId, [...(signalsByReview.get(signal.reviewId) || []), signal])
  const curatedThemes = (await getCurationProjection(database, runId)).effectiveThemes.filter((theme) => theme.origin === 'user_curated' && theme.status !== 'consumed')
  return reviews.rows.map((review) => {
    const source = { provider: review.provider, entity: review.entity, rating: review.rating, ratingScale: review.ratingScale, language: review.language, sourceCreatedAt: review.sourceCreatedAt, sourceUrl: review.sourceUrl }
    const reviewSignals = dominantCoverageSignals(signalsByReview.get(review.reviewId) || [], aspectMode)
    const categorizedSignals = reviewSignals.map(({ attributes, id, ...signal }) => {
      const linkedInterpretation = evidence.rows.find((item) => item.signalId === id)?.validation?.interpretationCandidate
      const persistedOutcome = attributes.canonicalOutcome || attributes.emergingInterpretation
      const outcome = canonicalOutcome(persistedOutcome)
      const emergingTypes = outcome?.signalTypes || interpretedSignalTypes(persistedOutcome)
      const linkedTypes = interpretedSignalTypes(linkedInterpretation)
      const signalTypes = emergingTypes.length ? emergingTypes : linkedTypes.length ? linkedTypes : [signal.signalType]
      const categories = outcome
        ? [outcome.primaryCategory]
        : actionableCategories(signalTypes, signal.quote)
      const individualInterpretation = persistedOutcome
      const label = outcome?.label || (individualInterpretation && typeof individualInterpretation === 'object' && typeof (individualInterpretation as Record<string, unknown>).label === 'string'
        ? String((individualInterpretation as Record<string, unknown>).label)
        : linkedInterpretation && typeof linkedInterpretation === 'object' && typeof (linkedInterpretation as Record<string, unknown>).label === 'string'
          ? String((linkedInterpretation as Record<string, unknown>).label) : signal.label)
      return { ...signal, label, topic: outcome?.topic || null, sentiment: outcome?.sentiment || 'neutral',
        signalType: outcome?.primarySignalType || signal.signalType,
        signalTypes, categories, category: categories[0] || actionableCategory(signal.signalType) }
    })
    if (review.inclusionStatus === 'excluded') return { reviewId: review.reviewId, originalText: review.originalText, source, disposition: 'excluded' as const, reason: review.exclusionReason || 'Excluded by the immutable dataset configuration.', themeIds: [], signals: [] }
    const curated = curatedThemes.filter((theme) => theme.evidence.some((item) => item.reviewId === review.reviewId))
    if (curated.length) return { reviewId: review.reviewId, originalText: review.originalText, source, disposition: 'user_curated' as const, reason: 'Moved by a person during Curation.', themeIds: curated.map((theme) => theme.id), signals: categorizedSignals }
    const linked = evidence.rows.filter((item) => item.reviewId === review.reviewId)
    const published = linked.filter((item) => isPublishableDemoTheme({ validation: item.validation }))
    const recurring = published.filter((item) => item.reviewCount >= 2)
    if (recurring.length) return { reviewId: review.reviewId, originalText: review.originalText, source, disposition: 'recurring' as const, reason: 'Recurring topic supported by more than one comment.', themeIds: recurring.map((item) => item.themeId), signals: categorizedSignals }
    if (reviewSignals.length) return { reviewId: review.reviewId, originalText: review.originalText, source, disposition: 'emerging' as const, reason: 'This comment has its own topic; more feedback may confirm recurrence.', themeIds: published.map((item) => item.themeId), signals: categorizedSignals }
    return { reviewId: review.reviewId, originalText: review.originalText, source, disposition: 'error' as const, reason: 'This input did not contain a supported feedback claim.', themeIds: [], signals: [] }
  })
}

export async function getDemoAnalysisResult(database: Database, session: DemoAnalysisStatus) {
  if (!demoRunUsesOpenCode(session)) return null
  const artifact = await getVoiceMapArtifact(database, session.analysisRunId)
  if (!artifact) return null
  const projection = await getCurationProjection(database, session.analysisRunId)
  const themes = projection.effectiveThemes
    .filter((theme) => !['consumed', 'rejected', 'not_reviewable'].includes(theme.status))
    .map((theme): PublicDemoTheme => ({
      id: theme.id,
      name: theme.name,
      topic: theme.topic,
      summary: theme.summary,
      type: theme.type,
      signalTypes: theme.signalTypes,
      categories: theme.categories,
      confidence: theme.confidence,
      origin: theme.origin,
      evidence: theme.evidence.filter((item) => !item.excluded).map((item) => ({ ...item, provider: 'Demo submission' })),
    }))
  return { engine: artifact.synthesisVersion, themes, coverage: await getAnalysisCoverage(database, session.analysisRunId) }
}

export async function buildDemoReportSnapshot(database: Database, session: DemoAnalysisStatus) {
  const result = await getDemoAnalysisResult(database, session)
  if (!result) throw new DemoAnalysisError('DEMO_REPORT_NOT_READY', 'The demo analysis has not completed successfully.', 409)
  const generatedAt = new Date().toISOString()
  const topTheme = result.themes[0]
  const evidence = result.themes.flatMap((theme) => theme.evidence)
  const ratings = new Map<number, number>()
  for (const item of evidence) {
    if (typeof item.rating === 'number') ratings.set(item.rating, (ratings.get(item.rating) || 0) + 1)
  }
  return {
    schemaVersion: 'demo-report-v2',
    demo: true,
    generatedAt,
    versions: { pipeline: ANALYSIS_PIPELINE_VERSION, synthesis: result.engine, report: 'demo-report-v2' },
    curation: { revision: 0 },
    dataset: { sourceCount: 1, counts: structuredClone(session.counts), qualityReport: structuredClone(session.qualityReport) },
    narrative: {
      headline: `DEMO: ${topTheme?.name || 'Voice Map analysis'}`,
      executiveSummary: topTheme?.summary || 'The live demo analysis completed using the same interpretation engine as the authenticated workspace.',
      provenance: { generator: 'ephemeral Voice Map demo', model: 'Voice Map intelligence' },
      opportunities: result.themes.filter((theme) => theme.type === 'praise').slice(0, 2).map((theme) => theme.name),
      risks: result.themes.filter((theme) => theme.type !== 'praise').slice(0, 2).map((theme) => theme.name),
      actions: result.themes.slice(0, 2).map((theme, index) => ({
        priority: index === 0 ? 'first' : 'next', title: theme.name, rationale: theme.summary,
        successMeasure: 'Validate against the linked submitted demo evidence.', themeIds: [theme.id],
      })),
    },
    charts: {
      themePrevalence: result.themes.map((theme) => ({ name: theme.name, reviewCount: new Set(theme.evidence.map((item) => item.reviewId)).size })),
      ratingDistribution: [...ratings].sort(([left], [right]) => left - right).map(([rating, count]) => ({ rating, count })),
      reviewTimeline: [],
    },
    themes: result.themes.map((theme) => ({ ...theme, evidence: theme.evidence.map((item) => ({ ...item, pinned: false })) })),
  }
}

export async function cleanupExpiredDemoAnalysisSessions(database: Database, now = new Date()) {
  const expired = await database.query<{ organizationId: string; projectId: string }>(
    `SELECT organization_id AS "organizationId", project_id AS "projectId"
     FROM demo_analysis_sessions WHERE expires_at <= $1`,
    [now.toISOString()],
  )
  if (expired.rows.length === 0) return 0
  await database.transaction(async (transaction) => {
    for (const item of expired.rows) {
      await transaction.query('DELETE FROM projects WHERE id = $1', [item.projectId])
      await transaction.query('DELETE FROM organizations WHERE id = $1', [item.organizationId])
    }
  })
  return expired.rows.length
}
