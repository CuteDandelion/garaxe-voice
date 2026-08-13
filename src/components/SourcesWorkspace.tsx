import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { createImport, waitForImport } from '../lib/api'
import { CsvImportPreflight, type PreparedCsvImport } from './CsvImportPreflight'
import { Icon } from './Icon'

type SourcesWorkspaceProps = {
  projectId: string | null
  onImported: (count: number) => void
}

export function SourcesWorkspace({ projectId, onImported }: SourcesWorkspaceProps) {
  const [status, setStatus] = useState<'ready' | 'processing' | 'complete'>('ready')
  const [error, setError] = useState('')
  const [imported, setImported] = useState(0)

  useEffect(() => { setStatus('ready'); setError(''); setImported(0) }, [projectId])

  const submit = async (prepared: PreparedCsvImport) => {
    if (!projectId) return
    setStatus('processing'); setError('')
    try {
      const job = await createImport({ projectId, fileName: prepared.fileName, rawCsv: prepared.rawCsv, mapping: prepared.mapping, originalSource: prepared.originalSource })
      const completed = await waitForImport(job.id)
      if (completed.status === 'failed') throw new Error(completed.errorMessage || 'Import failed.')
      setImported(completed.usableRows); setStatus('complete'); onImported(completed.usableRows)
    } catch (reason) {
      setStatus('ready'); setError(reason instanceof Error ? reason.message : 'Import failed.')
    }
  }

  return <section className="sources-workspace" aria-label="Sources and imports">
    <header className="workspace-heading"><div><p className="eyebrow">Sources</p><h1>Bring in the words your customers already use.</h1></div><p>Upload a CSV, confirm the mapping, and resolve every validation issue before analysis begins.</p></header>
    {status === 'complete' ? <section className="import-complete"><span className="complete-icon"><Icon icon={Check} size={28} /></span><p className="eyebrow">Import complete</p><h2>{imported.toLocaleString()} feedback records are ready.</h2><div><button className="primary-action" onClick={() => onImported(imported)}>Open review inventory</button><button className="text-action" onClick={() => setStatus('ready')}>Import another CSV</button></div></section> : <CsvImportPreflight key={projectId} onContinue={submit} busy={status === 'processing'} error={error} continueLabel="Import CSV" />}
  </section>
}
