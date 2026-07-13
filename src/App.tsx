import { useCallback, useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Icon } from './components/Icon'
import { ProjectDialog } from './components/ProjectDialog'
import { ReviewInventory, type ReviewInventoryFilters, type ReviewInventoryItem } from './components/ReviewInventory'
import { AnalysisWorkspaceContainer } from './components/AnalysisWorkspaceContainer'
import { VoiceMapWorkspaceContainer } from './components/VoiceMapWorkspaceContainer'
import { SignalWorkspaceContainer } from './components/SignalWorkspaceContainer'
import { CopyLabWorkspaceContainer } from './components/CopyLabWorkspaceContainer'
import { CurationWorkspaceContainer } from './components/CurationWorkspaceContainer'
import { ReportsWorkspaceContainer } from './components/ReportsWorkspaceContainer'
import { AuthGate } from './components/AuthGate'
import { Sidebar } from './components/Sidebar'
import { SourcesWorkspace } from './components/SourcesWorkspace'
import { Topbar } from './components/Topbar'
import { createAnalysisRun, createProject, getCurrentAuth, getFilteredReviewSummary, getReviewDetail, listProjects, listReviews, logout, waitForAnalysisRun, type AuthContext, type Project, type ReviewInventoryQuery, type ReviewRecord } from './lib/api'

function inventoryItem(review: ReviewRecord): ReviewInventoryItem {
  return {
    id: review.id,
    provider: review.provider,
    entity: review.entityName,
    rating: review.ratingValue,
    ratingScale: review.ratingScale,
    title: review.title,
    bodyOriginal: review.body,
    language: review.language,
    sourceCreatedAt: review.sourceCreatedAt,
    reviewerName: review.reviewerName,
    sourceUrl: review.sourceUrl,
    externalId: review.externalReviewId,
    importJobId: '',
    sourceRecordId: '',
    importedAt: review.importedAt,
    isRatingOnly: review.isRatingOnly,
    metadata: review.metadata,
  }
}

function WorkspaceApp({ onSignedOut }: { onSignedOut: () => void }) {
  const [activePage, setActivePage] = useState<'VoiceMap' | 'PainPhrases' | 'Outcomes' | 'Objections' | 'EmotionalTriggers' | 'CopyLab' | 'Sources' | 'Reviews' | 'Analysis' | 'Curation' | 'Reports'>('VoiceMap')
  const [menuOpen, setMenuOpen] = useState(false)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [projectName, setProjectName] = useState('Acme Software')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [auth, setAuth] = useState<AuthContext | null>(null)
  const [importedCount, setImportedCount] = useState<number | null>(null)
  const [reviewFilters, setReviewFilters] = useState<ReviewInventoryFilters>({ query: '', provider: '', entity: '', rating: '', language: '', textKind: 'all' })
  const [reviewItems, setReviewItems] = useState<ReviewInventoryItem[]>([])
  const [reviewSummary, setReviewSummary] = useState({ total: 0, written: 0, ratingOnly: 0, entities: 0, providers: 0 })
  const [projectReviewSummary, setProjectReviewSummary] = useState({ total: 0, providers: 0 })
  const [reviewDateRange, setReviewDateRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [analysisDateRange, setAnalysisDateRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [dateFilterBusy, setDateFilterBusy] = useState(false)
  const [analysisRefreshKey, setAnalysisRefreshKey] = useState(0)
  const [analysisSummary, setAnalysisSummary] = useState<{ confidence: string | null; createdAt: string | null }>({ confidence: null, createdAt: null })
  const [reviewOptions, setReviewOptions] = useState({ providers: [] as { value: string; label: string; count: number }[], entities: [] as { value: string; label: string; count: number }[], languages: [] as { value: string; label: string; count: number }[] })
  const [reviewCursor, setReviewCursor] = useState<string | null>(null)
  const [reviewCursorHistory, setReviewCursorHistory] = useState<Array<string | null>>([])
  const [nextReviewCursor, setNextReviewCursor] = useState<string | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [selectedReview, setSelectedReview] = useState<ReviewInventoryItem | null>(null)

  useEffect(() => {
    setAnalysisSummary({ confidence: null, createdAt: null })
    setReviewDateRange({ from: null, to: null })
    setAnalysisDateRange({ from: null, to: null })
    setProjectReviewSummary({ total: 0, providers: 0 })
  }, [projectId])

  useEffect(() => {
    let active = true
    void Promise.all([listProjects(), getCurrentAuth()])
      .then(async ([existingProjects, currentAuth]) => {
        const availableProjects = existingProjects.length ? existingProjects : [await createProject('Acme Software', 'positioning', true)]
        if (!active) return
        setProjects(availableProjects)
        setProjectId(availableProjects[0].id)
        setProjectName(availableProjects[0].name)
        setAuth(currentAuth)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  const selectProject = useCallback((nextProjectId: string) => {
    const project = projects.find((candidate) => candidate.id === nextProjectId)
    if (!project) return
    setProjectId(project.id)
    setProjectName(project.name)
    setImportedCount(null)
    setReviewItems([])
    setReviewCursor(null)
    setReviewCursorHistory([])
    setNextReviewCursor(null)
    setSelectedReview(null)
    setActivePage('VoiceMap')
    setMenuOpen(false)
  }, [projects])

  const signOut = useCallback(async () => {
    await logout()
    onSignedOut()
  }, [onSignedOut])

  const applyDateRange = useCallback(async ({ from, to }: { from: string; to: string }) => {
    if (!projectId) throw new Error('Select a project before filtering dates.')
    setDateFilterBusy(true)
    try {
      const created = await createAnalysisRun(projectId, {
        objective: 'full_voice_map', dateFrom: from || undefined, dateTo: to || undefined,
        entities: [], ratings: [], languages: [], writtenOnly: true, minTextLength: 3,
      })
      const completed = await waitForAnalysisRun(created.id, 500)
      if (completed.status !== 'completed') throw new Error(completed.errorMessage || 'The filtered analysis failed.')
      setAnalysisDateRange({ from: from || reviewDateRange.from, to: to || reviewDateRange.to })
      setActivePage('VoiceMap')
      setAnalysisRefreshKey((value) => value + 1)
    } finally {
      setDateFilterBusy(false)
    }
  }, [projectId, reviewDateRange.from, reviewDateRange.to])

  const handleRunSummary = useCallback((summary: { confidence: string | null; createdAt: string | null; dateFrom?: string; dateTo?: string }) => {
    setAnalysisSummary({ confidence: summary.confidence, createdAt: summary.createdAt })
    setAnalysisDateRange({ from: summary.dateFrom || null, to: summary.dateTo || null })
  }, [])

  const account = auth ? {
    displayName: auth.user.displayName,
    email: auth.user.email,
    role: auth.memberships[0]?.role ?? '',
  } : null
  const userInitials = (account?.displayName || account?.email || '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '—'

  const reviewQuery: ReviewInventoryQuery = {
    cursor: reviewCursor,
    limit: 25,
    search: reviewFilters.query,
    provider: reviewFilters.provider,
    entity: reviewFilters.entity,
    ratingMin: reviewFilters.rating ? Number(reviewFilters.rating) : undefined,
    ratingMax: reviewFilters.rating ? Number(reviewFilters.rating) : undefined,
    language: reviewFilters.language,
    hasText: reviewFilters.textKind === 'all' ? undefined : reviewFilters.textKind === 'written',
  }

  const loadInventory = useCallback(async () => {
    if (!projectId) return
    setReviewLoading(true)
    setReviewError(null)
    try {
      const [page, filteredSummary, completeSummary] = await Promise.all([
        listReviews(projectId, reviewQuery),
        getFilteredReviewSummary(projectId, reviewQuery),
        getFilteredReviewSummary(projectId),
      ])
      setReviewItems(page.items.map(inventoryItem))
      setNextReviewCursor(page.nextCursor)
      setReviewSummary({ total: filteredSummary.total, written: filteredSummary.writtenCount, ratingOnly: filteredSummary.ratingOnlyCount, entities: filteredSummary.entityCount, providers: filteredSummary.providerCount })
      setProjectReviewSummary({ total: completeSummary.total, providers: completeSummary.providerCount })
      setReviewDateRange({ from: completeSummary.earliestDate, to: completeSummary.latestDate })
      setReviewOptions({
        providers: completeSummary.breakdowns.providers.map(({ value, count }) => ({ value, label: value.replaceAll('_', ' '), count })),
        entities: completeSummary.breakdowns.entities.map(({ value, count }) => ({ value, label: value, count })),
        languages: completeSummary.breakdowns.languages.map(({ value, count }) => ({ value, label: value.toUpperCase(), count })),
      })
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Review inventory unavailable.')
    } finally {
      setReviewLoading(false)
    }
  }, [projectId, reviewCursor, reviewFilters.query, reviewFilters.provider, reviewFilters.entity, reviewFilters.rating, reviewFilters.language, reviewFilters.textKind])

  useEffect(() => {
    if (activePage === 'Reviews') void loadInventory()
  }, [activePage, loadInventory, importedCount])

  useEffect(() => {
    if (!projectId) return
    let active = true
    void getFilteredReviewSummary(projectId).then((summary) => {
      if (!active) return
      setReviewSummary({ total: summary.total, written: summary.writtenCount, ratingOnly: summary.ratingOnlyCount, entities: summary.entityCount, providers: summary.providerCount })
      setProjectReviewSummary({ total: summary.total, providers: summary.providerCount })
      setReviewDateRange({ from: summary.earliestDate, to: summary.latestDate })
      setReviewOptions({
        providers: summary.breakdowns.providers.map(({ value, count }) => ({ value, label: value.replaceAll('_', ' '), count })),
        entities: summary.breakdowns.entities.map(({ value, count }) => ({ value, label: value, count })),
        languages: summary.breakdowns.languages.map(({ value, count }) => ({ value, label: value.toUpperCase(), count })),
      })
    }).catch(() => undefined)
    return () => { active = false }
  }, [projectId, importedCount])

  const openReview = useCallback(async (review: ReviewInventoryItem) => {
    setSelectedReview(review)
    try {
      const detail = await getReviewDetail(review.id)
      setSelectedReview({ ...review, sourceRecordId: `${detail.sourceRecord.id} · row ${detail.sourceRecord.rowNumber}`, importJobId: `${detail.importJob.fileName} · ${detail.importJob.id}`, metadata: { ...review.metadata, raw_source_record: detail.sourceRecord.rawPayload, payload_hash: detail.sourceRecord.payloadHash } })
    } catch {
      setSelectedReview(review)
    }
  }, [])

  const openReviewById = useCallback(async (reviewId: string) => {
    setActivePage('Reviews')
    setReviewError(null)
    try {
      const detail = await getReviewDetail(reviewId)
      const review = inventoryItem(detail.review)
      setSelectedReview({ ...review, sourceRecordId: `${detail.sourceRecord.id} · row ${detail.sourceRecord.rowNumber}`, importJobId: `${detail.importJob.fileName} · ${detail.importJob.id}`, metadata: { ...review.metadata, raw_source_record: detail.sourceRecord.rawPayload, payload_hash: detail.sourceRecord.payloadHash } })
    } catch (reason) {
      setSelectedReview(null)
      setReviewError(reason instanceof Error ? reason.message : 'Source review unavailable.')
    }
  }, [])

  const activeLabel = activePage === 'VoiceMap' ? 'Voice Map'
    : activePage === 'PainPhrases' ? 'Pain Phrases'
      : activePage === 'EmotionalTriggers' ? 'Emotional Triggers'
        : activePage === 'CopyLab' ? 'Copy Lab'
          : activePage

  return (
    <div className="app-shell">
      <Sidebar
        open={menuOpen}
        projects={projects}
        projectId={projectId}
        dataset={{ reviews: projectReviewSummary.total, sources: projectReviewSummary.providers, confidence: analysisSummary.confidence }}
        account={account}
        activeLabel={activeLabel}
        onProjectChange={selectProject}
        onNewProject={() => setProjectDialogOpen(true)}
        onLogout={() => void signOut()}
        onNavigate={(label) => {
          if (label === 'Voice Map') setActivePage('VoiceMap')
          if (label === 'Pain Phrases') setActivePage('PainPhrases')
          if (label === 'Outcomes') setActivePage('Outcomes')
          if (label === 'Objections') setActivePage('Objections')
          if (label === 'Emotional Triggers') setActivePage('EmotionalTriggers')
          if (label === 'Copy Lab') setActivePage('CopyLab')
          if (label === 'Sources') setActivePage('Sources')
          if (label === 'Reviews') setActivePage('Reviews')
          if (label === 'Analysis') setActivePage('Analysis')
          if (label === 'Curation') setActivePage('Curation')
          if (label === 'Reports') setActivePage('Reports')
          setMenuOpen(false)
        }}
      />
      {menuOpen ? <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}
      <div className="app-frame">
        <Topbar projects={projects} projectId={projectId} title={activeLabel} dateRange={{ from: analysisDateRange.from || reviewDateRange.from, to: analysisDateRange.to || reviewDateRange.to }} availableDateRange={reviewDateRange} userInitials={userInitials} account={account} dateFilterBusy={dateFilterBusy} onProjectChange={selectProject} onDateRangeChange={applyDateRange} onLogout={() => void signOut()} onMenu={() => setMenuOpen(true)} onExport={() => setActivePage('Reports')} />
        <main>
          {activePage === 'Sources' ? (
            <SourcesWorkspace projectId={projectId} onImported={(count) => { setImportedCount(count); setActivePage('Reviews') }} />
          ) : activePage === 'Reviews' ? (
            <ReviewInventory
              filters={reviewFilters}
              summary={reviewSummary}
              page={{ items: reviewItems, nextCursor: nextReviewCursor, previousCursor: reviewCursorHistory.at(-1) ?? null, rangeStart: reviewItems.length ? reviewCursorHistory.length * 25 + 1 : 0, rangeEnd: reviewCursorHistory.length * 25 + reviewItems.length, total: reviewSummary.total }}
              providerOptions={reviewOptions.providers}
              entityOptions={reviewOptions.entities}
              languageOptions={reviewOptions.languages}
              loading={reviewLoading}
              error={reviewError}
              selectedReview={selectedReview}
              onFiltersChange={(filters) => { setReviewFilters(filters); setReviewCursor(null); setReviewCursorHistory([]) }}
              onCursorChange={(cursor, direction) => {
                if (direction === 'next') { setReviewCursorHistory((history) => [...history, reviewCursor]); setReviewCursor(cursor) }
                else { setReviewCursorHistory((history) => history.slice(0, -1)); setReviewCursor(cursor) }
              }}
              onSelectReview={(review) => void openReview(review)}
              onCloseReview={() => setSelectedReview(null)}
              onRetry={() => void loadInventory()}
            />
          ) : activePage === 'Analysis' ? (
            <AnalysisWorkspaceContainer projectId={projectId} onOpenReview={() => setActivePage('Reviews')} />
          ) : activePage === 'Curation' ? (
            <CurationWorkspaceContainer projectId={projectId} />
          ) : activePage === 'Reports' ? (
            <ReportsWorkspaceContainer projectId={projectId} />
          ) : activePage === 'PainPhrases' ? (
            <SignalWorkspaceContainer projectId={projectId} kind="pain" onOpenReview={openReviewById} />
          ) : activePage === 'Outcomes' ? (
            <SignalWorkspaceContainer projectId={projectId} kind="outcome" onOpenReview={openReviewById} />
          ) : activePage === 'Objections' ? (
            <SignalWorkspaceContainer projectId={projectId} kind="objection" onOpenReview={openReviewById} />
          ) : activePage === 'EmotionalTriggers' ? (
            <SignalWorkspaceContainer projectId={projectId} kind="emotion" onOpenReview={openReviewById} />
          ) : activePage === 'CopyLab' ? (
            <CopyLabWorkspaceContainer projectId={projectId} onOpenReview={openReviewById} />
          ) : activePage === 'VoiceMap' ? (
            <VoiceMapWorkspaceContainer projectId={projectId} refreshKey={analysisRefreshKey} onOpenReview={openReviewById} onRunSummary={handleRunSummary} />
          ) : null}
        </main>
      </div>
      <ProjectDialog
        open={projectDialogOpen}
        onClose={() => setProjectDialogOpen(false)}
        onCreate={async (name, primaryDecision) => {
          const project = await createProject(name, primaryDecision)
          setProjects((current) => [project, ...current.filter((candidate) => candidate.id !== project.id)])
          setProjectName(project.name)
          setProjectId(project.id)
          setProjectDialogOpen(false)
          setActivePage('Sources')
        }}
      />
      {importedCount !== null ? (
        <div className="import-toast" role="status">
          <Icon icon={Check} size={16} /> {importedCount} records added to {projectName}
          <button aria-label="Dismiss import confirmation" onClick={() => setImportedCount(null)}><Icon icon={X} size={15} /></button>
        </div>
      ) : null}
    </div>
  )
}

export function App() {
  return <AuthGate>{(onSignedOut) => <WorkspaceApp onSignedOut={onSignedOut} />}</AuthGate>
}
