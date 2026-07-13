import {
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  FileText,
  ShieldCheck,
} from 'lucide-react'
import { Icon } from './Icon'
import type { AnalysisLlmProgress } from '../lib/api'
import './AnalysisWorkspace.css'

export type AnalysisObjective =
  | 'full_voice_map'
  | 'complaints'
  | 'positive_language'
  | 'operational_issues'
  | 'purchase_drivers'

export type AnalysisConfig = {
  objective: AnalysisObjective
  dateFrom: string
  dateTo: string
  entityIds: string[]
  ratings: number[]
  languages: string[]
  writtenOnly: boolean
  minimumTextLength: number
}

export type AnalysisOption = {
  value: string
  label: string
  count?: number
}

export type AnalysisPreview = {
  found: number
  eligible: number
  excluded: number
}

export type AnalysisStage = {
  key: string
  label: string
  detail?: string
  state: 'complete' | 'active' | 'pending'
}

export type AnalysisMembership = {
  reviewId: string
  quote: string | null
  entity: string | null
  rating: number | null
  language: string | null
  membership: 'included' | 'excluded'
  exclusionReason?: string | null
}

export type DataQualityReport = {
  runId: string
  createdAt: string
  configurationVersion: string
  pipelineVersion: string
  found: number
  included: number
  excluded: number
  written: number
  ratingOnly: number
  averageTextLength: number
  medianTextLength: number
  duplicateGroups: number
  confidence: 'High' | 'Moderate' | 'Emerging' | 'Weak' | 'Insufficient'
  exclusionReasons: Array<{ reason: string; count: number }>
  languages: Array<{ language: string; count: number }>
  semanticAnalysis?: {
    pipelineVersion: string
    clusteringVersion: string
    segmentCount: number
    clusterCount: number
    clusteredSegmentCount: number
    outlierCount: number
    ambiguousSegmentCount: number
    similarityThreshold: number
  }
  membership: AnalysisMembership[]
}

export type AnalysisWorkspaceProps = {
  status: 'configure' | 'processing' | 'completed' | 'failed'
  config: AnalysisConfig
  entityOptions: AnalysisOption[]
  languageOptions: AnalysisOption[]
  preview: AnalysisPreview | null
  previewLoading?: boolean
  canRun?: boolean
  stages?: AnalysisStage[]
  llmProgress?: AnalysisLlmProgress | null
  activeRunId?: string | null
  activeRunStartedAt?: string | null
  report?: DataQualityReport | null
  error?: string | null
  onConfigChange: (config: AnalysisConfig) => void
  onRun: () => void
  onRetry?: () => void
  onOpenReview?: (reviewId: string) => void
}

const objectiveLabels: Record<AnalysisObjective, string> = {
  full_voice_map: 'Full Voice Map',
  complaints: 'Complaint analysis',
  positive_language: 'Positive language',
  operational_issues: 'Operational issues',
  purchase_drivers: 'Purchase drivers',
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date)
}

function updateSelection(values: string[], value: string, checked: boolean) {
  return checked ? [...new Set([...values, value])] : values.filter((item) => item !== value)
}

function ConfigureAnalysis({
  config,
  entityOptions,
  languageOptions,
  preview,
  previewLoading,
  canRun,
  onConfigChange,
  onRun,
}: Pick<
  AnalysisWorkspaceProps,
  | 'config'
  | 'entityOptions'
  | 'languageOptions'
  | 'preview'
  | 'previewLoading'
  | 'canRun'
  | 'onConfigChange'
  | 'onRun'
>) {
  const setConfig = <K extends keyof AnalysisConfig>(key: K, value: AnalysisConfig[K]) =>
    onConfigChange({ ...config, [key]: value })

  return (
    <>
      <header className="analysis-workspace__heading">
        <div>
          <p className="analysis-workspace__label">New analysis</p>
          <h1>Decide what the evidence should answer.</h1>
        </div>
        <p>Freeze a precise dataset before interpretation begins. Every included and excluded review will remain attached to this run.</p>
      </header>

      <div className="analysis-workspace__configuration">
        <form className="analysis-workspace__form" onSubmit={(event) => { event.preventDefault(); onRun() }}>
          <fieldset className="analysis-workspace__section analysis-workspace__section--objective">
            <legend><span>01</span> Objective</legend>
            <div className="analysis-workspace__objective-grid">
              {(Object.entries(objectiveLabels) as Array<[AnalysisObjective, string]>).map(([value, label]) => (
                <label key={value} className={config.objective === value ? 'is-selected' : ''}>
                  <input type="radio" name="analysis-objective" value={value} checked={config.objective === value} onChange={() => setConfig('objective', value)} />
                  <span>{label}</span>
                  <Icon icon={ArrowRight} size={15} />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="analysis-workspace__section">
            <legend><span>02</span> Evidence window</legend>
            <div className="analysis-workspace__field-grid">
              <label>From<input type="date" value={config.dateFrom} onChange={(event) => setConfig('dateFrom', event.target.value)} /></label>
              <label>To<input type="date" value={config.dateTo} onChange={(event) => setConfig('dateTo', event.target.value)} /></label>
              <label>Minimum text length<input type="number" min="0" max="10000" step="1" value={config.minimumTextLength} onChange={(event) => setConfig('minimumTextLength', Math.max(0, Number(event.target.value)))} /></label>
              <label className="analysis-workspace__switch"><input type="checkbox" checked={config.writtenOnly} onChange={(event) => setConfig('writtenOnly', event.target.checked)} /><span aria-hidden="true" /><b>Written feedback only</b></label>
            </div>
          </fieldset>

          <fieldset className="analysis-workspace__section">
            <legend><span>03</span> Entities</legend>
            <div className="analysis-workspace__check-list">
              {entityOptions.map((option) => (
                <label key={option.value}>
                  <input type="checkbox" checked={config.entityIds.includes(option.value)} onChange={(event) => setConfig('entityIds', updateSelection(config.entityIds, option.value, event.target.checked))} />
                  <span>{option.label}</span>
                  {option.count === undefined ? null : <small>{option.count.toLocaleString()} reviews</small>}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="analysis-workspace__paired-sections">
            <fieldset className="analysis-workspace__section">
              <legend><span>04</span> Ratings</legend>
              <div className="analysis-workspace__rating-list">
                {[5, 4, 3, 2, 1].map((rating) => (
                  <label key={rating}><input type="checkbox" checked={config.ratings.includes(rating)} onChange={(event) => setConfig('ratings', updateSelection(config.ratings.map(String), String(rating), event.target.checked).map(Number))} /><span>{rating} star{rating === 1 ? '' : 's'}</span></label>
                ))}
              </div>
            </fieldset>
            <fieldset className="analysis-workspace__section">
              <legend><span>05</span> Languages</legend>
              <div className="analysis-workspace__language-list">
                {languageOptions.map((option) => (
                  <label key={option.value}><input type="checkbox" checked={config.languages.includes(option.value)} onChange={(event) => setConfig('languages', updateSelection(config.languages, option.value, event.target.checked))} /><span>{option.label}</span>{option.count === undefined ? null : <small>{option.count}</small>}</label>
                ))}
              </div>
            </fieldset>
          </div>

          <footer className="analysis-workspace__run-bar">
            <div aria-live="polite" aria-busy={previewLoading}>
              {previewLoading ? <><span className="analysis-workspace__spinner" aria-hidden="true" /> Checking eligibility…</> : preview ? <><strong>{preview.eligible.toLocaleString()} reviews are eligible.</strong><span>{preview.found.toLocaleString()} found · {preview.excluded.toLocaleString()} excluded by this configuration</span></> : <><strong>Configure the evidence window.</strong><span>Eligibility will be calculated before the run starts.</span></>}
            </div>
            <button type="submit" disabled={!canRun || previewLoading}>Run analysis <Icon icon={ArrowRight} size={15} /></button>
          </footer>
        </form>

        <aside className="analysis-workspace__principle">
          <Icon icon={ShieldCheck} size={24} />
          <p className="analysis-workspace__label">Reproducible by design</p>
          <blockquote>“The dataset is decided before the conclusion is written.”</blockquote>
          <p>When this run starts, its filters and membership become immutable. A changed question creates a new run—not a silent rewrite.</p>
        </aside>
      </div>
    </>
  )
}

function elapsedLabel(startedAt: string | null | undefined) {
  if (!startedAt) return 'Starting now'
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1_000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s elapsed`
  const minutes = Math.floor(elapsedSeconds / 60)
  return `${minutes}m ${elapsedSeconds % 60}s elapsed`
}

function progressStatus(llmProgress: AnalysisLlmProgress) {
  const waiting = llmProgress.waiting + llmProgress.queued
  const outcomes = [
    llmProgress.fallback > 0 ? `${llmProgress.fallback} job${llmProgress.fallback === 1 ? '' : 's'} used governed fallback.` : '',
    llmProgress.failed > 0 ? `${llmProgress.failed} job${llmProgress.failed === 1 ? '' : 's'} failed without a usable fallback.` : '',
  ].filter(Boolean).join(' ')
  if (llmProgress.inFlight === 0 && llmProgress.remaining > 0) {
    return `${waiting} job${waiting === 1 ? '' : 's'} are waiting for provider capacity; retries are automatic.${outcomes ? ` ${outcomes}` : ''}`
  }
  return outcomes || 'All finished jobs have passed without terminal fallback.'
}

function ProcessingAnalysis({
  stages = [], llmProgress, activeRunId, activeRunStartedAt,
}: Pick<AnalysisWorkspaceProps, 'stages' | 'llmProgress' | 'activeRunId' | 'activeRunStartedAt'>) {
  const active = stages.find((stage) => stage.state === 'active')
  return (
    <div className="analysis-workspace__processing" aria-live="polite" aria-busy="true">
      <span className="analysis-workspace__processing-mark" aria-hidden="true"><span /></span>
      <p className="analysis-workspace__label">Analysis in progress</p>
      <h1>{active?.label ?? 'Assembling the evidence.'}</h1>
      <p>{active?.detail ?? 'Every review is being assigned an explicit inclusion decision before interpretation begins.'}</p>
      {llmProgress ? (
        <section className="analysis-workspace__llm-progress" aria-label="LLM interpretation progress">
          <header>
            <div><p className="analysis-workspace__label">LLM interpretation</p><strong>{llmProgress.percent}%</strong></div>
            <span>{elapsedLabel(activeRunStartedAt)}</span>
          </header>
          <div
            className="analysis-workspace__progress-track"
            role="progressbar"
            aria-label={`${llmProgress.completed} of ${llmProgress.total} LLM jobs completed`}
            aria-valuemin={0}
            aria-valuemax={llmProgress.total}
            aria-valuenow={llmProgress.completed}
          ><i style={{ width: `${llmProgress.percent}%` }} /></div>
          <dl>
            <div><dt>Jobs complete</dt><dd>{llmProgress.completed}<small> / {llmProgress.total}</small></dd></div>
            <div><dt>Remaining</dt><dd>{llmProgress.remaining}</dd></div>
            <div><dt>Interpreted themes</dt><dd>{llmProgress.interpretedThemes}<small> / {llmProgress.validatedThemes}</small></dd></div>
            <div><dt>Active / waiting</dt><dd>{llmProgress.inFlight}<small> / {llmProgress.waiting + llmProgress.queued}</small></dd></div>
          </dl>
          <footer>
            <span>{progressStatus(llmProgress)}</span>
            <span>{llmProgress.model || 'Default model'}{activeRunId ? ` · run ${activeRunId.slice(0, 8)}` : ''}</span>
          </footer>
        </section>
      ) : null}
      <ol>
        {stages.map((stage) => (
          <li key={stage.key} className={`is-${stage.state}`} aria-current={stage.state === 'active' ? 'step' : undefined}>
            <span>{stage.state === 'complete' ? <Icon icon={Check} size={14} /> : stage.state === 'active' ? <span className="analysis-workspace__spinner" /> : <Icon icon={Clock3} size={13} />}</span>
            <div><strong>{stage.label}</strong>{stage.detail ? <small>{stage.detail}</small> : null}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function CompletedAnalysis({ report, onOpenReview }: Pick<AnalysisWorkspaceProps, 'report' | 'onOpenReview'>) {
  if (!report) return null
  const maxReason = Math.max(1, ...report.exclusionReasons.map((item) => item.count))
  const maxLanguage = Math.max(1, ...report.languages.map((item) => item.count))

  return (
    <>
      <header className="analysis-workspace__report-heading">
        <div>
          <p className="analysis-workspace__label">Data quality report</p>
          <h1>{report.included.toLocaleString()} reviews form the evidence base.</h1>
        </div>
        <div className="analysis-workspace__run-stamp"><Icon icon={ShieldCheck} size={18} /><span>Immutable run</span><strong>{report.runId}</strong><small>{formatDate(report.createdAt)}</small></div>
      </header>

      <dl className="analysis-workspace__metrics" aria-label="Data quality summary">
        <div><dt>Found</dt><dd>{report.found.toLocaleString()}</dd></div>
        <div><dt>Included</dt><dd>{report.included.toLocaleString()}</dd></div>
        <div><dt>Excluded</dt><dd>{report.excluded.toLocaleString()}</dd></div>
        <div><dt>Written</dt><dd>{report.written.toLocaleString()}</dd></div>
        <div><dt>Rating-only</dt><dd>{report.ratingOnly.toLocaleString()}</dd></div>
        <div className={`is-${report.confidence.toLowerCase()}`}><dt>Confidence</dt><dd>{report.confidence}</dd></div>
      </dl>

      <div className="analysis-workspace__report-grid">
        <section className="analysis-workspace__quality-section" aria-labelledby="quality-exclusions-title">
          <header><div><p className="analysis-workspace__label">Exclusions</p><h2 id="quality-exclusions-title">Every omitted record has a reason.</h2></div><strong>{report.excluded.toLocaleString()}</strong></header>
          <ol className="analysis-workspace__bar-list">
            {report.exclusionReasons.map((item) => <li key={item.reason}><div><span>{item.reason}</span><strong>{item.count}</strong></div><span aria-hidden="true"><i style={{ width: `${(item.count / maxReason) * 100}%` }} /></span></li>)}
          </ol>
        </section>
        <section className="analysis-workspace__quality-section" aria-labelledby="quality-language-title">
          <header><div><p className="analysis-workspace__label">Language distribution</p><h2 id="quality-language-title">The evidence remains multilingual.</h2></div><strong>{report.languages.length}</strong></header>
          <ol className="analysis-workspace__bar-list analysis-workspace__bar-list--green">
            {report.languages.map((item) => <li key={item.language}><div><span>{item.language}</span><strong>{item.count}</strong></div><span aria-hidden="true"><i style={{ width: `${(item.count / maxLanguage) * 100}%` }} /></span></li>)}
          </ol>
        </section>
      </div>

      <dl className="analysis-workspace__secondary-metrics">
        <div><dt>Average text length</dt><dd>{report.averageTextLength} characters</dd></div>
        <div><dt>Median text length</dt><dd>{report.medianTextLength} characters</dd></div>
        <div><dt>Duplicate groups</dt><dd>{report.duplicateGroups}</dd></div>
        <div><dt>Configuration</dt><dd>{report.configurationVersion}</dd></div>
        <div><dt>Pipeline</dt><dd>{report.pipelineVersion}</dd></div>
        {report.semanticAnalysis ? <>
          <div><dt>Semantic clusters</dt><dd>{report.semanticAnalysis.clusterCount}</dd></div>
          <div><dt>Clustered claims</dt><dd>{report.semanticAnalysis.clusteredSegmentCount} / {report.semanticAnalysis.segmentCount}</dd></div>
          <div><dt>Unclustered claims</dt><dd>{report.semanticAnalysis.outlierCount}</dd></div>
          <div><dt>Grouping checks</dt><dd>{report.semanticAnalysis.ambiguousSegmentCount}</dd></div>
          <div><dt>Clustering engine</dt><dd>{report.semanticAnalysis.clusteringVersion}</dd></div>
          <div><dt>Similarity floor</dt><dd>{report.semanticAnalysis.similarityThreshold.toFixed(2)}</dd></div>
        </> : null}
      </dl>

      <section className="analysis-workspace__membership" aria-labelledby="analysis-membership-title">
        <header><div><p className="analysis-workspace__label">Dataset membership</p><h2 id="analysis-membership-title">The exact records behind this run.</h2></div><p>Included and excluded decisions remain inspectable for the lifetime of the analysis.</p></header>
        <div className="analysis-workspace__membership-table" role="table" aria-label="Analysis dataset membership">
          <div className="analysis-workspace__membership-row analysis-workspace__membership-row--head" role="row"><span>Status</span><span>Source feedback</span><span>Entity</span><span>Rating</span><span>Language</span></div>
          {report.membership.map((review) => (
            <button type="button" role="row" className="analysis-workspace__membership-row" key={review.reviewId} onClick={() => onOpenReview?.(review.reviewId)} disabled={!onOpenReview}>
              <span role="cell" className={`analysis-workspace__membership-status is-${review.membership}`}>{review.membership === 'included' ? <Icon icon={Check} size={13} /> : <Icon icon={CircleAlert} size={13} />}{review.membership}</span>
              <span role="cell"><strong>{review.quote || 'Rating-only record'}</strong>{review.exclusionReason ? <small>{review.exclusionReason}</small> : null}</span>
              <span role="cell">{review.entity || '—'}</span><span role="cell">{review.rating ?? '—'}</span><span role="cell">{review.language?.toUpperCase() || '—'}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}

export function AnalysisWorkspace(props: AnalysisWorkspaceProps) {
  return (
    <section className="analysis-workspace" aria-label="Analysis workspace">
      {props.status === 'configure' ? <ConfigureAnalysis {...props} /> : null}
      {props.status === 'processing' ? <ProcessingAnalysis stages={props.stages} llmProgress={props.llmProgress} activeRunId={props.activeRunId} activeRunStartedAt={props.activeRunStartedAt} /> : null}
      {props.status === 'completed' ? <CompletedAnalysis report={props.report} onOpenReview={props.onOpenReview} /> : null}
      {props.status === 'failed' ? (
        <div className="analysis-workspace__failure" role="alert"><Icon icon={FileText} size={29} /><p className="analysis-workspace__label">Analysis stopped</p><h1>The evidence run could not be completed.</h1><p>{props.error || 'No source data was changed. Review the error and try this immutable run again.'}</p>{props.onRetry ? <button type="button" onClick={props.onRetry}>Try again <Icon icon={ArrowRight} size={15} /></button> : null}</div>
      ) : null}
    </section>
  )
}
