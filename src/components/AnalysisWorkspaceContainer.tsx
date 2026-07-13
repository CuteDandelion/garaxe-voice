import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnalysisWorkspace, type AnalysisConfig, type AnalysisStage, type DataQualityReport } from './AnalysisWorkspace'
import {
  createAnalysisRun,
  getReviewSummary,
  listAnalysisMembership,
  listAnalysisRuns,
  waitForAnalysisRun,
  type AnalysisLlmProgress,
  type AnalysisRun,
} from '../lib/api'

const initialConfig: AnalysisConfig = {
  objective: 'full_voice_map', dateFrom: '', dateTo: '', entityIds: [], ratings: [], languages: [], writtenOnly: true, minimumTextLength: 12,
}

const processingStages: AnalysisStage[] = [
  { key: 'assembling_dataset', label: 'Assembling the immutable dataset', state: 'pending' },
  { key: 'preprocessing', label: 'Normalizing and validating source language', state: 'pending' },
  { key: 'extracting_signals', label: 'Finding exact customer-language evidence', state: 'pending' },
  { key: 'forming_themes', label: 'Forming semantic evidence clusters', state: 'pending' },
  { key: 'interpreting_clusters', label: 'Interpreting every cluster with the default LLM', state: 'pending' },
  { key: 'completed', label: 'Preparing the evidence-backed Voice Map', state: 'pending' },
]

type Props = { projectId: string | null; onOpenReview: (reviewId: string) => void }

export function AnalysisWorkspaceContainer({ projectId, onOpenReview }: Props) {
  const [config, setConfig] = useState(initialConfig)
  const [status, setStatus] = useState<'configure' | 'processing' | 'completed' | 'failed'>('configure')
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getReviewSummary>> | null>(null)
  const [report, setReport] = useState<DataQualityReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState('assembling_dataset')
  const [llmProgress, setLlmProgress] = useState<AnalysisLlmProgress | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [activeRunStartedAt, setActiveRunStartedAt] = useState<string | null>(null)

  const completeRun = useCallback(async (completed: AnalysisRun) => {
    if (completed.status === 'failed' || !completed.qualityReport) throw new Error(completed.errorMessage || 'Analysis preprocessing failed.')
    const membership = await listAnalysisMembership(completed.id)
    const quality = completed.qualityReport
    setReport({
      runId: completed.id,
      createdAt: completed.createdAt,
      configurationVersion: quality.preprocessingVersion,
      pipelineVersion: completed.pipelineVersion,
      found: quality.found,
      included: quality.included,
      excluded: quality.excluded,
      written: quality.written,
      ratingOnly: quality.ratingOnly,
      averageTextLength: quality.averageTextLength,
      medianTextLength: quality.medianTextLength,
      duplicateGroups: quality.duplicateGroupCount,
      confidence: `${quality.confidence.charAt(0).toUpperCase()}${quality.confidence.slice(1)}` as DataQualityReport['confidence'],
      exclusionReasons: Object.entries(quality.exclusionReasons).filter(([, count]) => count > 0).map(([reason, count]) => ({ reason, count })),
      languages: Object.entries(quality.languageDistribution).map(([language, count]) => ({ language, count })),
      semanticAnalysis: quality.semanticAnalysis ? {
        pipelineVersion: quality.semanticAnalysis.pipelineVersion,
        clusteringVersion: quality.semanticAnalysis.clusteringVersion,
        segmentCount: quality.semanticAnalysis.segmentCount,
        clusterCount: quality.semanticAnalysis.clusterCount,
        clusteredSegmentCount: quality.semanticAnalysis.clusteredSegmentCount,
        outlierCount: quality.semanticAnalysis.outlierCount,
        ambiguousSegmentCount: quality.semanticAnalysis.ambiguousSegmentCount,
        similarityThreshold: quality.semanticAnalysis.clusteringParameters.similarityThreshold,
      } : undefined,
      membership: membership.map((item) => ({ reviewId: item.reviewId, membership: item.inclusionStatus, exclusionReason: item.exclusionReason, quote: item.originalText, rating: item.ratingValue, language: item.language, entity: item.entityName })),
    })
    setLlmProgress(completed.llmProgress)
    setActiveStage('completed')
    setStatus('completed')
  }, [])

  const monitorRun = useCallback(async (runId: string, startedAt: string | null) => {
    setStatus('processing')
    setActiveRunId(runId)
    setActiveRunStartedAt(startedAt)
    const completed = await waitForAnalysisRun(runId, 1_000, (nextRun) => {
      setActiveStage(nextRun.stage)
      setLlmProgress(nextRun.llmProgress)
      setActiveRunStartedAt(nextRun.startedAt || nextRun.createdAt)
    })
    await completeRun(completed)
  }, [completeRun])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setStatus('configure')
    setReport(null)
    setLlmProgress(null)
    setActiveRunId(null)
    void Promise.all([getReviewSummary(projectId), listAnalysisRuns(projectId)]).then(([nextSummary, runs]) => {
      if (cancelled) return
      setSummary(nextSummary)
      const active = runs.find((candidate) => !['completed', 'failed'].includes(candidate.status))
      if (!active) return
      setActiveStage(active.stage)
      setLlmProgress(active.llmProgress)
      void monitorRun(active.id, active.startedAt || active.createdAt).catch((reason) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : 'Analysis run failed.')
        setStatus('failed')
      })
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Dataset summary unavailable.')
    })
    return () => { cancelled = true }
  }, [monitorRun, projectId])

  const run = useCallback(async () => {
    if (!projectId) return
    setStatus('processing'); setError(null); setActiveStage('assembling_dataset'); setLlmProgress(null)
    try {
      const created = await createAnalysisRun(projectId, {
        objective: config.objective,
        dateFrom: config.dateFrom || undefined,
        dateTo: config.dateTo || undefined,
        entities: config.entityIds,
        ratings: config.ratings,
        languages: config.languages,
        writtenOnly: config.writtenOnly,
        minTextLength: config.minimumTextLength,
      })
      await monitorRun(created.id, created.startedAt || created.createdAt)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Analysis run failed.'); setStatus('failed')
    }
  }, [config, monitorRun, projectId])

  const stages = useMemo(() => processingStages.map((stage) => ({ ...stage, state: stage.key === activeStage ? 'active' as const : processingStages.findIndex((item) => item.key === stage.key) < processingStages.findIndex((item) => item.key === activeStage) ? 'complete' as const : 'pending' as const })), [activeStage])

  return <AnalysisWorkspace
    status={status} config={config} onConfigChange={setConfig}
    entityOptions={(summary?.breakdowns.entities || []).map(({ value, count }) => ({ value, label: value, count }))}
    languageOptions={(summary?.breakdowns.languages || []).map(({ value, count }) => ({ value, label: value.toUpperCase(), count }))}
    preview={summary ? { found: summary.total, eligible: summary.writtenCount, excluded: summary.total - summary.writtenCount } : null}
    previewLoading={!summary && !error} canRun={Boolean(projectId && summary?.total)} stages={stages}
    llmProgress={llmProgress} activeRunId={activeRunId} activeRunStartedAt={activeRunStartedAt}
    report={report} error={error}
    onRun={() => void run()} onRetry={() => { setStatus('configure'); setError(null) }} onOpenReview={onOpenReview}
  />
}
