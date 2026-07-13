import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurationProjection, getVoiceMapArtifact, listAnalysisRuns } from '../lib/api'
import type { VoiceMapTheme } from './VoiceMapWorkspace'
import { adaptArtifact, applyCuratedProjection } from './VoiceMapWorkspaceContainer'
import { CopyLabWorkspace } from './CopyLabWorkspace'

export function CopyLabWorkspaceContainer({ projectId, onOpenReview }: { projectId: string | null; onOpenReview: (reviewId: string) => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [themes, setThemes] = useState<VoiceMapTheme[]>([])
  const [error, setError] = useState<string | null>(null)
  const loadVersion = useRef(0)
  const load = useCallback(async () => {
    if (!projectId) return
    const version = ++loadVersion.current
    setStatus('loading'); setError(null)
    try {
      const latest = (await listAnalysisRuns(projectId)).find((run) => run.status === 'completed')
      if (version !== loadVersion.current) return
      if (!latest) { setStatus('empty'); return }
      const [artifact, curation] = await Promise.all([getVoiceMapArtifact(latest.id), getCurationProjection(latest.id)])
      if (version !== loadVersion.current) return
      const adapted = adaptArtifact(artifact)
      const available = applyCuratedProjection(adapted.themes, curation).filter((theme) => theme.evidence.length > 0)
      setThemes(available); setStatus(available.length ? 'ready' : 'empty')
    } catch (reason) { if (version !== loadVersion.current) return; setError(reason instanceof Error ? reason.message : 'Copy Lab unavailable.'); setStatus('error') }
  }, [projectId])
  useEffect(() => { void load(); return () => { loadVersion.current += 1 } }, [load])
  return <CopyLabWorkspace status={status} themes={themes} error={error} onOpenReview={onOpenReview} />
}
