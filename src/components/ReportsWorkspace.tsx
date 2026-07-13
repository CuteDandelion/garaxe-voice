import { AlertTriangle, Check, Download, FilePlus2, FileText, LockKeyhole } from 'lucide-react'
import { Icon } from './Icon'
import './ReportsWorkspace.css'

export type ReportEvidence = {
  id: string
  quote: string
  provider: string | null
  entity: string | null
  rating: number | null
}

export type ReportTheme = {
  id: string
  rank: number
  name: string
  summary: string
  reviewCount: number
  evidence: ReportEvidence[]
}

export type ReportDatasetSummary = {
  found: number
  included: number
  excluded: number
  written: number
  ratingOnly: number
  sourceCount: number
  confidence: string
}

export type ReportSnapshot = {
  id: string
  title: string
  revision: number
  generatedAt: string
  sourceRunId: string
  curationRevision: number
  readiness: 'ready'
  conclusion: string
  interpretation: string
  dataset: ReportDatasetSummary
  themes: ReportTheme[]
}

export type ReportVersion = {
  id: string
  title: string
  revision: number
  generatedAt: string
  sourceRunId: string
  curationRevision: number
}

export type ReportsWorkspaceProps = {
  status: 'loading' | 'error' | 'empty' | 'ready'
  reports: ReportVersion[]
  selectedReport: ReportSnapshot | null
  createTitle: string
  error?: string | null
  creating?: boolean
  downloadingReportId?: string | null
  canCreate?: boolean
  onCreateTitleChange: (title: string) => void
  onCreate: () => void
  onSelect: (reportId: string) => void
  onDownload: (reportId: string) => void
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function VersionList({ reports, selectedId, downloadingReportId, onSelect, onDownload }: Pick<ReportsWorkspaceProps, 'reports' | 'downloadingReportId' | 'onSelect' | 'onDownload'> & { selectedId: string | null }) {
  return (
    <aside className="reports-workspace__versions" aria-labelledby="report-versions-heading">
      <header>
        <p>Published record</p>
        <h2 id="report-versions-heading">Report versions</h2>
      </header>
      <ol>
        {reports.map((report) => {
          const selected = report.id === selectedId
          const downloading = downloadingReportId === report.id
          return (
            <li key={report.id} className={selected ? 'is-selected' : undefined}>
              <button type="button" className="reports-workspace__version-select" aria-current={selected ? 'true' : undefined} onClick={() => onSelect(report.id)}>
                <span>Revision {report.revision}</span>
                <strong>{report.title}</strong>
                <small>{formatDate(report.generatedAt)}</small>
                <em>Run {report.sourceRunId.slice(0, 8)} · Curation {report.curationRevision}</em>
              </button>
              <button type="button" className="reports-workspace__version-download" aria-label={`Download ${report.title} PDF`} onClick={() => onDownload(report.id)} disabled={downloading}>
                <Icon icon={Download} size={15} />
              </button>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}

function CreateReport({ createTitle, creating, canCreate = true, onCreateTitleChange, onCreate }: Pick<ReportsWorkspaceProps, 'createTitle' | 'creating' | 'canCreate' | 'onCreateTitleChange' | 'onCreate'>) {
  const invalid = !createTitle.trim()
  return (
    <form className="reports-workspace__create" onSubmit={(event) => { event.preventDefault(); onCreate() }}>
      <div>
        <label htmlFor="report-title">New immutable report</label>
        <p>Publish the ready curation revision as a permanent snapshot.</p>
      </div>
      <input id="report-title" type="text" value={createTitle} onChange={(event) => onCreateTitleChange(event.target.value)} placeholder="Voice Map report title" disabled={creating || !canCreate} />
      <button type="submit" disabled={creating || invalid || !canCreate}><Icon icon={FilePlus2} size={16} /> {creating ? 'Creating…' : 'Create report'}</button>
      {!canCreate ? <small role="status">Mark the curation run ready before publishing.</small> : null}
    </form>
  )
}

function ReportPreview({ report, downloading, onDownload }: { report: ReportSnapshot; downloading: boolean; onDownload: (reportId: string) => void }) {
  return (
    <article className="reports-workspace__preview" aria-labelledby="selected-report-title">
      <header className="reports-workspace__hero">
        <div>
          <p>Voice Map · Revision {report.revision}</p>
          <h1 id="selected-report-title">{report.title}</h1>
        </div>
        <div className="reports-workspace__hero-actions">
          <span><Icon icon={LockKeyhole} size={14} /> Immutable snapshot</span>
          <button type="button" onClick={() => onDownload(report.id)} disabled={downloading}><Icon icon={Download} size={16} /> {downloading ? 'Preparing PDF…' : 'Download PDF'}</button>
        </div>
      </header>

      <dl className="reports-workspace__provenance" aria-label="Report provenance">
        <div><dt>Readiness</dt><dd><Icon icon={Check} size={13} /> {report.readiness}</dd></div>
        <div><dt>Source run</dt><dd>{report.sourceRunId}</dd></div>
        <div><dt>Curation revision</dt><dd>{report.curationRevision}</dd></div>
        <div><dt>Generated</dt><dd>{formatDate(report.generatedAt)}</dd></div>
      </dl>

      <section className="reports-workspace__conclusion" aria-labelledby="report-conclusion-heading">
        <div>
          <p>Curated conclusion</p>
          <h2 id="report-conclusion-heading">{report.conclusion}</h2>
        </div>
        <p>{report.interpretation}</p>
      </section>

      <dl className="reports-workspace__dataset" aria-label="Snapshot dataset summary">
        <div><dt>Included reviews</dt><dd>{report.dataset.included.toLocaleString()}</dd></div>
        <div><dt>Found</dt><dd>{report.dataset.found.toLocaleString()}</dd></div>
        <div><dt>Excluded</dt><dd>{report.dataset.excluded.toLocaleString()}</dd></div>
        <div><dt>Written</dt><dd>{report.dataset.written.toLocaleString()}</dd></div>
        <div><dt>Rating-only</dt><dd>{report.dataset.ratingOnly.toLocaleString()}</dd></div>
        <div><dt>Sources</dt><dd>{report.dataset.sourceCount}</dd></div>
        <div><dt>Confidence</dt><dd>{report.dataset.confidence}</dd></div>
      </dl>

      <section className="reports-workspace__themes" aria-labelledby="report-themes-heading">
        <header><p>Approved findings</p><h2 id="report-themes-heading">Themes and exact evidence</h2></header>
        <ol>
          {report.themes.map((theme) => (
            <li key={theme.id}>
              <div className="reports-workspace__theme-story">
                <span>{String(theme.rank).padStart(2, '0')}</span>
                <div><h3>{theme.name}</h3><p>{theme.summary}</p><small>{theme.reviewCount.toLocaleString()} supporting reviews</small></div>
              </div>
              <div className="reports-workspace__evidence">
                {theme.evidence.map((evidence) => (
                  <blockquote key={evidence.id}>
                    <p>“{evidence.quote}”</p>
                    <cite>{[evidence.provider, evidence.entity, evidence.rating === null ? null : `${evidence.rating} stars`].filter(Boolean).join(' · ') || 'Source feedback'}</cite>
                  </blockquote>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </article>
  )
}

export function ReportsWorkspace(props: ReportsWorkspaceProps) {
  if (props.status === 'loading') return <main className="reports-workspace reports-workspace__state" aria-live="polite"><FileText aria-hidden="true" /><h1>Opening the report archive.</h1><p>Loading immutable versions and their source revisions.</p></main>
  if (props.status === 'error') return <main className="reports-workspace reports-workspace__state" role="alert"><AlertTriangle aria-hidden="true" /><h1>Reports are unavailable.</h1><p>{props.error || 'The report archive could not be loaded.'}</p></main>

  const selectedId = props.selectedReport?.id ?? null
  return (
    <main className="reports-workspace">
      <CreateReport {...props} />
      {props.status === 'empty' || !props.selectedReport ? (
        <section className="reports-workspace__empty">
          <Icon icon={LockKeyhole} size={22} />
          <p>Report archive</p>
          <h1>Publish the first immutable Voice Map.</h1>
          <span>A report freezes the ready curation revision, dataset summary, approved themes, and exact supporting evidence.</span>
        </section>
      ) : (
        <div className="reports-workspace__layout">
          <ReportPreview report={props.selectedReport} downloading={props.downloadingReportId === props.selectedReport.id} onDownload={props.onDownload} />
          <VersionList reports={props.reports} selectedId={selectedId} downloadingReportId={props.downloadingReportId} onSelect={props.onSelect} onDownload={props.onDownload} />
        </div>
      )}
    </main>
  )
}
