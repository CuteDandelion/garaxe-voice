import { randomUUID } from 'node:crypto'
import type { Database } from './database'
import { CANONICAL_CATEGORIES, SIGNAL_TAXONOMY_VERSION, canonicalOutcome, categoryThemeType, signalTypeThemeType, type CanonicalCategory, type CanonicalSignalType } from './canonicalOutcome'

export type CurationSessionStatus = 'draft' | 'ready'
export type CurationActionType =
  | 'approve_theme'
  | 'reject_theme'
  | 'edit_theme'
  | 'pin_evidence'
  | 'exclude_evidence'
  | 'merge_themes'
  | 'split_theme'
  | 'create_custom_theme'
  | 'move_evidence'
  | 'restore_revision'
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
  ratingScale?: number | null
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
  topic: string
  primarySignalType?: CanonicalSignalType
  signalTaxonomyVersion?: string
  proposedTypeLabel?: string | null
  summary: string
  type: string
  signalTypes: string[]
  categories: ActionableCategory[]
  sentiment: string
  confidence: string
  validationStatus: string
  status: 'pending' | 'approved' | 'rejected' | 'consumed' | 'not_reviewable'
  evidence: CuratedEvidence[]
  groupingSuggestion: { action: 'split'; reason: string } | null
  publishable: boolean
  origin: 'model_confirmed' | 'user_curated'
  provenance: { createdBy: string | null; createdAt: string | Date | null; sourceReviewIds: string[] }
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
  ratingScale: number | null
  sourceCreatedAt: string | Date | null
}

type InterpretationCandidate = {
  label: string
  evaluation: 'praise' | 'pain' | 'mixed'
  signalTypes: string[]
  rootCause: string | null
  consequence: string | null
  publicationAction: 'publish' | 'discard'
  groupingAction: 'keep' | 'split'
  groupingReason: string | null
  primaryCategory: CanonicalCategory | null
  primarySignalType: CanonicalSignalType | null
  sentiment: 'positive' | 'neutral' | 'negative' | null
  topic: string | null
}

function interpretationCandidate(validation: Record<string, unknown>): InterpretationCandidate | null {
  const value = validation.interpretationCandidate
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.label !== 'string' || !['praise', 'pain', 'mixed'].includes(String(candidate.evaluation))) return null
  return {
    label: candidate.label,
    evaluation: candidate.evaluation as InterpretationCandidate['evaluation'],
    signalTypes: Array.isArray(candidate.signalTypes) ? candidate.signalTypes.filter((item): item is string => typeof item === 'string') : [],
    rootCause: typeof candidate.rootCause === 'string' ? candidate.rootCause : null,
    consequence: typeof candidate.consequence === 'string' ? candidate.consequence : null,
    publicationAction: candidate.publicationAction === 'discard' ? 'discard' : 'publish',
    groupingAction: candidate.groupingAction === 'split' ? 'split' : 'keep',
    groupingReason: typeof candidate.groupingReason === 'string' ? candidate.groupingReason : null,
    primaryCategory: CANONICAL_CATEGORIES.includes(String(candidate.primaryCategory ?? validation.category) as CanonicalCategory)
      ? (candidate.primaryCategory ?? validation.category) as CanonicalCategory : null,
    primarySignalType: typeof candidate.primarySignalType === 'string'
      ? candidate.primarySignalType as CanonicalSignalType : null,
    sentiment: ['positive', 'neutral', 'negative'].includes(String(candidate.sentiment))
      ? candidate.sentiment as 'positive' | 'neutral' | 'negative' : null,
    topic: typeof (candidate.topic ?? candidate.aspect) === 'string' ? String(candidate.topic ?? candidate.aspect) : null,
  }
}

type ActionableCategory = CanonicalCategory

function categoryForSignalType(signalType: string): ActionableCategory {
  if (signalType === 'objection') return 'objection'
  if (signalType === 'emotion') return 'emotion'
  if (['desired_outcome', 'praise', 'purchase_trigger'].includes(signalType)) return 'desired_outcome'
  if (signalType === 'feature_request') return 'desired_outcome'
  if (signalType === 'pain' || signalType === 'operational_issue') return 'pain'
  return 'other'
}

function categoriesForSignalTypes(signalTypes: string[]) {
  return [...new Set(signalTypes.map(categoryForSignalType))]
}

function themeType(candidate: InterpretationCandidate | null, fallback: string) {
  if (candidate?.primarySignalType) return signalTypeThemeType(candidate.primarySignalType)
  if (candidate?.primaryCategory) return categoryThemeType(candidate.primaryCategory)
  const primary = candidate?.signalTypes[0]
  if (primary === 'objection' || primary === 'emotion' || primary === 'desired_outcome' || primary === 'praise') return primary
  if (primary === 'purchase_trigger') return 'purchase_driver'
  if (primary === 'operational_issue') return 'operational_failure'
  if (primary === 'pain') return 'pain_point'
  return candidate?.evaluation === 'praise' ? 'praise' : candidate?.evaluation === 'pain' ? 'pain_point' : fallback
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
  'merge_themes', 'split_theme', 'create_custom_theme', 'move_evidence', 'restore_revision', 'mark_ready',
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
  const themes = await database.query<MachineThemeRow>(
    `SELECT id, rank, name, description AS summary, theme_type AS type, sentiment, confidence, validation
     FROM themes WHERE analysis_run_id = $1 ORDER BY rank, id`,
    [runId],
  )
  const evidence = await database.query<EvidenceRow>(
    `SELECT te.theme_id AS "themeId", rs.id AS "signalId", rs.review_id AS "reviewId",
      rs.quote_text AS quote, rs.quote_start AS "quoteStart", rs.quote_end AS "quoteEnd", rs.confidence,
      r.body_original AS "originalText", r.entity_name AS entity, r.provider, r.rating_value AS rating, r.rating_scale AS "ratingScale",
      r.source_created_at AS "sourceCreatedAt"
     FROM theme_evidence te
     JOIN themes t ON t.id = te.theme_id
     JOIN review_signals rs ON rs.id = te.signal_id
     JOIN reviews r ON r.id = te.review_id
     WHERE t.analysis_run_id = $1
     ORDER BY t.rank, te.is_representative DESC, rs.confidence DESC, rs.id`,
    [runId],
  )
  const emerging = await database.query<EvidenceRow & { label: string; signalType: string; attributes: Record<string, unknown> }>(
    `SELECT NULL::uuid AS "themeId", rs.id AS "signalId", rs.review_id AS "reviewId", rs.label,
      rs.signal_type AS "signalType", rs.quote_text AS quote, rs.quote_start AS "quoteStart",
      rs.quote_end AS "quoteEnd", rs.confidence, rs.attributes,
      r.body_original AS "originalText", r.entity_name AS entity, r.provider, r.rating_value AS rating, r.rating_scale AS "ratingScale",
      r.source_created_at AS "sourceCreatedAt"
     FROM review_signals rs JOIN reviews r ON r.id = rs.review_id
     WHERE rs.analysis_run_id = $1
       AND (rs.attributes ? 'canonicalOutcome' OR rs.attributes ? 'emergingInterpretation')
       AND NOT EXISTS (
         SELECT 1 FROM theme_evidence te JOIN themes t ON t.id = te.theme_id
         WHERE te.signal_id = rs.id
           AND t.validation->'interpretationCandidate'->>'publicationAction' = 'publish'
           AND t.validation->>'status' = 'validated'
           AND COALESCE(t.validation->'interpretationCandidate'->>'groupingAction', 'keep') = 'keep'
       )
     ORDER BY r.imported_at, r.id, rs.quote_start, rs.id`,
    [runId],
  )
  const clustered = themes.rows.flatMap((theme): EffectiveTheme[] => {
    const validationStatus = typeof theme.validation?.status === 'string' ? theme.validation.status : 'insufficient_evidence'
    const interpretation = interpretationCandidate(theme.validation)
    if (validationStatus === 'superseded') return []
    if (emerging.rows.length > 0 && (validationStatus !== 'validated' || interpretation?.publicationAction !== 'publish' || interpretation.groupingAction === 'split')) return []
    const themeEvidence = evidence.rows.filter((item) => item.themeId === theme.id).map((item) => ({
      signalId: item.signalId, reviewId: item.reviewId, quote: item.quote, quoteStart: item.quoteStart, quoteEnd: item.quoteEnd,
      originalText: item.originalText, entity: item.entity, provider: item.provider, rating: item.rating, ratingScale: item.ratingScale,
      sourceCreatedAt: item.sourceCreatedAt, confidence: item.confidence, pinned: false, excluded: false,
    }))
    return [{
      id: theme.id,
      machineThemeId: theme.id,
      originThemeIds: [theme.id],
      rank: theme.rank,
      name: interpretation?.label || theme.name,
      topic: interpretation?.topic || theme.name,
      primarySignalType: interpretation?.primarySignalType || undefined,
      signalTaxonomyVersion: typeof (theme.validation.interpretationCandidate as Record<string, unknown> | undefined)?.signalTaxonomyVersion === 'string'
        ? String((theme.validation.interpretationCandidate as Record<string, unknown>).signalTaxonomyVersion) : undefined,
      summary: interpretedSummary(interpretation, theme.summary),
      type: themeType(interpretation, theme.type),
      signalTypes: interpretation?.signalTypes || [],
      categories: interpretation?.primaryCategory ? [interpretation.primaryCategory] : categoriesForSignalTypes(interpretation?.signalTypes || []),
      sentiment: interpretation?.sentiment || (interpretation?.evaluation === 'praise' ? 'positive' : interpretation?.evaluation === 'pain' ? 'negative' : theme.sentiment),
      confidence: theme.confidence,
      validationStatus,
      status: themeEvidence.length ? 'pending' : 'not_reviewable',
      evidence: themeEvidence,
      groupingSuggestion: interpretation?.groupingAction === 'split' && interpretation.groupingReason
        ? { action: 'split', reason: interpretation.groupingReason }
        : null,
      publishable: false,
      origin: 'model_confirmed',
      provenance: { createdBy: null, createdAt: null, sourceReviewIds: [] },
    }]
  })
  return [...clustered, ...emerging.rows.map((item, index): EffectiveTheme => {
    const emergingInterpretation = item.attributes.canonicalOutcome || item.attributes.emergingInterpretation
    const outcome = canonicalOutcome(emergingInterpretation)
    const candidate = emergingInterpretation && typeof emergingInterpretation === 'object' && !Array.isArray(emergingInterpretation)
      ? emergingInterpretation as Record<string, unknown> : {}
    const signalTypes = outcome?.signalTypes || (Array.isArray(candidate.signalTypes)
      ? candidate.signalTypes.filter((signalType): signalType is string => typeof signalType === 'string') : [item.signalType]
    )
    const categories = outcome ? [outcome.primaryCategory] : categoriesForSignalTypes(signalTypes)
    return {
      id: `emerging:${item.signalId}`, machineThemeId: `emerging:${item.signalId}`, originThemeIds: [],
      rank: clustered.length + index + 1, name: outcome?.label || (typeof candidate.label === 'string' ? candidate.label : item.label),
      topic: outcome?.topic || (typeof candidate.aspect === 'string' ? candidate.aspect : item.label),
      primarySignalType: outcome?.primarySignalType,
      signalTaxonomyVersion: outcome?.signalTaxonomyVersion,
      proposedTypeLabel: outcome?.proposedTypeLabel,
      summary: 'This comment has its own topic; more feedback may confirm recurrence.',
      type: outcome ? outcome.signalTaxonomyVersion === SIGNAL_TAXONOMY_VERSION
        ? signalTypeThemeType(outcome.primarySignalType) : categoryThemeType(outcome.primaryCategory)
        : themeType({ label: item.label, evaluation: 'mixed', signalTypes, sentiment: null, rootCause: null, consequence: null, publicationAction: 'publish', groupingAction: 'keep', groupingReason: null, primaryCategory: null, primarySignalType: null, topic: null }, item.signalType),
      signalTypes, categories, sentiment: outcome?.sentiment || 'neutral', confidence: 'Emerging', validationStatus: 'validated', status: 'pending',
      evidence: [{
        signalId: item.signalId, reviewId: item.reviewId, quote: item.quote, quoteStart: item.quoteStart, quoteEnd: item.quoteEnd,
        originalText: item.originalText, entity: item.entity, provider: item.provider, rating: item.rating, ratingScale: item.ratingScale,
        sourceCreatedAt: item.sourceCreatedAt, confidence: item.confidence, pinned: false, excluded: false,
      }], groupingSuggestion: null, publishable: false, origin: 'model_confirmed',
      provenance: { createdBy: null, createdAt: null, sourceReviewIds: [item.reviewId] },
    }
  })]
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
  return { ...theme, originThemeIds: [...theme.originThemeIds], signalTypes: [...theme.signalTypes], categories: [...theme.categories], evidence: theme.evidence.map((item) => ({ ...item })), provenance: { ...theme.provenance, sourceReviewIds: [...theme.provenance.sourceReviewIds] } }
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

function applyActions(machineThemes: EffectiveTheme[], actions: CurationAction[], unclusteredEvidence: CuratedEvidence[]) {
  const effective = new Map(machineThemes.map((theme) => [theme.id, copyTheme(theme)]))

  for (const action of actions) {
    if (action.actionType === 'mark_ready') continue
    if (action.actionType === 'restore_revision') continue
    if (action.actionType === 'create_custom_theme') {
      const signalIds = new Set(action.payload.signalIds as string[])
      const bySignal = new Map<string, CuratedEvidence>()
      for (const theme of effective.values()) {
        for (const item of theme.evidence) if (signalIds.has(item.signalId)) bySignal.set(item.signalId, { ...item })
        theme.evidence = theme.evidence.filter((item) => !signalIds.has(item.signalId))
      }
      for (const item of unclusteredEvidence) if (signalIds.has(item.signalId) && !bySignal.has(item.signalId)) bySignal.set(item.signalId, { ...item })
      const evidence = [...bySignal.values()]
      effective.set(`curated:${action.id}`, {
        id: `curated:${action.id}`, machineThemeId: null, originThemeIds: [], rank: machineThemes.length + action.sequence / 100,
        name: String(action.payload.name), summary: String(action.payload.summary), type: 'curated', sentiment: 'mixed',
        topic: String(action.payload.name),
        signalTypes: [], categories: [],
        confidence: 'Emerging', validationStatus: 'user_curated', status: 'approved', evidence, groupingSuggestion: null,
        publishable: evidence.length > 0, origin: 'user_curated', provenance: {
          createdBy: String(action.payload.createdBy), createdAt: action.createdAt,
          sourceReviewIds: action.payload.reviewIds as string[],
        },
      })
      continue
    }
    if (action.actionType === 'move_evidence') {
      const source = effective.get(String(action.payload.fromThemeId))
      const target = effective.get(String(action.payload.toThemeId))
      const index = source?.evidence.findIndex((item) => item.signalId === action.payload.signalId) ?? -1
      if (!source || !target || index < 0) continue
      const [moved] = source.evidence.splice(index, 1)
      target.evidence.push(moved)
      target.origin = 'user_curated'
      target.provenance = { createdBy: String(action.payload.createdBy), createdAt: action.createdAt, sourceReviewIds: [...new Set(target.evidence.map((item) => item.reviewId))] }
      continue
    }
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
        topic: String(action.payload.name || sources.map((theme) => theme.topic).join(' + ')),
        summary: String(action.payload.summary || sources.map((theme) => theme.summary).join(' ')),
        type: sources[0]?.type || 'curated',
        signalTypes: [...new Set(sources.flatMap((theme) => theme.signalTypes))],
        categories: [...new Set(sources.flatMap((theme) => theme.categories))],
        sentiment: sources.every((theme) => theme.sentiment === sources[0]?.sentiment) ? sources[0]?.sentiment || 'mixed' : 'mixed',
        confidence: sources[0]?.confidence || 'Moderate',
        validationStatus: 'validated',
        status: 'approved',
        evidence,
        groupingSuggestion: null,
        publishable: evidence.some((item) => !item.excluded),
        origin: 'user_curated',
        provenance: { createdBy: String(action.payload.createdBy || ''), createdAt: action.createdAt, sourceReviewIds: [...new Set(evidence.map((item) => item.reviewId))] },
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
          origin: 'user_curated',
          provenance: { createdBy: String(action.payload.createdBy || ''), createdAt: action.createdAt, sourceReviewIds: [...new Set(evidence.map((item) => item.reviewId))] },
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
      theme.origin = 'user_curated'
      theme.provenance = { createdBy: String(action.payload.createdBy || ''), createdAt: action.createdAt, sourceReviewIds: [...new Set(theme.evidence.map((item) => item.reviewId))] }
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
  let projectedActions: CurationAction[] = []
  const revisions = new Map<number, CurationAction[]>([[0, []]])
  for (const action of actions) {
    projectedActions = action.actionType === 'restore_revision'
      ? revisions.get(Number(action.payload.revision)) || []
      : [...projectedActions, action]
    revisions.set(action.sequence, projectedActions)
  }
  const unclusteredEvidence = await loadUnclusteredEvidence(database, runId)
  const effective = applyActions(machine, projectedActions, unclusteredEvidence)
  const originals = new Map(machine.map((theme) => [theme.id, theme]))
  const machineProjected = effective.filter((theme) => theme.machineThemeId !== null && theme.evidence.length > 0).map((theme) => {
    const original = originals.get(theme.machineThemeId || theme.id)
    return original ? { ...theme, name: original.name, topic: original.topic, summary: original.summary } : theme
  })
  return { session, machineThemes: machineProjected, effectiveThemes: effective, actions, readiness: readiness(machineProjected, effective, session) }
}

async function loadUnclusteredEvidence(database: Database, runId: string) {
  const result = await database.query<EvidenceRow>(
    `SELECT '' AS "themeId", rs.id AS "signalId", rs.review_id AS "reviewId", rs.quote_text AS quote,
      rs.quote_start AS "quoteStart", rs.quote_end AS "quoteEnd", rs.confidence, r.body_original AS "originalText",
      r.entity_name AS entity, r.provider, r.rating_value AS rating, r.source_created_at AS "sourceCreatedAt"
     FROM review_signals rs JOIN reviews r ON r.id = rs.review_id
     LEFT JOIN theme_evidence te ON te.signal_id = rs.id
     WHERE rs.analysis_run_id = $1 AND te.signal_id IS NULL ORDER BY rs.id`, [runId],
  )
  return result.rows.map((item): CuratedEvidence => ({ ...item, pinned: false, excluded: false }))
}

export async function createCurationSession(database: Database, runId: string) {
  const run = await database.query<{ status: string }>(`SELECT status FROM analysis_runs WHERE id = $1`, [runId])
  if (!run.rows[0]) throw new CurationError('ANALYSIS_RUN_NOT_FOUND', 'Analysis run not found.', 404)
  if (run.rows[0].status !== 'completed') throw new CurationError('CURATION_NOT_READY', 'Analysis must complete before curation.', 409)
  const existing = await getSessionByRun(database, runId)
  if (existing) return { session: existing, created: false }
  const id = randomUUID()
  const inserted = await database.query<{ id: string }>(
    `INSERT INTO curation_sessions (id, analysis_run_id) VALUES ($1, $2)
     ON CONFLICT (analysis_run_id) DO NOTHING RETURNING id`,
    [id, runId],
  )
  const session = await getSessionByRun(database, runId)
  if (!session) throw new CurationError('CURATION_SESSION_CREATE_FAILED', 'Curation session could not be created.', 500)
  return { session, created: inserted.rows.length === 1 }
}

function validatedTheme(themes: EffectiveTheme[], themeId: string) {
  const theme = themes.find((candidate) => candidate.id === themeId)
  if (!theme) throw new CurationError('CURATION_THEME_NOT_FOUND', 'Theme does not belong to this analysis run.', 404)
  if (!theme.evidence.length) throw new CurationError('CURATION_THEME_NOT_VALIDATED', 'Only retained feedback with source evidence can be curated.', 409)
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

  if (actionType === 'move_evidence') {
    strictKeys(payload, ['fromThemeId', 'toThemeId', 'signalId'])
    const fromThemeId = requiredString(payload.fromThemeId, 'fromThemeId')
    const toThemeId = requiredString(payload.toThemeId, 'toThemeId')
    if (fromThemeId === toThemeId) throw new CurationError('CURATION_ACTION_INVALID', 'Source and target buckets must differ.')
    const source = validatedTheme(themes, fromThemeId)
    validatedTheme(themes, toThemeId)
    const signalId = requiredString(payload.signalId, 'signalId')
    validateSignal(source, signalId)
    return { actionType, payload: { fromThemeId, toThemeId, signalId } }
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
  actorId = 'unknown-user',
) {
  const session = await getSession(database, sessionId)
  if (!session) throw new CurationError('CURATION_SESSION_NOT_FOUND', 'Curation session not found.', 404)
  const projection = await getCurationProjection(database, session.analysisRunId)
  let normalized: { actionType: CurationActionType; payload: Record<string, unknown> }
  if (input.actionType === 'restore_revision') {
    const payload = record(input.payload ?? {})
    strictKeys(payload, ['revision'])
    if (!Number.isInteger(payload.revision) || Number(payload.revision) < 0 || Number(payload.revision) >= session.revision) {
      throw new CurationError('CURATION_REVISION_INVALID', 'Restore revision must identify an earlier revision.')
    }
    normalized = { actionType: 'restore_revision', payload: { revision: Number(payload.revision) } }
  } else if (input.actionType === 'create_custom_theme') {
    const payload = record(input.payload ?? {})
    strictKeys(payload, ['name', 'summary', 'reviewIds'])
    const reviewIds = stringArray(payload.reviewIds, 'reviewIds')
    const available = [
      ...projection.effectiveThemes.flatMap((theme) => theme.evidence),
      ...await loadUnclusteredEvidence(database, session.analysisRunId),
    ]
    const selected = available.filter((item) => reviewIds.includes(item.reviewId))
    if (new Set(selected.map((item) => item.reviewId)).size !== reviewIds.length) {
      throw new CurationError('CURATION_EVIDENCE_NOT_FOUND', 'Every selected comment must be an eligible emerging signal in this analysis run.', 404)
    }
    normalized = { actionType: 'create_custom_theme', payload: {
      name: requiredString(payload.name, 'name'), summary: requiredString(payload.summary, 'summary'), reviewIds,
      signalIds: selected.map((item) => item.signalId), createdBy: actorId,
    } }
  } else {
    normalized = normalizeAction(input.actionType, input.payload, projection.effectiveThemes, projection)
    if (normalized.actionType === 'merge_themes' || normalized.actionType === 'split_theme' || normalized.actionType === 'move_evidence' || normalized.actionType === 'edit_theme') normalized.payload.createdBy = actorId
  }
  const id = randomUUID()
  const nextRevision = session.revision + 1
  await database.transaction(async (transaction) => {
    const revision = await transaction.query<{ revision: number }>(
      `UPDATE curation_sessions SET revision = revision + 1,
        status = CASE WHEN $3 = 'mark_ready' THEN 'ready' ELSE 'draft' END,
        ready_at = CASE WHEN $3 = 'mark_ready' THEN NOW() ELSE NULL END
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
