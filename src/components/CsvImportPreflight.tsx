import { useMemo, useRef, useState } from 'react'
import { ArrowRight, FileSpreadsheet, Upload, X } from 'lucide-react'
import {
  canonicalFieldLabels,
  detectMapping,
  parseCsv,
  preflightCsv,
  requiredCanonicalFields,
  sampleCsv,
  type CanonicalField,
  type ColumnMapping,
  type CsvRow,
} from '../lib/csv'
import { prepareImportFile } from '../lib/importFiles'
import type { OriginalImportSource } from '../lib/api'
import { Icon } from './Icon'

export type PreparedCsvImport = {
  fileName: string
  rawCsv: string
  mapping: ColumnMapping
  originalSource: OriginalImportSource
  rows: CsvRow[]
}

type Props = {
  onContinue: (prepared: PreparedCsvImport) => void | Promise<void>
  busy?: boolean
  error?: string | null
  maxRows?: number
  continueLabel?: string
}

const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(sampleCsv)}`

export function CsvImportPreflight({ onContinue, busy = false, error = null, maxRows, continueLabel = 'Continue with CSV' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [rawCsv, setRawCsv] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<CsvRow[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [originalSource, setOriginalSource] = useState<OriginalImportSource | null>(null)
  const [localError, setLocalError] = useState('')
  const result = useMemo(() => preflightCsv({ headers, rows }, mapping), [headers, rows, mapping])

  const reset = () => {
    setFileName(''); setRawCsv(''); setHeaders([]); setRows([]); setMapping({}); setOriginalSource(null); setLocalError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return <section className="csv-preflight" aria-label="CSV import">
    <div className="csv-preflight__intro">
      <span className="upload-icon"><Icon icon={Upload} size={27} /></span>
      <div>
        <h2>Upload customer feedback</h2>
        <p>CSV with feedback ID, source, and comment text. Ratings and rating scales are optional.</p>
        <div className="csv-preflight__links">
          <a href={templateHref} download="voice-lab-feedback-template.csv">Download CSV template</a>
          <details><summary>See required fields</summary><p><strong>Required:</strong> feedback ID, source, comment text. <strong>Optional:</strong> date, rating and scale, author, customer ID, context, title, language, reply, entity, and HTTPS source URL.</p></details>
        </div>
      </div>
      <input ref={inputRef} type="file" accept=".csv,text/csv" aria-label="Choose CSV file" onChange={async (event) => {
        const file = event.target.files?.[0]
        if (!file) return
        setLocalError('')
        try {
          const prepared = await prepareImportFile(file)
          const parsed = parseCsv(prepared.rawCsv)
          if (maxRows && parsed.rows.length > maxRows) throw new Error(`This import is limited to ${maxRows} feedback rows.`)
          setFileName(file.name); setRawCsv(prepared.rawCsv); setHeaders(parsed.headers); setRows(parsed.rows)
          setMapping(detectMapping(parsed.headers)); setOriginalSource(prepared.originalSource)
        } catch (reason) {
          reset()
          setLocalError(reason instanceof Error ? reason.message : 'The CSV could not be read.')
        }
      }} disabled={busy} />
      {!headers.length ? <button className="primary-action" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>Choose CSV file</button> : null}
    </div>

    {headers.length ? <div className="csv-preflight__mapping">
      <header><span><Icon icon={FileSpreadsheet} size={18} /></span><div><strong>{fileName}</strong><small>{rows.length} rows · {headers.length} columns</small></div><button type="button" className="icon-button" aria-label="Remove CSV" onClick={reset}><Icon icon={X} size={16} /></button></header>
      <div className="mapping-table" role="table" aria-label="CSV mapping preview">
        <div className="mapping-row mapping-header" role="row"><span>CSV column</span><span>Example value</span><span>Include as</span></div>
        {headers.map((header) => <div className="mapping-row" role="row" key={header}>
          <strong>{header}</strong><span title={rows[0]?.[header]}>{rows[0]?.[header] || '—'}</span>
          <select aria-label={`Map ${header}`} value={mapping[header] || 'unmapped'} onChange={(event) => setMapping((current) => ({ ...current, [header]: event.target.value as CanonicalField | 'unmapped' | 'excluded' }))}>
            {Object.entries(canonicalFieldLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </div>)}
      </div>
      <section className="csv-preflight__rows" aria-label="Row preview"><h3>Row preview</h3><div>{rows.slice(0, 3).map((row, index) => <p key={index}><strong>Row {index + 2}</strong>{requiredCanonicalFields.map((field) => { const column = headers.find((header) => mapping[header] === field); return <span key={field}>{column ? row[column] || 'Missing' : 'Not mapped'}</span> })}</p>)}</div></section>
      {(result.columnErrors.length || result.rowErrors.length) ? <div className="csv-preflight__errors" role="alert"><strong>Resolve these before analysis</strong><ul>{[...result.columnErrors, ...result.rowErrors.slice(0, 20)].map((item, index) => <li key={`${item.code}-${index}`}>{'row' in item ? `Row ${item.row}, ${canonicalFieldLabels[item.column]}: ${item.message}` : item.message}</li>)}</ul></div> : null}
      <button className="primary-action" type="button" disabled={!result.valid || !originalSource || busy} onClick={() => originalSource && void onContinue({ fileName, rawCsv, mapping, originalSource, rows })}>{busy ? 'Processing CSV…' : continueLabel} <Icon icon={ArrowRight} size={14} /></button>
    </div> : null}
    {localError || error ? <p className="import-error" role="alert">{localError || error}</p> : null}
  </section>
}
