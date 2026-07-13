import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCurationProjection, getVoiceMapArtifact, listAnalysisRuns } from '../lib/api'
import type { VoiceMapSignalType, VoiceMapTheme } from './VoiceMapWorkspace'
import { adaptArtifact, applyCuratedProjection } from './VoiceMapWorkspaceContainer'
import { SignalWorkspace, type SignalKind } from './SignalWorkspace'

const types: Record<SignalKind, VoiceMapSignalType[]> = {
  pain: ['pain', 'operational_issue'],
  outcome: ['desired_outcome', 'praise', 'purchase_trigger'],
  objection: ['objection'],
  emotion: ['emotion'],
}

export const themeMatchesSignalKind = (theme: VoiceMapTheme, kind: SignalKind) =>
  theme.signalTypes.some((signalType) => types[kind].includes(signalType))

export function SignalWorkspaceContainer({ projectId, kind, onOpenReview }: { projectId: string | null; kind: SignalKind; onOpenReview: (reviewId: string) => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [themes, setThemes] = useState<VoiceMapTheme[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadVersion = useRef(0)
  const load = useCallback(async () => {
    if (!projectId) return
    const version = ++loadVersion.current
    setStatus('loading'); setError(null)
    try {
      const runs = await listAnalysisRuns(projectId)
      if (version !== loadVersion.current) return
      const latest = runs.find((run) => run.status === 'completed')
      if (!latest) { setThemes([]); setStatus('empty'); return }
      const [artifact, curation] = await Promise.all([getVoiceMapArtifact(latest.id), getCurationProjection(latest.id)])
      if (version !== loadVersion.current) return
      const adapted = adaptArtifact(artifact)
      setThemes(applyCuratedProjection(adapted.themes, curation).filter((theme) => themeMatchesSignalKind(theme, kind)))
      setStatus('ready')
    } catch (reason) {
      if (version !== loadVersion.current) return
      setError(reason instanceof Error ? reason.message : 'Signal workspace unavailable.'); setStatus('error')
    }
  }, [kind, projectId])
  useEffect(() => { void load(); return () => { loadVersion.current += 1 } }, [load])
  const selected = useMemo(() => themes.find((theme) => theme.id === selectedId) || null, [selectedId, themes])
  return <SignalWorkspace kind={kind} status={status} themes={themes} selected={selected} error={error} onSelect={(theme) => setSelectedId(theme.id)} onClose={() => setSelectedId(null)} onOpenReview={onOpenReview} />
}
