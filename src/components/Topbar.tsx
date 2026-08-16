import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, Menu } from 'lucide-react'
import { Icon } from './Icon'
import type { Project } from '../lib/api'
import { DEMO_COMMENT_ALLOWANCE } from '../lib/csv'

type TopbarProps = {
  projects: Project[]
  projectId: string | null
  title: string
  dateRange: { from: string | null; to: string | null }
  availableDateRange: { from: string | null; to: string | null }
  userInitials: string
  account: { displayName: string; email: string; role: string } | null
  dateFilterBusy: boolean
  onProjectChange: (projectId: string) => void
  onDateRangeChange: (range: { from: string; to: string }) => Promise<void>
  onLogout: () => void
  onMenu: () => void
  onExport: () => void
  onHome: () => void
  demoMode?: boolean
}

function formatDateRange({ from, to }: TopbarProps['dateRange']) {
  const format = (value: string) => new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(value))
  if (from && to) return `${format(from)} – ${format(to)}`
  if (from || to) return format((from || to) as string)
  return 'No review dates'
}

export function Topbar({ projects, projectId, title, dateRange, availableDateRange, userInitials, account, dateFilterBusy, onProjectChange, onDateRangeChange, onLogout, onMenu, onExport, onHome, demoMode = false }: TopbarProps) {
  const [dateOpen, setDateOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [draft, setDraft] = useState({ from: dateRange.from?.slice(0, 10) || '', to: dateRange.to?.slice(0, 10) || '' })
  const [dateError, setDateError] = useState<string | null>(null)
  const fromInput = useRef<HTMLInputElement>(null)
  const toInput = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft({ from: dateRange.from?.slice(0, 10) || '', to: dateRange.to?.slice(0, 10) || '' }), [dateRange.from, dateRange.to])
  const updateDraft = (field: 'from' | 'to', value: string) => setDraft((current) => ({ ...current, [field]: value }))

  async function applyDateRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const range = { from: fromInput.current?.value ?? draft.from, to: toInput.current?.value ?? draft.to }
    if (range.from && range.to && range.from > range.to) return setDateError('The start date must be before the end date.')
    setDateError(null)
    try {
      await onDateRangeChange(range)
      setDateOpen(false)
    } catch (reason) {
      setDateError(reason instanceof Error ? reason.message : 'The date range could not be applied.')
    }
  }
  return (
    <header className="topbar">
      <button className="mobile-menu" aria-label="Open navigation" onClick={onMenu}>
        <Icon icon={Menu} size={20} />
      </button>
      <a className="topbar-home" href="/" aria-label="Voice Lab home" onClick={(event) => { event.preventDefault(); onHome() }}>Voice Lab</a>
      <select className="company-menu" aria-label="Switch project from top bar" value={projectId ?? ''} disabled={demoMode} onChange={(event) => onProjectChange(event.target.value)}>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <span className="topbar-divider" />
      <span className="topbar-title">{title}</span>
      <div className="topbar-actions">
        <div className="topbar-popover-anchor">
          <button className="date-button" aria-label={`Filter review period ${formatDateRange(dateRange)}`} aria-expanded={dateOpen} onClick={() => { setDateOpen((open) => !open); setAccountOpen(false) }}>{dateFilterBusy ? 'Applying range…' : formatDateRange(dateRange)} <Icon icon={CalendarDays} size={15} /></button>
          {dateOpen ? <form className="topbar-popover date-filter-popover" aria-label="Date range filter" noValidate onSubmit={(event) => void applyDateRange(event)}>
            <p>Evidence window</p>
            <label>From<input ref={fromInput} name="from" type="date" value={draft.from} min={availableDateRange.from?.slice(0, 10)} max={availableDateRange.to?.slice(0, 10)} onInput={(event) => updateDraft('from', event.currentTarget.value)} onChange={(event) => updateDraft('from', event.target.value)} /></label>
            <label>To<input ref={toInput} name="to" type="date" value={draft.to} min={availableDateRange.from?.slice(0, 10)} max={availableDateRange.to?.slice(0, 10)} onInput={(event) => updateDraft('to', event.currentTarget.value)} onChange={(event) => updateDraft('to', event.target.value)} /></label>
            {dateError ? <span role="alert">{dateError}</span> : null}
            <div><button type="button" onClick={() => setDraft({ from: '', to: '' })}>All dates</button><button type="submit" disabled={dateFilterBusy}>{dateFilterBusy ? 'Applying…' : 'Apply range'}</button></div>
          </form> : null}
        </div>
        {demoMode ? <span className="demo-mode-label">Temporary demo · {DEMO_COMMENT_ALLOWANCE} records max · expires in 24 hours</span> : null}
        <button className="export-button" onClick={onExport}>Export Voice Map</button>
        {!demoMode ? <div className="topbar-popover-anchor account-anchor">
          <button className="avatar top-avatar" aria-label="Account menu" aria-expanded={accountOpen} onClick={() => { setAccountOpen((open) => !open); setDateOpen(false) }}>{userInitials}</button>
          {accountOpen ? <section className="topbar-popover account-popover" aria-label="Account details">
            <strong>{account?.displayName || account?.email || 'Signed-in user'}</strong>
            <span>{account?.email}</span>
            <small>{account?.role}</small>
            <button type="button" onClick={onLogout}>Log out</button>
          </section> : null}
        </div> : null}
      </div>
    </header>
  )
}
