import { useEffect, useMemo, useRef, useState } from 'react'
import { VoiceMapWorkspace, type SynthesizedVoiceMap, type VoiceMapConfidence, type VoiceMapSignalType, type VoiceMapTheme } from './VoiceMapWorkspace'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CoverageSummary } from './CoverageSummary'
import { CurationWorkspaceContainer } from './CurationWorkspaceContainer'
import { CsvImportPreflight, type PreparedCsvImport } from './CsvImportPreflight'
import { getDemoOverviewBrief, type AnalysisCoverageItem, type OverviewBriefResult } from '../lib/api'
import { DEMO_COMMENT_ALLOWANCE } from '../lib/csv'
import { categorizeVisibleSignals, emergingThemesFromCoverage, emptyVoiceMapInsight, publicSentiment, publicSignalType } from './VoiceMapWorkspaceContainer'
import { projectDateRange } from '../lib/dateProjection'
import './PublicLanding.css'

type PublicLandingProps = {
  onLogin: () => void
  onDemo: () => void
}

const publicPages = [
  { page: 'product', label: 'Product' },
  { page: 'examples', label: 'Examples' },
  { page: 'resources', label: 'Resources' },
  { page: 'about', label: 'About' },
]

function PublicPageLinks({ onNavigate }: { onNavigate?: () => void }) {
  return <>{publicPages.map(({ page, label }) => <a key={page} href={`#${page}`} onClick={onNavigate}>{label}</a>)}</>
}

function PublicFooter() {
  return <footer className="public-footer">
    <div><span>Trusted output</span><strong>Source-traceable · Human-approved · Versioned</strong></div>
    <nav aria-label="Footer navigation"><PublicPageLinks /></nav>
    <p>Voice Lab by Elseform · <a href="https://voicelab.elseform.tech">voicelab.elseform.tech</a></p>
  </footer>
}

function ProductRecording({ label, src, loop = false, caption }: { label: string; src: string; loop?: boolean; caption: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [reducedMotion, setReducedMotion] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (reducedMotion) {
      video.pause()
      return
    }
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= .55) void video.play().catch(() => undefined)
      else video.pause()
    }, { threshold: [0, .55] })
    observer.observe(video)
    return () => observer.disconnect()
  }, [reducedMotion])

  return <figure className="public-product-recording">
    <video ref={videoRef} aria-label={label} src={src} poster="/voice-lab-walkthrough-poster.jpg" controls muted playsInline loop={loop} preload="metadata" tabIndex={0} />
    <figcaption>{caption}</figcaption>
  </figure>
}

function PublicSections({ onDemo }: { onDemo: () => void }) {
  return <>
  <section className="public-detail" id="product" aria-labelledby="product-title">
    <section className="public-detail__intro"><p className="public-kicker">Product · Evidence before assertion</p><h2 id="product-title">How Voice Lab turns feedback into trusted output</h2><p>One continuous trail connects authorized source material, semantic analysis, human correction, and immutable reporting.</p></section>
    <section className="public-product"><div><h2>From source material to a Voice Map.</h2><p>Bring the whole authorized source, inspect the analysis, and keep every conclusion one interaction from exact evidence.</p></div><ol><li><b>01</b><strong>Bring the full source</strong><span>Uploads retain the original feedback and source identity.</span></li><li><b>02</b><strong>Map the signals</strong><span>Each valid comment receives a grounded category, topic, and exact quote.</span></li><li><b>03</b><strong>Correct lightly</strong><span>Curation preserves machine output and records human changes separately.</span></li><li><b>04</b><strong>Publish a revision</strong><span>Persistent reports freeze the approved evidence and decision trail.</span></li></ol></section>
    <section className="public-detail__cta"><p>Experience the same dashboard in an isolated temporary workspace.</p><button className="public-button public-button--dark" onClick={onDemo}>Try the demo</button></section>
  </section>
  <section className="public-detail" id="examples" aria-labelledby="examples-title">
    <section className="public-detail__intro"><p className="public-kicker">Examples · Inspectable by design</p><h2 id="examples-title">See the evidence trail, not a black box</h2><p>Conclusions, bubbles, source excerpts, coverage, Curation, and report export stay visibly connected.</p></section>
    <section className="public-example">
      <ProductRecording label="Voice Lab product walkthrough" src="/voice-lab-walkthrough.mp4" caption="Authenticated workspace walkthrough · anonymized local sample" />
      <div><h2>Read the decision. Inspect the trail.</h2><p>The live Overview uses each workspace’s own coverage, categories, counts, and exact evidence. Voice Map remains the separate place for detailed bubble exploration.</p><button className="public-link-button" onClick={onDemo}>Open the sample workspace</button></div>
    </section>
  </section>
  <section className="public-detail" id="resources" aria-labelledby="resources-title">
    <section className="public-detail__intro"><p className="public-kicker">Resources · Trust contract</p><h2 id="resources-title">The operating rules behind trusted output</h2><p>Voice Lab is explicit about what enters a run, what the analysis decides, and what a person changes.</p></section>
    <section className="public-resources"><div><article><strong>Exact evidence</strong><p>Every visible signal links to an excerpt verified against immutable original text.</p></article><article><strong>Complete coverage</strong><p>Every valid retained comment appears exactly once; malformed input is reported plainly.</p></article><article><strong>Versioned analysis</strong><p>Runs record their dataset, method, semantic contract, and output revision.</p></article><article><strong>Temporary demo</strong><p>Demo work is isolated, expires automatically, and never becomes workspace history.</p></article></div></section>
  </section>
  <section className="public-detail" id="about" aria-labelledby="about-title">
    <section className="public-detail__intro"><p className="public-kicker">About · Voice Lab by Elseform</p><h2 id="about-title">Built for decisions that need a source trail</h2><p>Voice Lab helps research, product, service, and positioning teams make decisions from authorized customer feedback without separating claims from proof.</p></section>
    <section className="public-about"><div><strong>What we protect</strong><p>Original language, clear provenance, bounded analysis, visible human judgment, and a strict boundary between temporary demos and persistent workspaces.</p></div><a className="public-button public-button--dark" href="mailto:hello@elseform.tech?subject=Voice%20Lab%20waitlist">Join waitlist</a></section>
  </section>
  </>
}

export function PublicLanding({ onLogin, onDemo }: PublicLandingProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const navigation = <PublicPageLinks onNavigate={() => setMobileNavigationOpen(false)} />
  return <div className="public-site">
    <header className="public-header">
      <a className="public-brand" href="/" aria-label="Voice Lab home">Voice <i>Lab</i></a>
      <nav aria-label="Primary navigation">{navigation}</nav>
      <div className="public-header__actions">
        <button className="public-menu-button" aria-controls="public-mobile-navigation" aria-expanded={mobileNavigationOpen} aria-label={mobileNavigationOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMobileNavigationOpen((open) => !open)}><span /><span /></button>
        <button className="public-link-button" onClick={onLogin}>Log in</button>
        <button className="public-button public-button--dark" onClick={onDemo}>Try the demo</button>
      </div>
      {mobileNavigationOpen ? <nav className="public-mobile-navigation" id="public-mobile-navigation" aria-label="Mobile navigation">{navigation}</nav> : null}
    </header>

    <main id="top">
      <section className="public-hero" aria-labelledby="public-title">
        <div className="public-hero__copy">
          <p className="public-kicker">Customer-language intelligence</p>
          <h1 id="public-title">Turn scattered feedback into <em>evidence.</em></h1>
          <p>Every conclusion stays linked to the exact customer words behind it.</p>
          <div className="public-hero__actions">
            <button className="public-button public-button--dark" onClick={onDemo}>Try the demo</button>
            <a href="#product">See how it works</a>
          </div>
        </div>
        <ProductRecording label="Voice Lab product preview" src="/voice-lab-hero-preview.mp4" loop caption="Authenticated Voice Lab workspace · anonymized sample" />
      </section>

      <section className="public-principle" aria-label="Product principle">
        <p>Not another sentiment score.</p>
        <strong>A decision workspace built from the words customers actually used.</strong>
      </section>

      <section className="public-home-trail"><p className="public-kicker">One product trail</p><div><a href="#product"><span>01</span><strong>Understand the product</strong><small>Source to report, without hidden steps.</small></a><a href="#examples"><span>02</span><strong>Inspect the workspace</strong><small>Dashboard, evidence, Curation, export.</small></a><a href="#resources"><span>03</span><strong>Read the trust contract</strong><small>Coverage, isolation, and versioning.</small></a></div></section>
      <PublicSections onDemo={onDemo} />
    </main>
    <PublicFooter />
  </div>
}

type DemoTheme = {
  id: string
  name: string
  topic?: string
  summary: string
  type: string
  primarySignalType?: string
  signalTypes?: string[]
  categories?: string[]
  sentiment?: string
  confidence: string
  origin?: 'model_confirmed' | 'user_curated'
  evidence: Array<{ reviewId?: string; quote?: string; quoteStart?: number; quoteEnd?: number; originalText?: string; entity?: string; rating?: number; ratingScale?: number; sourceCreatedAt?: string | null }>
}

type DemoResult = {
  status: string
  stage: string
  demo: true
  expiresAt: string
  engine?: string
  themes?: DemoTheme[]
  pdfUrl?: string
  message?: string
  coverage?: AnalysisCoverageItem[]
  quota?: { remaining: number; resetAt: string | null; freshDemoAvailable?: boolean }
}

function remainingCooldownSeconds(resetAt: string) {
  return Math.max(0, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1_000))
}

function formatCooldown(seconds: number) {
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':')
}

export function DemoCooldown({ resetAt, onCheckReady, onStartNewDemo }: {
  resetAt: string
  onCheckReady: () => boolean | Promise<boolean>
  onStartNewDemo: () => void
}) {
  const [seconds, setSeconds] = useState(() => remainingCooldownSeconds(resetAt))
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let checking = false
    let confirmed = false
    const update = async () => {
      const next = remainingCooldownSeconds(resetAt)
      setSeconds(next)
      if (next || checking || confirmed) return
      checking = true
      try {
        confirmed = await onCheckReady()
        if (!cancelled && confirmed) setReady(true)
      } finally {
        checking = false
      }
    }
    void update()
    const timer = window.setInterval(() => void update(), 1_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [onCheckReady, resetAt])

  return ready
    ? <button type="button" className="public-button public-button--dark" onClick={onStartNewDemo}>Start a new demo</button>
    : <span role="timer" aria-live="polite">Available again in {formatCooldown(seconds)}</span>
}

export function PublicDemo({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  const [state, setState] = useState<'ready' | 'running' | 'completed' | 'failed'>('ready')
  const [result, setResult] = useState<DemoResult | null>(null)
  const [message, setMessage] = useState('')
  const [feedbackCount, setFeedbackCount] = useState(0)
  const [stage, setStage] = useState('ready')
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)
  const [mode, setMode] = useState<'read' | 'investigate'>('read')
  const [menuOpen, setMenuOpen] = useState(false)
  const [demoPage, setDemoPage] = useState<'Overview' | 'Voice Map' | 'Analysis' | 'Curation'>('Analysis')
  const [token, setToken] = useState<string | null>(null)
  const [overviewBrief, setOverviewBrief] = useState<OverviewBriefResult | null>(null)
  const [dateRange, setDateRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [importNotice, setImportNotice] = useState('')

  const refreshResult = async (activeToken = token) => {
    if (!activeToken) return
    const response = await fetch(`/api/demo/analysis-runs/${activeToken}`)
    const payload = await response.json() as { data?: DemoResult; error?: { message?: string } }
    if (!response.ok || !payload.data) throw new Error(payload.error?.message || 'The demo result could not be refreshed.')
    setResult(payload.data)
    setOverviewBrief(null)
    void getDemoOverviewBrief(activeToken).then(setOverviewBrief).catch(() => undefined)
  }

  const checkDemoReady = async () => {
    if (!token) return false
    try {
      const response = await fetch(`/api/demo/analysis-runs/${token}`)
      const payload = await response.json() as { data?: DemoResult }
      return Boolean(response.ok && payload.data?.quota?.freshDemoAvailable)
    } catch {
      return false
    }
  }

  const startNewDemo = () => {
    setToken(null); setResult(null); setOverviewBrief(null); setFeedbackCount(0)
    setSelectedThemeId(null); setState('ready'); setStage('ready'); setMessage(''); setImportNotice('')
  }

  const runDemo = async (prepared: PreparedCsvImport) => {
    const appending = Boolean(token)
    setState('running')
    setStage('queued')
    setMessage(appending ? 'Adding this CSV to the temporary project and refreshing its analysis…' : 'Creating an isolated demo project and running the analysis pipeline…')
    try {
      const createdResponse = await fetch(appending ? `/api/demo/analysis-runs/${token}/imports` : '/api/demo/analysis-runs', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: prepared.fileName, rawCsv: prepared.rawCsv, mapping: prepared.mapping }),
      })
      const createdPayload = await createdResponse.json() as { data?: { token: string; expiresAt: string; addedRecords?: number; notImportedRecords?: number }; error?: { message?: string } }
      if (!createdResponse.ok || !createdPayload.data) throw new Error(createdPayload.error?.message || 'The live demo is unavailable.')
      setToken(createdPayload.data.token)
      setFeedbackCount((current) => appending ? current + (createdPayload.data?.addedRecords || 0) : createdPayload.data?.addedRecords || 0)
      const omitted = createdPayload.data.notImportedRecords || 0
      setImportNotice(omitted ? `${createdPayload.data.addedRecords || 0} records imported. ${omitted} ${omitted === 1 ? 'record was' : 'records were'} not imported because the Demo allowance was reached.` : '')
      while (true) {
        const statusResponse = await fetch(`/api/demo/analysis-runs/${createdPayload.data.token}`)
        const statusPayload = await statusResponse.json() as { data?: DemoResult; error?: { message?: string } }
        if (!statusResponse.ok || !statusPayload.data) throw new Error(statusPayload.error?.message || 'The demo status could not be loaded.')
        if (statusPayload.data.status === 'completed') {
          setResult(statusPayload.data)
          setSelectedThemeId(statusPayload.data.themes?.[0]?.id || null)
          setDemoPage('Overview')
          setState('completed')
          setStage('completed')
          setFeedbackCount(statusPayload.data.coverage?.length || 0)
          setMessage(appending ? 'The additional feedback is now included in this temporary project.' : 'Live analysis complete. The result below came from the same versioned engine used by the persistent workspace.')
          void getDemoOverviewBrief(createdPayload.data.token).then(setOverviewBrief).catch(() => undefined)
          return
        }
        if (statusPayload.data.status === 'failed') throw new Error(statusPayload.data.message || 'The live analysis did not complete.')
        setStage(statusPayload.data.stage || statusPayload.data.status)
        setMessage(statusPayload.data.stage === 'interpreting_clusters' ? 'Voice Map intelligence is interpreting the evidence clusters…' : 'The analysis engine is preparing the evidence…')
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
    } catch (error) {
      setState('failed')
      setMessage(error instanceof Error ? error.message : 'The live demo is unavailable.')
    }
  }

  const themes = result?.themes || []
  const mappedThemes: VoiceMapTheme[] = themes.map((theme, index) => { const evidence = theme.evidence.map((item, evidenceIndex) => ({ id: `${theme.id}:${evidenceIndex}`, reviewId: item.reviewId || `${theme.id}:${evidenceIndex}`, quote: item.quote || '', quoteStart: item.quoteStart ?? 0, quoteEnd: item.quoteEnd ?? (item.quote || '').length, originalText: item.originalText || item.quote || '', rating: item.rating ?? null, ratingScale: item.ratingScale ?? null, provider: 'Demo submission', entity: item.entity || 'Demo submission', language: null, sourceCreatedAt: typeof item.sourceCreatedAt === 'string' ? item.sourceCreatedAt : null, sourceUrl: null, strength: 1 })); const type = publicSignalType(theme.primarySignalType || theme.type); return { id: theme.id, rank: index + 1, name: theme.name, topic: theme.topic, type, signalTypes: [type] as VoiceMapSignalType[], sentiment: publicSentiment(theme.sentiment, theme.type === 'praise' ? 'praise' : undefined), summary: theme.summary, confidence: theme.confidence.toLowerCase() as VoiceMapConfidence, representativeQuote: evidence[0]?.quote || null, metrics: { reviewCount: new Set(evidence.map((item) => item.reviewId)).size, signalCount: evidence.length, prevalence: result?.coverage?.length ? evidence.length / result.coverage.length : 0, averageRating: null, trend: null, contradictionRate: 0 }, topPhrases: [], entityBreakdown: [], languageBreakdown: [], evidence } })
  const availableDates = (result?.coverage || []).flatMap((item) => item.source?.sourceCreatedAt?.slice(0, 10) || []).sort()
  const availableDateRange = { from: availableDates[0] || null, to: availableDates.at(-1) || null }
  const projection = useMemo(() => projectDateRange(mappedThemes, result?.coverage || [], dateRange), [dateRange.from, dateRange.to, mappedThemes, result?.coverage])
  const curatedThemeIds = new Set(projection.coverage.filter((item) => item.disposition === 'user_curated').flatMap((item) => item.themeIds))
  const recurringThemeIds = new Set(projection.coverage.filter((item) => item.disposition === 'recurring').flatMap((item) => item.themeIds))
  const curatedThemes = projection.themes.filter((theme) => curatedThemeIds.has(theme.id))
  const confirmedThemes = projection.themes.filter((theme) => recurringThemeIds.has(theme.id) && !curatedThemeIds.has(theme.id))
  const emergingThemes = emergingThemesFromCoverage(projection.coverage)
  const visibleThemes = [...confirmedThemes, ...curatedThemes, ...emergingThemes]
  const lead = confirmedThemes[0]
  const baseSignals: SynthesizedVoiceMap['signals'] = { primaryPain: emptyVoiceMapInsight('primary_pain'), desiredOutcome: emptyVoiceMapInsight('desired_outcome'), mainObjection: emptyVoiceMapInsight('main_objection'), emotionalDriver: emptyVoiceMapInsight('emotional_driver') }
  const filtered = Boolean(dateRange.from || dateRange.to)
  const voiceMap: SynthesizedVoiceMap = { conclusion: filtered ? { title: 'Filtered evidence view', narrative: `${projection.coverage.length} comments fall within this review period.` } : lead ? { title: lead.name, narrative: lead.summary } : { title: 'Actionable signals are emerging from retained feedback.', narrative: `${new Set(visibleThemes.flatMap((theme) => theme.evidence.map((item) => item.reviewId))).size} comments have grounded category homes below. Recurrence and executive conclusions remain unconfirmed.` }, signals: categorizeVisibleSignals(baseSignals, [...confirmedThemes, ...emergingThemes]), phrases: [...confirmedThemes.map((theme) => ({ text: theme.name, count: theme.metrics.reviewCount, themeId: theme.id, themeName: theme.name, category: theme.type, state: 'confirmed' as const })), ...curatedThemes.map((theme) => ({ text: theme.name, count: theme.metrics.reviewCount, themeId: theme.id, themeName: theme.name, category: theme.type, state: 'curated' as const })), ...emergingThemes.map((theme) => ({ text: theme.name, count: 1, themeId: theme.id, themeName: theme.name, category: theme.type, state: 'emerging' as const }))], recommendedMoves: [] }
  const displayedBrief = filtered ? { status: 'evidence_only' as const, schemaVersion: 'overview-intelligence-v1' as const, brief: null, message: 'Clear the date filter to view the full saved intelligence brief.' } : overviewBrief
  const project = { id: 'demo', name: 'Temporary demo', primaryDecision: 'sample analysis' }
  const resetAt = result?.quota?.resetAt ? new Date(result.quota.resetAt) : null
  const quotaExhausted = Boolean(result && result.quota?.remaining === 0 && (resetAt || result.quota.freshDemoAvailable))
  const remaining = result ? (quotaExhausted ? 0 : result.quota?.remaining ?? DEMO_COMMENT_ALLOWANCE) : 10
  return <div className="app-shell demo-dashboard">
    <Sidebar demoMode demoCurationReady={state === 'completed'} open={menuOpen} projects={[project]} projectId="demo" activeLabel={demoPage} dataset={{ reviews: result ? projection.coverage.length : feedbackCount, sources: 1, confidence: lead?.confidence || null }} account={null} onNavigate={(label) => { if (label === 'Overview' || label === 'Voice Map' || label === 'Analysis' || (label === 'Curation' && state === 'completed')) setDemoPage(label); setMenuOpen(false) }} onProjectChange={() => undefined} onNewProject={() => undefined} onLogout={onBack} />
    {menuOpen ? <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}
    {importNotice ? <p className="demo-status demo-import-notice" role="status">{importNotice}</p> : null}
    <div className="app-frame"><Topbar demoMode projects={[project]} projectId="demo" title={demoPage} dateRange={{ from: dateRange.from || availableDateRange.from, to: dateRange.to || availableDateRange.to }} availableDateRange={availableDateRange} userInitials="D" account={null} dateFilterBusy={false} onProjectChange={() => undefined} onDateRangeChange={async ({ from, to }) => { setDateRange({ from: from || null, to: to || null }); setDemoPage('Overview') }} onLogout={onBack} onMenu={() => setMenuOpen(true)} onExport={() => { if (result?.pdfUrl) window.location.assign(result.pdfUrl) }} onHome={onBack} />
      <main>{demoPage === 'Curation' && state === 'completed' && token && result ? <CurationWorkspaceContainer projectId={null} dateRange={dateRange} demo={{ token, expiresAt: result.expiresAt, engine: result.engine || 'Voice Map intelligence', coverage: projection.coverage, onChange: () => refreshResult(token) }} /> : (demoPage === 'Overview' || demoPage === 'Voice Map') && state === 'completed' ? <><VoiceMapWorkspace section={demoPage === 'Overview' ? 'overview' : 'voice-map'} mode={demoPage === 'Overview' ? 'overview' : mode} status={visibleThemes.length ? 'ready' : 'empty'} run={{ id: 'temporary-demo', createdAt: new Date().toISOString(), reviewCount: projection.coverage.length, themeCount: confirmedThemes.length, confidence: lead?.confidence || 'insufficient', pipelineVersion: result?.engine || 'Voice Map intelligence' }} voiceMap={voiceMap} themes={visibleThemes} overviewBrief={displayedBrief} selectedThemeId={selectedThemeId} onModeChange={(next) => { if (next !== 'overview') setMode(next) }} onOpenVoiceMap={(next) => { setMode(next); setDemoPage('Voice Map') }} onThemeSelect={setSelectedThemeId} onThemeClose={() => setSelectedThemeId(null)} onOpenReview={() => undefined} onOpenCuration={() => setDemoPage('Curation')} />{demoPage === 'Voice Map' ? <CoverageSummary demo items={projection.coverage} onThemeSelect={setSelectedThemeId} /> : null}{result?.pdfUrl ? <div className="demo-download"><div><strong>Download the temporary demo report.</strong><p>No-store response. No retained download history.</p></div><a className="public-button public-button--dark" href={result.pdfUrl} download>Download demo PDF</a></div> : null}</> : <section className="demo-analysis-panel" aria-label="Temporary demo analysis"><p className="public-kicker">Demo mode · isolated workspace</p><h1>{quotaExhausted ? 'Demo upload allowance used.' : result ? `Add up to ${remaining} more feedback records.` : `Analyze up to ${DEMO_COMMENT_ALLOWANCE} feedback records.`}</h1><p>{result ? 'Additional CSVs stay inside this temporary workspace and never carry into another project. Each accepted import refreshes the analysis over all feedback in this project.' : `A CSV can contain more rows. Voice Lab imports the first ${DEMO_COMMENT_ALLOWANCE} eligible unique records; additional CSVs append until the Demo allowance is reached. It expires after 24 hours.`}</p>{result && !quotaExhausted ? <p><strong>{remaining} comments remain</strong> in this Demo allowance.</p> : null}{quotaExhausted ? <div className="demo-quota" role="status"><strong>Demo upload limit reached.</strong>{result?.quota?.freshDemoAvailable ? <button type="button" className="public-button public-button--dark" onClick={startNewDemo}>Start a new demo</button> : <DemoCooldown resetAt={resetAt!.toISOString()} onCheckReady={checkDemoReady} onStartNewDemo={startNewDemo} />}</div> : <CsvImportPreflight onContinue={runDemo} busy={state === 'running'} error={state === 'failed' ? message : null} maxRows={remaining} />}<section className="demo-analysis-flow" aria-label="Upload and analysis flow"><p className={`demo-status demo-status--${state}`} aria-live="polite">{message || 'Choose a CSV, confirm its column mapping, then start analysis.'}</p><ol className="demo-progress" aria-label="Analysis progress">{[['queued','Upload & map'],['interpreting_clusters','Analyze'],['completed','Ready']].map(([key,label]) => <li key={key} aria-current={stage === key ? 'step' : undefined}>{label}</li>)}</ol></section></section>}</main>
    </div>
  </div>
}
