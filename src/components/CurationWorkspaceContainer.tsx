import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  appendCurationAction,
  createCurationSession,
  getCurationProjection,
  getVoiceMapArtifact,
  listAnalysisRuns,
  type CurationActionType,
  type CurationProjection,
  type EffectiveTheme,
  type VoiceMapArtifactResponse,
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

type Props = { projectId: string | null }

const confidence = (value: string): CurationConfidence => {
  const normalized = value.toLowerCase()
  return normalized === 'high' || normalized === 'moderate' || normalized === 'emerging' || normalized === 'weak' ? normalized : 'insufficient'
}

const actionLabel: Record<CurationActionType, string> = {
  approve_theme: 'Approved theme', reject_theme: 'Rejected theme', edit_theme: 'Edited theme',
  pin_evidence: 'Pinned evidence', exclude_evidence: 'Excluded evidence', merge_themes: 'Merged themes',
  split_theme: 'Split theme', mark_ready: 'Marked Voice Map ready',
}

function adaptThemes(projection: CurationProjection, artifact: VoiceMapArtifactResponse): CurationTheme[] {
  const source = new Map(artifact.themes.map((theme) => [theme.id, theme]))
  const editedIds = new Set(projection.actions.filter((action) => action.actionType === 'edit_theme').map((action) => String(action.payload.themeId)))
  return projection.effectiveThemes
    .filter((theme) => theme.status !== 'consumed' && theme.status !== 'not_reviewable')
    .map((theme) => {
      const sourceTheme = source.get(theme.machineThemeId || theme.id)
      const edited = editedIds.has(theme.id)
      return {
        id: theme.id,
        rank: theme.rank,
        machine: { name: theme.name, summary: theme.summary },
        curated: edited || !theme.machineThemeId ? { name: theme.name, summary: theme.summary } : null,
        decision: theme.status === 'rejected' ? 'rejected' : edited ? 'edited' : theme.status === 'approved' ? 'approved' : 'pending',
        confidence: confidence(theme.confidence),
        reviewCount: sourceTheme?.metrics.independentReviewCount || new Set(theme.evidence.map((item) => item.reviewId)).size,
        groupingSuggestion: theme.groupingSuggestion,
        evidence: theme.evidence.map((item) => ({
          id: item.signalId, reviewId: item.reviewId, quote: item.quote, quoteStart: item.quoteStart, quoteEnd: item.quoteEnd,
          originalText: item.originalText, entity: item.entity, provider: item.provider,
          rating: item.rating, sourceCreatedAt: item.sourceCreatedAt,
          pinned: item.pinned, excluded: item.excluded,
        })),
      }
    })
}

function activity(projection: CurationProjection): CurationActivity[] {
  const names = new Map(projection.effectiveThemes.map((theme) => [theme.id, theme.name]))
  return [...projection.actions].reverse().map((action) => ({
    id: action.id, createdAt: String(action.createdAt), actorName: 'Garaxe Analyst', action: actionLabel[action.actionType],
    themeName: names.get(String(action.payload.themeId)) || null,
  }))
}

export function CurationWorkspaceContainer({ projectId }: Props) {
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

  const load = useCallback(async () => {
    if (!projectId) return
    setStatus('loading'); setError(null)
    try {
      const latest = (await listAnalysisRuns(projectId))[0]
      if (!latest) throw new Error('Complete an analysis run before starting curation.')
      if (latest.status !== 'completed') throw new Error('The latest analysis is still interpreting its evidence clusters. Curation opens when interpretation completes or reaches an explicit fallback.')
      await createCurationSession(latest.id)
      const [nextProjection, nextArtifact] = await Promise.all([getCurationProjection(latest.id), getVoiceMapArtifact(latest.id)])
      setProjection(nextProjection); setArtifact(nextArtifact); setStatus('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Curation workspace unavailable.'); setStatus('error')
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const submit = useCallback(async (actionType: CurationActionType, payload: Record<string, unknown>) => {
    if (!projection?.session) return
    setSubmitting(true); setError(null)
    try {
      const result = await appendCurationAction(projection.session.id, actionType, payload)
      setProjection(result.projection)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Curation action failed.')
    } finally { setSubmitting(false) }
  }, [projection?.session])

  const themes = useMemo(() => projection && artifact ? adaptThemes(projection, artifact) : [], [projection, artifact])
  const selectedTheme = themes.find((theme) => theme.id === selectedThemeId)
  const gateErrors = projection && !projection.readiness.canMarkReady && !projection.readiness.isReady
    ? [`${projection.readiness.pending} validated theme${projection.readiness.pending === 1 ? '' : 's'} still need a decision.`, ...(projection.readiness.publishable ? [] : ['Approve at least one theme with usable evidence.'])]
    : []

  return <CurationWorkspace
    status={status}
    run={artifact && projection ? { id: artifact.run.id, createdAt: artifact.run.createdAt, analysisVersion: artifact.synthesisVersion, pipelineVersion: artifact.run.pipelineVersion, totalThemes: projection.readiness.validatedMachineThemes, reviewedThemes: projection.readiness.resolved, requiredThemes: projection.readiness.validatedMachineThemes, ready: projection.readiness.isReady } : null}
    themes={themes} activity={projection ? activity(projection) : []} selectedThemeId={selectedThemeId}
    editDraft={editDraft} mergeSelection={mergeSelection} mergeDraft={mergeDraft} splitDraft={splitDraft}
    gateErrors={gateErrors} error={error} submitting={submitting}
    onThemeSelect={setSelectedThemeId} onThemeClose={() => setSelectedThemeId(null)}
    onApprove={(themeId) => void submit('approve_theme', { themeId })}
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
  />
}
