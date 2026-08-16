import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  appendCurationAction,
  appendDemoCurationAction,
  createCurationSession,
  getCurationProjection,
  getDemoCurationProjection,
  getAnalysisCoverage,
  getVoiceMapArtifact,
  listAnalysisRuns,
  type CurationActionType,
  type CurationProjection,
  type EffectiveTheme,
  type AnalysisCoverageItem,
  type VoiceMapArtifactResponse,
  type PrimarySemanticCategory,
} from '../lib/api'
import {
  CurationWorkspace,
  type CurationActivity,
  type CurationConfidence,
  type CurationEditDraft,
  type CurationMergeDraft,
  type CurationSplitDraft,
  type CurationTheme,
} from './CurationWorkspace'
import { projectDateRange, projectThemeSummary } from '../lib/dateProjection'

type Props = {
  projectId: string | null
  dateRange?: { from: string | null; to: string | null }
  demo?: { token: string; expiresAt: string; engine: string; coverage: AnalysisCoverageItem[]; onChange?: () => void | Promise<void> }
}

const confidence = (value: string): CurationConfidence => {
  const normalized = value.toLowerCase()
  return normalized === 'high' || normalized === 'moderate' || normalized === 'emerging' || normalized === 'weak' ? normalized : 'insufficient'
}

const actionLabel: Record<CurationActionType, string> = {
  approve_theme: 'Approved theme', reject_theme: 'Rejected theme', edit_theme: 'Edited theme',
  pin_evidence: 'Pinned evidence', exclude_evidence: 'Excluded evidence', merge_themes: 'Merged themes',
  split_theme: 'Split theme', create_custom_theme: 'Created custom bucket', move_evidence: 'Moved evidence', restore_revision: 'Restored revision', mark_ready: 'Marked Voice Map ready',
}

const primaryCategory = (value: string | undefined): PrimarySemanticCategory => {
  if (value === 'desired_outcome' || value === 'objection' || value === 'emotion' || value === 'other') return value
  if (value === 'main_objection') return 'objection'
  if (value === 'emotional_driver') return 'emotion'
  return 'pain'
}

export function adaptThemes(projection: CurationProjection, artifact: VoiceMapArtifactResponse | null, visibleReviewIds?: Set<string>): CurationTheme[] {
  const source = new Map((artifact?.themes || []).map((theme) => [theme.id, theme]))
  const machine = new Map(projection.machineThemes.map((theme) => [theme.id, theme]))
  return projection.effectiveThemes
    .filter((theme) => theme.status !== 'consumed' && theme.status !== 'not_reviewable')
    .flatMap((theme) => {
      const evidence = theme.evidence.filter((item) => !visibleReviewIds || visibleReviewIds.has(item.reviewId))
      if (visibleReviewIds && !evidence.length) return []
      const sourceTheme = source.get(theme.machineThemeId || theme.id)
      const machineTheme = machine.get(theme.machineThemeId || theme.id)
      const machineSummary = visibleReviewIds ? projectThemeSummary(machineTheme?.summary || theme.summary, new Set(evidence.map((item) => item.reviewId)).size) : machineTheme?.summary || theme.summary
      const effectiveSummary = visibleReviewIds ? projectThemeSummary(theme.summary, new Set(evidence.map((item) => item.reviewId)).size) : theme.summary
      const edited = theme.origin === 'user_curated' || !theme.machineThemeId
        || Boolean(machineTheme && (theme.name !== machineTheme.name || theme.summary !== machineTheme.summary))
      return {
        id: theme.id,
        rank: theme.rank,
        machine: { name: machineTheme?.name || theme.name, summary: machineSummary },
        curated: theme.origin === 'user_curated' || edited || !theme.machineThemeId ? { name: theme.name, summary: effectiveSummary } : null,
        decision: theme.status === 'rejected' ? 'rejected' : edited ? 'edited' : theme.status === 'approved' ? 'approved' : 'pending',
        confidence: confidence(theme.confidence),
        category: primaryCategory(machineTheme?.categories?.[0] || theme.categories?.[0] || theme.type),
        reviewCount: new Set(evidence.map((item) => item.reviewId)).size,
        groupingSuggestion: theme.groupingSuggestion,
        origin: theme.origin,
        evidence: evidence.map((item) => ({
          id: item.signalId, reviewId: item.reviewId, quote: item.quote, quoteStart: item.quoteStart, quoteEnd: item.quoteEnd,
          originalText: item.originalText, entity: item.entity, provider: item.provider,
          rating: item.rating, sourceCreatedAt: item.sourceCreatedAt,
          pinned: item.pinned, excluded: item.excluded,
        })),
      }
    })
}

export function adaptActivity(projection: CurationProjection): CurationActivity[] {
  const names = new Map(projection.effectiveThemes.map((theme) => [theme.id, theme.name]))
  return [...projection.actions].reverse().map((action) => ({
    id: action.id, createdAt: String(action.createdAt), actorName: 'Elseform Analyst', action: actionLabel[action.actionType],
    themeName: names.get(String(action.payload.themeId)) || null,
  }))
}

export function CurationWorkspaceContainer({ projectId, dateRange = { from: null, to: null }, demo }: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [projection, setProjection] = useState<CurationProjection | null>(null)
  const [artifact, setArtifact] = useState<VoiceMapArtifactResponse | null>(null)
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<CurationEditDraft | null>(null)
  const [mergeSelection, setMergeSelection] = useState<string[]>([])
  const [mergeDraft, setMergeDraft] = useState<CurationMergeDraft>({ name: '', summary: '' })
  const [splitDraft, setSplitDraft] = useState<CurationSplitDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [coverage, setCoverage] = useState<AnalysisCoverageItem[]>(demo?.coverage || [])

  const load = useCallback(async () => {
    if (!projectId && !demo) return
    setStatus('loading'); setError(null)
    try {
      if (demo) {
        setProjection(await getDemoCurationProjection(demo.token)); setArtifact(null); setCoverage(demo.coverage); setStatus('ready'); return
      }
      if (!projectId) return
      const latest = (await listAnalysisRuns(projectId))[0]
      if (!latest) throw new Error('Complete an analysis run before starting curation.')
      if (latest.status !== 'completed') throw new Error('The latest analysis is still interpreting its evidence clusters. Curation opens when interpretation completes or reaches an explicit fallback.')
      await createCurationSession(latest.id)
      const [nextProjection, nextArtifact, nextCoverage] = await Promise.all([getCurationProjection(latest.id), getVoiceMapArtifact(latest.id), getAnalysisCoverage(latest.id)])
      setProjection(nextProjection); setArtifact(nextArtifact); setCoverage(nextCoverage); setStatus('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Curation workspace unavailable.'); setStatus('error')
    }
  }, [projectId, demo?.token])

  useEffect(() => { void load() }, [load])

  const submit = useCallback(async (actionType: CurationActionType, payload: Record<string, unknown>) => {
    if (!projection?.session) return
    setSubmitting(true); setError(null)
    try {
      const result = demo
        ? await appendDemoCurationAction(demo.token, actionType, payload)
        : await appendCurationAction(projection.session.id, actionType, payload)
      setProjection(result.projection)
      await demo?.onChange?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Curation action failed.')
    } finally { setSubmitting(false) }
  }, [projection?.session, demo])

  const visibleCoverage = useMemo(() => projectDateRange([], demo?.coverage || coverage, dateRange).coverage, [coverage, dateRange.from, dateRange.to, demo?.coverage])
  const visibleReviewIds = useMemo(() => new Set(visibleCoverage.map((item) => item.reviewId)), [visibleCoverage])
  const themes = useMemo(() => projection ? adaptThemes(projection, artifact, dateRange.from || dateRange.to ? visibleReviewIds : undefined) : [], [projection, artifact, dateRange.from, dateRange.to, visibleReviewIds])
  const filtered = Boolean(dateRange.from || dateRange.to)
  const reviewedThemes = themes.filter((theme) => theme.decision !== 'pending').length
  const gateErrors = filtered ? ['Clear the date filter before publishing the full evidence set.'] : projection && !projection.readiness.canMarkReady && !projection.readiness.isReady
    ? [`${projection.readiness.pending} validated theme${projection.readiness.pending === 1 ? '' : 's'} still need a decision.`, ...(projection.readiness.publishable ? [] : ['Approve at least one theme with usable evidence.'])]
    : []

  return <CurationWorkspace
    status={status}
    run={projection ? { id: artifact?.run.id || projection.session?.analysisRunId || 'temporary-demo', createdAt: artifact?.run.createdAt || projection.session?.createdAt || demo?.expiresAt || '', analysisVersion: artifact?.synthesisVersion || demo?.engine || 'Voice Map intelligence', pipelineVersion: artifact?.run.pipelineVersion || demo?.engine || 'Voice Map intelligence', totalThemes: filtered ? themes.length : projection.readiness.validatedMachineThemes, reviewedThemes: filtered ? reviewedThemes : projection.readiness.resolved, requiredThemes: filtered ? themes.length : projection.readiness.validatedMachineThemes, ready: !filtered && projection.readiness.isReady } : null}
    themes={themes} activity={projection ? adaptActivity(projection) : []} selectedThemeId={selectedThemeId}
    editDraft={editDraft} mergeSelection={mergeSelection} mergeDraft={mergeDraft} splitDraft={splitDraft}
    gateErrors={gateErrors} error={error} submitting={submitting}
    demoMode={Boolean(demo)} expiresAt={demo?.expiresAt} revision={projection?.session?.revision || 0}
    coverageItems={visibleCoverage}
    emergingEvidence={visibleCoverage.filter((item) => item.disposition === 'emerging' && item.signals.length > 0).map((item) => ({ reviewId: item.reviewId, originalText: item.originalText, reason: item.reason }))}
    onThemeSelect={setSelectedThemeId} onThemeClose={() => setSelectedThemeId(null)}
    onApprove={(themeId) => void submit('approve_theme', { themeId })}
    onApproveMany={(themeIds) => { void themeIds.reduce((chain, themeId) => chain.then(() => submit('approve_theme', { themeId })), Promise.resolve()) }}
    onReject={(themeId) => void submit('reject_theme', { themeId })}
    onEditStart={(themeId) => { const theme = themes.find((item) => item.id === themeId); if (theme) setEditDraft({ themeId, name: theme.curated?.name || theme.machine.name, summary: theme.curated?.summary || theme.machine.summary }) }}
    onEditDraftChange={setEditDraft}
    onEditSave={() => { if (editDraft) void submit('edit_theme', editDraft).then(() => setEditDraft(null)) }}
    onEditCancel={() => setEditDraft(null)}
    onEvidencePin={(themeId, evidenceId, pinned) => { if (pinned) void submit('pin_evidence', { themeId, signalId: evidenceId }) }}
    onEvidenceExclude={(themeId, evidenceId, excluded) => { if (excluded) void submit('exclude_evidence', { themeId, signalId: evidenceId }) }}
    onMergeSelectionChange={setMergeSelection} onMergeDraftChange={setMergeDraft}
    onMerge={() => void submit('merge_themes', { themeIds: mergeSelection, ...(mergeDraft.name ? { name: mergeDraft.name } : {}), ...(mergeDraft.summary ? { summary: mergeDraft.summary } : {}) }).then(() => { setMergeSelection([]); setMergeDraft({ name: '', summary: '' }) })}
    onMergeCancel={() => { setMergeSelection([]); setMergeDraft({ name: '', summary: '' }) }}
    onSplitStart={(themeId) => { const theme = themes.find((item) => item.id === themeId); if (theme) setSplitDraft({ themeId, firstName: `${theme.machine.name} A`, secondName: `${theme.machine.name} B`, assignments: Object.fromEntries(theme.evidence.map((item) => [item.id, 'unassigned'])) }) }}
    onSplitDraftChange={setSplitDraft}
    onSplit={() => { if (!splitDraft) return; const groups = [{ name: splitDraft.firstName, signalIds: Object.entries(splitDraft.assignments).filter(([, group]) => group === 'first').map(([id]) => id) }, { name: splitDraft.secondName, signalIds: Object.entries(splitDraft.assignments).filter(([, group]) => group === 'second').map(([id]) => id) }]; void submit('split_theme', { themeId: splitDraft.themeId, groups }).then(() => setSplitDraft(null)) }}
    onSplitCancel={() => setSplitDraft(null)}
    onMarkReady={() => void submit('mark_ready', {})}
    onCreateCustomTheme={(name, summary, reviewIds) => void submit('create_custom_theme', { name, summary, reviewIds })}
    onMoveEvidence={(fromThemeId, signalId, toThemeId) => void submit('move_evidence', { fromThemeId, signalId, toThemeId })}
    onRestoreRevision={(revision) => void submit('restore_revision', { revision })}
  />
}
