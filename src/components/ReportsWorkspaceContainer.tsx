import { useCallback, useEffect, useMemo, useState } from 'react'
import { createReport, downloadReportPdf, getCurationProjection, getReport, listAnalysisRuns, listReports, type ReportRecord } from '../lib/api'
import { ReportsWorkspace, type ReportSnapshot, type ReportVersion } from './ReportsWorkspace'

type Props = { projectId: string | null }

function version(report: ReportRecord): ReportVersion {
  return { id: report.id, title: report.title, revision: report.version, generatedAt: report.generatedAt, sourceRunId: report.analysisRunId, curationRevision: report.curationRevision }
}

function snapshot(report: ReportRecord): ReportSnapshot | null {
  if (!report.snapshot) return null
  const evidenceSourceCount = new Set(report.snapshot.themes.flatMap((theme) => theme.evidence.map((item) => item.provider))).size
  const sourceCount = Number(report.snapshot.dataset.sourceCount ?? evidenceSourceCount)
  const quality = report.snapshot.dataset.qualityReport
  const counts = report.snapshot.dataset.counts || {}
  return {
    id: report.id, title: report.title, revision: report.version, generatedAt: report.generatedAt,
    sourceRunId: report.analysisRunId, curationRevision: report.curationRevision, readiness: 'ready',
    conclusion: report.snapshot.narrative.headline, interpretation: report.snapshot.narrative.executiveSummary,
    dataset: {
      found: Number(quality.found ?? counts.found ?? 0), included: Number(quality.included ?? counts.included ?? 0),
      excluded: Number(quality.excluded ?? counts.excluded ?? 0), written: Number(quality.written ?? 0),
      ratingOnly: Number(quality.ratingOnly ?? 0), sourceCount, confidence: String(quality.confidence || 'Insufficient'),
    },
    themes: report.snapshot.themes.map((theme) => ({
      id: theme.id, rank: theme.rank, name: theme.name, summary: theme.summary,
      reviewCount: new Set(theme.evidence.map((item) => item.reviewId)).size,
      evidence: theme.evidence.map((item) => ({ id: item.signalId, quote: item.quote, provider: item.provider, entity: item.entity, rating: item.rating })),
    })),
  }
}

export function ReportsWorkspaceContainer({ projectId }: Props) {
  const [status, setStatus] = useState<'loading' | 'error' | 'empty' | 'ready'>('loading')
  const [records, setRecords] = useState<ReportRecord[]>([])
  const [selected, setSelected] = useState<ReportRecord | null>(null)
  const [latestRunId, setLatestRunId] = useState<string | null>(null)
  const [canCreate, setCanCreate] = useState(false)
  const [createTitle, setCreateTitle] = useState('Voice Map Report')
  const [creating, setCreating] = useState(false)
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    setStatus('loading'); setError(null)
    try {
      const [reportList, runs] = await Promise.all([listReports(projectId), listAnalysisRuns(projectId)])
      const latest = runs.find((run) => run.status === 'completed') || null
      setLatestRunId(latest?.id || null)
      if (latest) {
        const curation = await getCurationProjection(latest.id)
        setCanCreate(curation.readiness.isReady)
      } else setCanCreate(false)
      setRecords(reportList)
      if (reportList[0]) setSelected(await getReport(reportList[0].id))
      setStatus(reportList.length ? 'ready' : 'empty')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Reports unavailable.'); setStatus('error')
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const handleCreate = async () => {
    if (!projectId || !latestRunId) return
    setCreating(true); setError(null)
    try {
      const created = await createReport({ projectId, analysisRunId: latestRunId, ...(createTitle.trim() ? { title: createTitle.trim() } : {}) })
      setRecords((current) => [created, ...current]); setSelected(created); setStatus('ready')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Report creation failed.') }
    finally { setCreating(false) }
  }

  const handleSelect = async (reportId: string) => {
    try { setSelected(await getReport(reportId)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Report unavailable.') }
  }

  const handleDownload = async (reportId: string) => {
    const report = records.find((item) => item.id === reportId)
    if (!report) return
    setDownloadingReportId(reportId); setError(null)
    try { await downloadReportPdf(reportId, report.title) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'PDF download failed.') }
    finally { setDownloadingReportId(null) }
  }

  const reportVersions = useMemo(() => records.map(version), [records])
  return <ReportsWorkspace status={status} reports={reportVersions} selectedReport={selected ? snapshot(selected) : null}
    createTitle={createTitle} error={error} creating={creating} downloadingReportId={downloadingReportId} canCreate={canCreate}
    onCreateTitleChange={setCreateTitle} onCreate={() => void handleCreate()} onSelect={(id) => void handleSelect(id)} onDownload={(id) => void handleDownload(id)} />
}
