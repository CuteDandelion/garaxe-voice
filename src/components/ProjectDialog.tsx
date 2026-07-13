import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Icon } from './Icon'

type ProjectDialogProps = {
  open: boolean
  onClose: () => void
  onCreate: (name: string, primaryDecision: string) => Promise<void>
}

export function ProjectDialog({ open, onClose, onCreate }: ProjectDialogProps) {
  const [name, setName] = useState('')
  const [primaryDecision, setPrimaryDecision] = useState('positioning')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
        <div className="dialog-title-row">
          <div>
            <p className="eyebrow">New project</p>
            <h2 id="project-dialog-title">What should we call this Voice Map?</h2>
          </div>
          <button className="icon-button" aria-label="Close new project" onClick={onClose}><Icon icon={X} size={19} /></button>
        </div>
        <label>
          Project name
          <input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Acme Software" />
        </label>
        <label>
          Primary decision
          <select value={primaryDecision} onChange={(event) => setPrimaryDecision(event.target.value)}>
            <option value="positioning">Improve positioning</option>
            <option value="operations">Find operational issues</option>
            <option value="objections">Understand sales objections</option>
            <option value="explore">Explore customer language</option>
          </select>
        </label>
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <button
          className="primary-action"
          disabled={!name.trim() || saving}
          onClick={async () => {
            setSaving(true)
            setError('')
            try {
              await onCreate(name.trim(), primaryDecision)
              setName('')
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Project could not be created.')
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? 'Creating project…' : 'Create project'}
        </button>
      </section>
    </div>
  )
}
