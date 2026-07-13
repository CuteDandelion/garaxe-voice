import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, FileSpreadsheet, Upload, X } from 'lucide-react'
import {
  canonicalFieldLabels,
  detectMapping,
  parseCsv,
  sampleCsv,
  summarizeImport,
  type CanonicalField,
  type ColumnMapping,
  type CsvRow,
} from '../lib/csv'
import { Icon } from './Icon'
import {
  createImport, discoverGoogleEntities, disconnectGoogleConnection, getGoogleConnection, listGoogleEntities, probeGoogleConnection,
  selectGoogleLocations, startGoogleConnection, syncGoogleReviews, waitForImport,
  type GoogleAccessProbe, type GoogleConnection, type GoogleEntity, type OriginalImportSource,
} from '../lib/api'
import { pastedFeedbackToCsv, prepareImportFile } from '../lib/importFiles'

type SourcesWorkspaceProps = {
  projectId: string | null
  onImported: (count: number) => void
}

export function SourcesWorkspace({ projectId, onImported }: SourcesWorkspaceProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<CsvRow[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [complete, setComplete] = useState(false)
  const [rawCsv, setRawCsv] = useState('')
  const [jobStatus, setJobStatus] = useState<'idle' | 'queued' | 'processing' | 'failed'>('idle')
  const [serverError, setServerError] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [originalSource, setOriginalSource] = useState<OriginalImportSource | null>(null)
  const [googleConnection, setGoogleConnection] = useState<GoogleConnection | null>(null)
  const [googleProbe, setGoogleProbe] = useState<GoogleAccessProbe | null>(null)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleError, setGoogleError] = useState('')
  const [googleEntities, setGoogleEntities] = useState<GoogleEntity[]>([])

  useEffect(() => {
    reset()
    setGoogleConnection(null)
    setGoogleProbe(null)
    setGoogleBusy(false)
    setGoogleError('')
    setGoogleEntities([])
  }, [projectId])

  useEffect(() => {
    let active = true
    if (!projectId) return () => { active = false }
    void getGoogleConnection(projectId).then(async (connection) => {
      if (!active) return
      setGoogleConnection(connection)
      if (connection?.status === 'connected') setGoogleEntities(await listGoogleEntities(projectId).catch(() => []))
    }).catch(() => undefined)
    return () => { active = false }
  }, [projectId])

  const summary = useMemo(() => summarizeImport(rows, mapping), [rows, mapping])

  function loadText(name: string, text: string, source: OriginalImportSource = { encoding: 'utf8', content: text, mediaType: 'text/csv' }) {
    const parsed = parseCsv(text)
    setFileName(name)
    setHeaders(parsed.headers)
    setRows(parsed.rows)
    setMapping(detectMapping(parsed.headers))
    setComplete(false)
    setRawCsv(text)
    setJobStatus('idle')
    setServerError('')
    setPasteText('')
    setOriginalSource(source)
  }

  function reset() {
    setFileName('')
    setHeaders([])
    setRows([])
    setMapping({})
    setComplete(false)
    setRawCsv('')
    setJobStatus('idle')
    setServerError('')
    setPasteText('')
    setOriginalSource(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <section className="sources-workspace" aria-label="Sources and imports">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Sources</p>
          <h1>Bring in the words your customers already use.</h1>
        </div>
        <p>Upload a review export, confirm what each column means, and see exactly which records can support a Voice Map before analysis begins.</p>
      </header>

      <section className="google-connection-panel" aria-label="Google Business Profile connection">
        <div>
          <p className="eyebrow">Authorized source</p>
          <h2>Google Business Profile</h2>
          <p>Connect only locations this organization owns or manages. Authorization, account discovery, location discovery, and review access are verified separately.</p>
        </div>
        <div className="google-connection-actions">
          <strong>{googleConnection?.status === 'connected' ? 'Connected' : 'Not connected'}</strong>
          {!googleConnection || googleConnection.status === 'revoked' ? <button className="primary-action" disabled={!projectId || googleBusy} onClick={async () => {
            if (!projectId) return
            setGoogleBusy(true); setGoogleError('')
            try { window.location.assign((await startGoogleConnection(projectId)).authorizationUrl) }
            catch (error) { setGoogleError(error instanceof Error ? error.message : 'Google authorization could not start.'); setGoogleBusy(false) }
          }}>{googleBusy ? 'Opening Google…' : 'Connect Google'}</button> : <>
            <button className="primary-action" disabled={googleBusy} onClick={async () => {
              if (!projectId) return
              setGoogleBusy(true); setGoogleError('')
              try {
                const probe = await probeGoogleConnection(projectId)
                setGoogleProbe(probe)
                if (probe.locationAccess === 'passed') setGoogleEntities(await discoverGoogleEntities(projectId))
              }
              catch (error) { setGoogleError(error instanceof Error ? error.message : 'Google access could not be tested.') }
              finally { setGoogleBusy(false) }
            }}>{googleBusy ? 'Testing access…' : 'Test full access'}</button>
            <button className="text-action" onClick={async () => {
              if (!projectId) return
              setGoogleBusy(true)
              try { await disconnectGoogleConnection(projectId); setGoogleConnection(null); setGoogleProbe(null); setGoogleEntities([]) }
              catch (error) { setGoogleError(error instanceof Error ? error.message : 'Google could not be disconnected.') }
              finally { setGoogleBusy(false) }
            }}>Disconnect</button>
          </>}
        </div>
        {googleProbe ? <dl className="google-access-probe">
          <div><dt>OAuth token</dt><dd>{googleProbe.authentication}</dd></div>
          <div><dt>Business account</dt><dd>{googleProbe.accountAccess}</dd></div>
          <div><dt>Managed location</dt><dd>{googleProbe.locationAccess}</dd></div>
          <div><dt>Full review text</dt><dd>{googleProbe.reviewAccess}</dd></div>
        </dl> : null}
        {googleEntities.some((entity) => entity.entityType === 'location') ? <div className="google-location-picker">
          <div><p className="eyebrow">Managed locations</p><strong>Select what should enter this Voice Map</strong></div>
          {googleEntities.filter((entity) => entity.entityType === 'location').map((entity) => <label key={entity.id}>
            <input type="checkbox" checked={entity.selected} disabled={!entity.available || googleBusy} onChange={() => setGoogleEntities((current) => current.map((item) => item.id === entity.id ? { ...item, selected: !item.selected } : item))} />
            <span>{entity.name}<small>{entity.accountExternalId}</small></span>
          </label>)}
          <div className="google-location-actions">
            <button className="text-action" disabled={googleBusy} onClick={async () => {
              if (!projectId) return
              setGoogleBusy(true); setGoogleError('')
              try { setGoogleEntities(await selectGoogleLocations(projectId, googleEntities.filter((entity) => entity.entityType === 'location' && entity.selected).map((entity) => entity.externalId))) }
              catch (error) { setGoogleError(error instanceof Error ? error.message : 'Location selection could not be saved.') }
              finally { setGoogleBusy(false) }
            }}>Save selection</button>
            <button className="primary-action" disabled={googleBusy || !googleEntities.some((entity) => entity.entityType === 'location' && entity.selected)} onClick={async () => {
              if (!projectId) return
              setGoogleBusy(true); setGoogleError('')
              try {
                await selectGoogleLocations(projectId, googleEntities.filter((entity) => entity.entityType === 'location' && entity.selected).map((entity) => entity.externalId))
                const job = await syncGoogleReviews(projectId)
                const completed = await waitForImport(job.id)
                if (completed.status === 'failed') throw new Error(completed.errorMessage || 'Google review sync failed.')
                onImported(completed.usableRows)
              } catch (error) { setGoogleError(error instanceof Error ? error.message : 'Google reviews could not be synced.') }
              finally { setGoogleBusy(false) }
            }}>{googleBusy ? 'Syncing reviews…' : 'Sync selected reviews'}</button>
          </div>
        </div> : null}
        {googleError ? <p className="import-error" role="alert">{googleError}</p> : null}
      </section>

      {headers.length === 0 ? (
        <div className="source-start-grid">
          <section className="upload-panel">
            <span className="upload-icon"><Icon icon={Upload} size={27} /></span>
            <h2>Upload customer feedback</h2>
            <p>CSV, XLSX, and JSON exports from review platforms, survey tools, or your own systems. Original columns are preserved.</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Upload customer feedback file"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                try {
                  const prepared = await prepareImportFile(file)
                  loadText(file.name, prepared.rawCsv, prepared.originalSource)
                } catch (error) {
                  setServerError(error instanceof Error ? error.message : 'The file could not be read.')
                }
              }}
            />
            <button className="primary-action" onClick={() => inputRef.current?.click()}>Choose feedback file</button>
            <button className="text-action" onClick={() => loadText('garaxe-sample-reviews.csv', sampleCsv)}>Use sample dataset <Icon icon={ArrowRight} size={14} /></button>
            <div className="paste-feedback">
              <label htmlFor="pasted-feedback">Or paste feedback</label>
              <textarea id="pasted-feedback" value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="One review per line, or paste a JSON review array" />
              <button className="text-action" disabled={!pasteText.trim()} onClick={() => {
                try { loadText('pasted-feedback.csv', pastedFeedbackToCsv(pasteText), { encoding: 'utf8', content: pasteText, mediaType: 'text/plain' }) }
                catch (error) { setServerError(error instanceof Error ? error.message : 'Pasted feedback could not be read.') }
              }}>Map pasted feedback <Icon icon={ArrowRight} size={14} /></button>
            </div>
            {serverError ? <p className="import-error" role="alert">{serverError}</p> : null}
          </section>
          <aside className="import-guidance">
            <p className="eyebrow">Recommended columns</p>
            <ol>
              <li><b>Review text</b><span>The customer’s exact words</span></li>
              <li><b>Rating</b><span>Any numeric rating scale</span></li>
              <li><b>Review date</b><span>Needed for change over time</span></li>
              <li><b>Location or product</b><span>Enables meaningful comparison</span></li>
            </ol>
            <p>Only review text or rating is required. Unknown columns remain available as metadata.</p>
          </aside>
        </div>
      ) : complete ? (
        <section className="import-complete">
          <span className="complete-icon"><Icon icon={Check} size={28} /></span>
          <p className="eyebrow">Import complete</p>
          <h2>{summary.usable.toLocaleString()} usable records are ready.</h2>
          <p>{summary.written} written reviews can support qualitative analysis. {summary.ratingOnly} rating-only record remains available for rating trends.</p>
          <div>
            <button className="primary-action" onClick={() => onImported(summary.usable)}>Open review inventory</button>
            <button className="text-action" onClick={reset}>Import another file</button>
          </div>
        </section>
      ) : (
        <div className="mapping-workspace">
          <section className="mapping-main">
            <div className="file-summary">
              <span><Icon icon={FileSpreadsheet} size={20} /></span>
              <div><strong>{fileName}</strong><small>{rows.length} rows · {headers.length} columns</small></div>
              <button className="icon-button" aria-label="Remove feedback source" onClick={reset}><Icon icon={X} size={17} /></button>
            </div>
            <div className="mapping-heading">
              <div><p className="eyebrow">Column mapping</p><h2>Confirm what each column means</h2></div>
              <span>{Object.values(mapping).filter((field) => field !== 'unmapped').length} detected</span>
            </div>
            <div className="mapping-table" role="table" aria-label="Feedback column mapping">
              <div className="mapping-row mapping-header" role="row"><span>Uploaded column</span><span>Example value</span><span>Map to</span></div>
              {headers.map((header) => (
                <div className="mapping-row" role="row" key={header}>
                  <strong>{header}</strong>
                  <span title={rows[0]?.[header]}>{rows[0]?.[header] || '—'}</span>
                  <select
                    aria-label={`Map ${header}`}
                    value={mapping[header] ?? 'unmapped'}
                    onChange={(event) => setMapping((current) => ({ ...current, [header]: event.target.value as CanonicalField | 'unmapped' }))}
                  >
                    {Object.entries(canonicalFieldLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </section>
          <aside className="quality-panel">
            <p className="eyebrow">Import preview</p>
            <strong className="quality-total">{summary.usable}</strong>
            <span>usable records</span>
            <dl>
              <div><dt>Written reviews</dt><dd>{summary.written}</dd></div>
              <div><dt>Rating-only</dt><dd>{summary.ratingOnly}</dd></div>
              <div><dt>Duplicates</dt><dd>{summary.duplicates}</dd></div>
              <div><dt>Invalid rows</dt><dd>{summary.invalid}</dd></div>
            </dl>
            {summary.warnings.map((warning) => <p className="import-warning" key={warning}>{warning}</p>)}
            {serverError ? <p className="import-error" role="alert">{serverError}</p> : null}
            <button
              className="primary-action"
              disabled={summary.usable === 0 || !projectId || jobStatus === 'queued' || jobStatus === 'processing'}
              onClick={async () => {
                if (!projectId) return
                setServerError('')
                setJobStatus('queued')
                try {
                  if (!originalSource) throw new Error('The original source is unavailable. Please select it again.')
                  const job = await createImport({ projectId, fileName, rawCsv, mapping, originalSource })
                  setJobStatus('processing')
                  const completed = await waitForImport(job.id)
                  if (completed.status === 'failed') throw new Error(completed.errorMessage || 'Import failed.')
                  setComplete(true)
                  onImported(completed.usableRows)
                } catch (reason) {
                  setJobStatus('failed')
                  setServerError(reason instanceof Error ? reason.message : 'Import failed.')
                }
              }}
            >
              {jobStatus === 'queued' ? 'Queueing import…' : jobStatus === 'processing' ? 'Processing rows…' : `Import ${summary.usable} records`}
            </button>
            <small>Original rows and unmapped columns will be preserved.</small>
          </aside>
        </div>
      )}
    </section>
  )
}
