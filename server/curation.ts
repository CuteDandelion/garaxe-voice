import { randomUUID } from 'node:crypto'
import type { Database } from './database'

export type CurationSessionStatus = 'draft' | 'ready'
export type CurationActionType =
  | 'approve_theme'
  | 'reject_theme'
  | 'edit_theme'
  | 'pin_evidence'
  | 'exclude_evidence'
  | 'merge_themes'
  | 'split_theme'
  | 'mark_ready'

export type CurationSession = {
  id: string
  analysisRunId: string
  status: CurationSessionStatus
  revision: number
  createdAt: string | Date
  readyAt: string | Date | null
}

export type CurationAction = {
  id: string
  sessionId: string
  analysisRunId: string
  sequence: number
  actionType: CurationActionType
  payload: Record<string, unknown>
  createdAt: string | Date
}

export type CuratedEvidence = {
  signalId: string
  reviewId: string
  quote: string
  quoteStart: number
  quoteEnd: number
  originalText: string
  entity: string | null
  provider: string
  rating: number | null
  sourceCreatedAt: string | Date | null
  confidence: number
  pinned: boolean
  excluded: boolean
}

export type EffectiveTheme = {
  id: string
  machineThemeId: string | null
  originThemeIds: string[]
  rank: number
  name: string
  summary: string
  type: string
  sentiment: string
  confidence: string
  validationStatus: string
  status: 'pending' | 'approved' | 'rejected' | 'consumed' | 'not_reviewable'
  evidence: CuratedEvidence[]
  groupingSuggestion: { action: 'split'; reason: string } | null
  publishable: boolean
}

export type CurationProjection = {
  session: CurationSession | null
  machineThemes: EffectiveTheme[]
  effectiveThemes: EffectiveTheme[]
  actions: CurationAction[]
  readiness: {
    validatedMachineThemes: number
    resolved: number
    pending: number
    approved: number
    rejected: number
    consumed: number
    publishable: number
    canMarkReady: boolean
    isReady: boolean
  }
}

type MachineThemeRow = {
  id: string
  rank: number
  name: string
  summary: string
  type: string
  sentiment: string
  confidence: string
  validation: Record<string, unknown>
}

type EvidenceRow = {
  themeId: string
  signalId: string
  reviewId: string
  quote: string
  quoteStart: number
  quoteEnd: number
  confidence: number
  originalText: string
  entity: string | null
  provider: string
  rating: number | null
  sourceCreatedAt: string | Date | null
}

type InterpretationCandidate = {
  label: string
  evaluation: 'praise' | 'pain' | 'mixed'
  rootCause: string | null
  consequence: string | null
  publicationAction: 'publish' | 'discard'
  groupingAction: 'keep' | 'split'
  groupingReason: string | null
}

function interpretationCandidate(validation: Record<string, unknown>): InterpretationCandidate | null {
  const value = validation.interpretationCandidate
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.label !== 'string' || !['praise', 'pain', 'mixed'].includes(String(candidate.evaluation))) return null
  return {
    label: candidate.label,
    evaluation: candidate.evaluation as InterpretationCandidate['evaluation'],
    rootCause: typeof candidate.rootCause === 'string' ? candidate.rootCause : null,
    consequence: typeof candidate.consequence === 'string' ? candidate.consequence : null,
    publicationAction: candidate.publicationAction === 'discard' ? 'discard' : 'publish',
    groupingAction: candidate.groupingAction === 'split' ? 'split' : 'keep',
    groupingReason: typeof candidate.groupingReason === 'string' ? candidate.groupingReason : null,
  }
}

function interpretedSummary(candidate: InterpretationCandidate | null, fallback: string) {
  if (!candidate) return fallback
  const parts = [
    candidate.rootCause ? `Root cause: ${candidate.rootCause.replace(/[.!?]+$/, '')}.` : null,
    candidate.consequence ? `Consequence: ${candidate.consequence.replace(/[.!?]+$/, '')}.` : null,
  ].filter((part): part is string => Boolean(part))
  return parts.join(' ') || fallback
}

type SplitGroup = { name: string; summary?: string; signalIds: string[] }

const actionTypes = new Set<CurationActionType>([
  'approve_theme', 'reject_theme', 'edit_theme', 'pin_evidence', 'exclude_evidence',
  'merge_themes', 'split_theme', 'mark_ready',
])

export class CurationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message)
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CurationError('CURATION_ACTION_INVALID', 'Action payload must be an object.')
  return value as Record<string, unknown>
}

function strictKeys(value: Record<string, unknown>, allowed: string[]) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length > 0) throw new CurationError('CURATION_ACTION_INVALID', `Unexpected action fields: ${unexpected.join(', ')}.`)
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new CurationError('CURATION_ACTION_INVALID', `${field} is required.`)
  return value.trim()
}

function optionalString(value: unknown, field: string) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) throw new CurationError('CURATION_ACTION_INVALID', `${field} must be a non-empty string.`)
  return value.trim()
}

function stringArray(value: unknown, field: string, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new CurationError('CURATION_ACTION_INVALID', `${field} must contain at least ${minimum} identifiers.`)
  }
  const result = value.map((item) => String(item).trim())
  if (new Set(result).size !== result.length) throw new CurationError('CURATION_ACTION_INVALID', `${field} cannot contain duplicates.`)
  return result
}

async function getSessionByRun(database: Database, runId: string) {
  const result = await database.query<CurationSession>(
    `SELECT id, analysis_run_id AS "analysisRunId", status, revision,
      created_at AS "createdAt", ready_at AS "readyAt"
     FROM curation_sessions WHERE analysis_run_id = $1`,
    [runId],
  )
  return result.rows[0] ?? null
}

async function getSession(database: Database, sessionId: string) {
  const result = await database.query<CurationSession>(
    `SELECT id, analysis_run_id AS "analysisRunId", status, revision,
      created_at AS "createdAt", ready_at AS "readyAt"
     FROM curation_sessions WHERE id = $1`,
    [sessionId],
  )
  return result.rows[0] ?? null
}

async function loadMachineThemes(database: Database, runId: string) {
  const voiceMap = await database.query<{ synthesisVersion: string }>(
    `SELECT synthesis_version AS "synthesisVersion" FROM voice_maps WHERE analysis_run_id = $1`,
    [runId],
  )
  const requiresPublishedInterpretation = voiceMap.rows[0]?.synthesisVersion === 'llm-interpreted-theme-engine-v1'
  const themes = await database.query<MachineThemeRow>(
    `SELECT id, rank, name, description AS summary, theme_type AS type, sentiment, confidence, validation
     FROM themes WHERE analysis_run_id = $1 ORDER BY rank, id`,
    [runId],
  )
  const evidence = await database.query<EvidenceRow>(
    `SELECT te.theme_id AS "themeId", rs.id AS "signalId", rs.review_id AS "reviewId",
      rs.quote_text AS quote, rs.quote_start AS "quoteStart", rs.quote_end AS "quoteEnd", rs.confidence,
      r.body_original AS "originalText", r.entity_name AS entity, r.provider, r.rating_value AS rating,
      r.source_created_at AS "sourceCreatedAt"
     FROM theme_evidence te
     JOIN themes t ON t.id = te.theme_id
     JOIN review_signals rs ON rs.id = te.signal_id
     JOIN reviews r ON r.id = te.review_id
     WHERE t.analysis_run_id = $1
     ORDER BY t.rank, te.is_representative DESC, rs.confidence DESC, rs.id`,
    [runId],
  )
  return themes.rows.flatMap((theme): EffectiveTheme[] => {
    const validationStatus = typeof theme.validation?.status === 'string' ? theme.validation.status : 'insufficient_evidence'
    const interpretation = interpretationCandidate(theme.validation)
    if (interpretation?.publicationAction === 'discard'
      || (requiresPublishedInterpretation && (!interpretation || interpretation.groupingAction === 'split'))) return []
    return [{
      id: theme.id,
      machineThemeId: theme.id,
      originThemeIds: [theme.id],
      rank: theme.rank,
      name: interpretation?.label || theme.name,
      summary: interpretedSummary(interpretation, theme.summary),
      type: interpretation?.evaluation === 'praise' ? 'praise' : interpretation?.evaluation === 'pain' ? 'pain_point' : theme.type,
      sentiment: interpretation?.evaluation === 'praise' ? 'positive' : interpretation?.evaluation === 'pain' ? 'negative' : theme.sentiment,
      confidence: theme.confidence,
      validationStatus,
      status: validationStatus === 'validated' ? 'pending' : 'not_reviewable',
      evidence: evidence.rows.filter((item) => item.themeId === theme.id).map((item) => ({
        signalId: item.signalId,
        reviewId: item.reviewId,
        quote: item.quote,
        quoteStart: item.quoteStart,
        quoteEnd: item.quoteEnd,
        originalText: item.originalText,
        entity: item.entity,
        provider: item.provider,
        rating: item.rating,
        sourceCreatedAt: item.sourceCreatedAt,
        confidence: item.confidence,
        pinned: false,
        excluded: false,
      })),
      groupingSuggestion: interpretation?.groupingAction === 'split' && interpretation.groupingReason
        ? { action: 'split', reason: interpretation.groupingReason }
        : null,
      publishable: false,
    }]
  })
}

export async function listCurationActions(database: Database, sessionId: string) {
  const result = await database.query<CurationAction>(
    `SELECT id, curation_session_id AS "sessionId", analysis_run_id AS "analysisRunId",
      sequence, action_type AS "actionType", payload, created_at AS "createdAt"
     FROM curation_actions WHERE curation_session_id = $1 ORDER BY sequence`,
    [sessionId],
  )
  return result.rows
}

function copyTheme(theme: EffectiveTheme): EffectiveTheme {
  return { ...theme, originThemeIds: [...theme.originThemeIds], evidence: theme.evidence.map((item) => ({ ...item })) }
}

function actionThemeId(action: CurationAction) {
  return String(action.payload.themeId || '')
}

function mergedEvidence(themes: EffectiveTheme[]) {
  const bySignal = new Map<string, CuratedEvidence>()
  for (const theme of themes) {
    for (const evidence of theme.evidence) {
      const incumbent = bySignal.get(evidence.signalId)
      if (!incumbent) bySignal.set(evidence.signalId, { ...evidence })
      else {
        incumbent.pinned ||= evidence.pinned
        incumbent.excluded &&= evidence.excluded
      }
    }
  }
  return [...bySignal.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.confidence - a.confidence || a.signalId.localeCompare(b.signalId))
}

function applyActions(machineThemes: EffectiveTheme[], actions: CurationAction[]) {
  const effective = new Map(machineThemes.map((theme) => [theme.id, copyTheme(theme)]))

  for (const action of actions) {
    if (action.actionType === 'mark_ready') continue
    if (action.actionType === 'merge_themes') {
      const ids = action.payload.themeIds as string[]
      const sources = ids.map((id) => effective.get(id)).filter((theme): theme is EffectiveTheme => Boolean(theme))
      for (const source of sources) source.status = 'consumed'
      const evidence = mergedEvidence(sources)
      effective.set(`curated:${action.id}`, {
        id: `curated:${action.id}`,
        machineThemeId: null,
        originThemeIds: ids,
        rank: Math.min(...sources.map((theme) => theme.rank)),
        name: String(action.payload.name || sources.map((theme) => theme.name).join(' + ')),
        summary: String(action.payload.summary || sources.map((theme) => theme.summary).join(' ')),
        type: sources[0]?.type || 'curated',
        sentiment: sources.every((theme) => theme.sentiment === sources[0]?.sentiment) ? sources[0]?.sentiment || 'mixed' : 'mixed',
        confidence: sources[0]?.confidence || 'Moderate',
        validationStatus: 'validated',
        status: 'approved',
        evidence,
        groupingSuggestion: null,
        publishable: evidence.some((item) => !item.excluded),
      })
      continue
    }
    if (action.actionType === 'split_theme') {
      const source = effective.get(actionThemeId(action))
      if (!source) continue
      source.status = 'consumed'
      const groups = action.payload.groups as SplitGroup[]
      groups.forEach((group, index) => {
        const wanted = new Set(group.signalIds)
        const evidence = source.evidence.filter((item) => wanted.has(item.signalId)).map((item) => ({ ...item }))
        effective.set(`curated:${action.id}:${index + 1}`, {
          ...copyTheme(source),
          id: `curated:${action.id}:${index + 1}`,
          machineThemeId: null,
          originThemeIds: [source.id],
          rank: source.rank + ((index + 1) / 100),
          name: group.name,
          summary: group.summary || source.summary,
          status: 'approved',
          evidence,
          groupingSuggestion: null,
          publishable: evidence.some((item) => !item.excluded),
        })
      })
      continue
    }

    const theme = effective.get(actionThemeId(action))
    if (!theme) continue
    if (action.actionType === 'approve_theme') theme.status = 'approved'
    if (action.actionType === 'reject_theme') theme.status = 'rejected'
    if (action.actionType === 'edit_theme') {
      if (action.payload.name) theme.name = String(action.payload.name)
      if (action.payload.summary) theme.summary = String(action.payload.summary)
    }
    if (action.actionType === 'pin_evidence' || action.actionType === 'exclude_evidence') {
      const signalId = String(action.payload.signalId)
      const evidence = theme.evidence.find((item) => item.signalId === signalId)
      if (evidence) {
        evidence.pinned = action.actionType === 'pin_evidence'
        evidence.excluded = action.actionType === 'exclude_evidence'
      }
    }
  }

  for (const theme of effective.values()) {
    theme.publishable = theme.status === 'approved' && theme.evidence.some((item) => !item.excluded)
  }
  return [...effective.values()].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
}

function readiness(machineThemes: EffectiveTheme[], effectiveThemes: EffectiveTheme[], session: CurationSession | null) {
  const validated = machineThemes.filter((theme) => theme.validationStatus === 'validated')
  const approved = validated.filter((theme) => theme.status === 'approved').length
  const rejected = validated.filter((theme) => theme.status === 'rejected').length
  const consumed = validated.filter((theme) => theme.status === 'consumed').length
  const pending = validated.filter((theme) => theme.status === 'pending').length
  const publishable = effectiveThemes.filter((theme) => theme.publishable).length
  return {
    validatedMachineThemes: validated.length,
    resolved: approved + rejected + consumed,
    pending,
    approved,
    rejected,
    consumed,
    publishable,
    canMarkReady: pending === 0 && publishable > 0,
    isReady: session?.status === 'ready',
  }
}

export async function getCurationProjection(database: Database, runId: string): Promise<CurationProjection> {
  const machine = await loadMachineThemes(database, runId)
  const session = await getSessionByRun(database, runId)
  const actions = session ? await listCurationActions(database, session.id) : []
  const effective = applyActions(machine, actions)
  const machineProjected = effective.filter((theme) => theme.machineThemeId !== null)
  return { session, machineThemes: machineProjected, effectiveThemes: effective, actions, readiness: readiness(machineProjected, effective, session) }
}

export async function createCurationSession(database: Database, runId: string) {
  const run = await database.query<{ status: string }>(`SELECT status FROM analysis_runs WHERE id = $1`, [runId])
  if (!run.rows[0]) throw new CurationError('ANALYSIS_RUN_NOT_FOUND', 'Analysis run not found.', 404)
  if (run.rows[0].status !== 'completed') throw new CurationError('CURATION_NOT_READY', 'Analysis must complete before curation.', 409)
  const existing = await getSessionByRun(database, runId)
  if (existing) return { session: existing, created: false }
  const id = randomUUID()
  await database.query(`INSERT INTO curation_sessions (id, analysis_run_id) VALUES ($1, $2)`, [id, runId])
  const session = await getSession(database, id)
  if (!session) throw new CurationError('CURATION_SESSION_CREATE_FAILED', 'Curation session could not be created.', 500)
  return { session, created: true }
}

function validatedTheme(themes: EffectiveTheme[], themeId: string) {
  const theme = themes.find((candidate) => candidate.id === themeId)
  if (!theme) throw new CurationError('CURATION_THEME_NOT_FOUND', 'Theme does not belong to this analysis run.', 404)
  if (theme.validationStatus !== 'validated') throw new CurationError('CURATION_THEME_NOT_VALIDATED', 'Only validated themes can be curated.', 409)
  return theme
}

function validateSignal(theme: EffectiveTheme, signalId: string) {
  if (!theme.evidence.some((item) => item.signalId === signalId)) {
    throw new CurationError('CURATION_EVIDENCE_NOT_FOUND', 'Evidence does not belong to this theme and analysis run.', 404)
  }
}

function normalizeAction(actionTypeValue: unknown, payloadValue: unknown, themes: EffectiveTheme[], projection: CurationProjection) {
  if (typeof actionTypeValue !== 'string' || !actionTypes.has(actionTypeValue as CurationActionType)) {
    throw new CurationError('CURATION_ACTION_INVALID', 'Action type is not supported.')
  }
  const actionType = actionTypeValue as CurationActionType
  const payload = record(payloadValue ?? {})

  if (actionType === 'mark_ready') {
    strictKeys(payload, [])
    if (!projection.readiness.canMarkReady) throw new CurationError('CURATION_READY_GATE_FAILED', 'Resolve every validated theme and retain at least one publishable theme.', 409)
    return { actionType, payload: {} }
  }

  if (actionType === 'merge_themes') {
    strictKeys(payload, ['themeIds', 'name', 'summary'])
    const themeIds = stringArray(payload.themeIds, 'themeIds', 2)
    const selected = themeIds.map((id) => validatedTheme(themes, id))
    if (selected.some((theme) => theme.status === 'consumed')) throw new CurationError('CURATION_THEME_ALREADY_CONSUMED', 'A selected theme is already consumed.', 409)
    return { actionType, payload: { themeIds, ...(optionalString(payload.name, 'name') ? { name: optionalString(payload.name, 'name') } : {}), ...(optionalString(payload.summary, 'summary') ? { summary: optionalString(payload.summary, 'summary') } : {}) } }
  }

  if (actionType === 'split_theme') {
    strictKeys(payload, ['themeId', 'groups'])
    const theme = validatedTheme(themes, requiredString(payload.themeId, 'themeId'))
    if (theme.status === 'consumed') throw new CurationError('CURATION_THEME_ALREADY_CONSUMED', 'The selected theme is already consumed.', 409)
    if (!Array.isArray(payload.groups) || payload.groups.length < 2) throw new CurationError('CURATION_ACTION_INVALID', 'Split requires at least two groups.')
    const used = new Set<string>()
    const groups = payload.groups.map((value, index): SplitGroup => {
      const group = record(value)
      strictKeys(group, ['name', 'summary', 'signalIds'])
      const signalIds = stringArray(group.signalIds, `groups[${index}].signalIds`)
      for (const signalId of signalIds) {
        validateSignal(theme, signalId)
        if (used.has(signalId)) throw new CurationError('CURATION_SPLIT_OVERLAP', 'Split evidence groups cannot overlap.')
        used.add(signalId)
      }
      const summary = optionalString(group.summary, `groups[${index}].summary`)
      return { name: requiredString(group.name, `groups[${index}].name`), ...(summary ? { summary } : {}), signalIds }
    })
    return { actionType, payload: { themeId: theme.id, groups } }
  }

  const themeId = requiredString(payload.themeId, 'themeId')
  const theme = validatedTheme(themes, themeId)
  if (theme.status === 'consumed') throw new CurationError('CURATION_THEME_ALREADY_CONSUMED', 'The selected theme is already consumed.', 409)
  if (actionType === 'approve_theme' || actionType === 'reject_theme') {
    strictKeys(payload, ['themeId'])
    return { actionType, payload: { themeId } }
  }
  if (actionType === 'edit_theme') {
    strictKeys(payload, ['themeId', 'name', 'summary'])
    const name = optionalString(payload.name, 'name')
    const summary = optionalString(payload.summary, 'summary')
    if (!name && !summary) throw new CurationError('CURATION_ACTION_INVALID', 'Edit requires a name or summary.')
    return { actionType, payload: { themeId, ...(name ? { name } : {}), ...(summary ? { summary } : {}) } }
  }
  strictKeys(payload, ['themeId', 'signalId'])
  const signalId = requiredString(payload.signalId, 'signalId')
  validateSignal(theme, signalId)
  return { actionType, payload: { themeId, signalId } }
}

export async function appendCurationAction(
  database: Database,
  sessionId: string,
  input: { actionType?: unknown; payload?: unknown },
) {
  const session = await getSession(database, sessionId)
  if (!session) throw new CurationError('CURATION_SESSION_NOT_FOUND', 'Curation session not found.', 404)
  if (session.status === 'ready') throw new CurationError('CURATION_SESSION_READY', 'A ready curation session is immutable.', 409)
  const projection = await getCurationProjection(database, session.analysisRunId)
  const normalized = normalizeAction(input.actionType, input.payload, projection.machineThemes, projection)
  const id = randomUUID()
  const nextRevision = session.revision + 1
  await database.transaction(async (transaction) => {
    const revision = await transaction.query<{ revision: number }>(
      `UPDATE curation_sessions SET revision = revision + 1,
        status = CASE WHEN $3 = 'mark_ready' THEN 'ready' ELSE status END,
        ready_at = CASE WHEN $3 = 'mark_ready' THEN NOW() ELSE ready_at END
       WHERE id = $1 AND revision = $2 RETURNING revision`,
      [sessionId, session.revision, normalized.actionType],
    )
    if (revision.rows[0]?.revision !== nextRevision) throw new CurationError('CURATION_REVISION_CONFLICT', 'Curation changed; reload and retry.', 409)
    await transaction.query(
      `INSERT INTO curation_actions (id, curation_session_id, analysis_run_id, sequence, action_type, payload)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, sessionId, session.analysisRunId, nextRevision, normalized.actionType, JSON.stringify(normalized.payload)],
    )
  })
  const actions = await listCurationActions(database, sessionId)
  const action = actions.at(-1)
  if (!action) throw new CurationError('CURATION_ACTION_CREATE_FAILED', 'Curation action could not be recorded.', 500)
  return { action, projection: await getCurationProjection(database, session.analysisRunId) }
}
