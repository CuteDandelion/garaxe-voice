import {
  BarChart3,
  BookOpenText,
  Boxes,
  FileText,
  FolderSearch2,
  Lightbulb,
  ListChecks,
  MessageSquareQuote,
  PanelLeftClose,
  PanelLeftOpen,
  Rows3,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'
import { useState } from 'react'
import { Icon } from './Icon'
import type { Project } from '../lib/api'

const nav = [
  [BarChart3, 'Overview'],
  [BookOpenText, 'Voice Map'],
  [FolderSearch2, 'Pain Phrases'],
  [Target, 'Outcomes'],
  [Lightbulb, 'Objections'],
  [Sparkles, 'Emotional Triggers'],
  [Boxes, 'Copy Lab'],
  [MessageSquareQuote, 'Evidence'],
  [Rows3, 'Reviews'],
  [ScanSearch, 'Analysis'],
  [ListChecks, 'Curation'],
  [BarChart3, 'Sources'],
  [FileText, 'Reports'],
] as const

const unavailable = new Set(['Evidence'])

type SidebarProps = {
  open: boolean
  projects: Project[]
  projectId: string | null
  activeLabel: string
  dataset: { reviews: number; sources: number; confidence: string | null }
  account: { displayName: string; email: string; role: string } | null
  onNavigate: (label: string) => void
  onProjectChange: (projectId: string) => void
  onNewProject: () => void
  onLogout: () => void
  demoMode?: boolean
  demoCurationReady?: boolean
  waitlistMonitoring?: boolean
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '—'
}

export function Sidebar({ open, projects, projectId, activeLabel, dataset, account, onNavigate, onProjectChange, onNewProject, onLogout, demoMode = false, demoCurationReady = true, waitlistMonitoring = false }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const confidence = dataset.confidence ? dataset.confidence.charAt(0).toUpperCase() + dataset.confidence.slice(1).toLowerCase() : null
  const accountLabel = account?.displayName || account?.email || 'Signed-in user'
  return (
    <aside className={`sidebar ${open ? 'is-open' : ''} ${collapsed ? 'is-collapsed' : ''}`} aria-label="Project navigation">
      <button type="button" className="sidebar-collapse" aria-label={`${collapsed ? 'Expand' : 'Collapse'} navigation`} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}><Icon icon={collapsed ? PanelLeftOpen : PanelLeftClose} /></button>
      <div className="project-switcher">
        <span>Project</span>
        <div>
          <select aria-label="Switch project" value={projectId ?? ''} disabled={demoMode} onChange={(event) => onProjectChange(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          {!demoMode ? <button type="button" aria-label="Create new project" onClick={onNewProject}>+</button> : null}
        </div>
      </div>
      <nav className="side-nav">
        {[...nav, ...(waitlistMonitoring ? [[ShieldCheck, 'Waitlist'] as const] : [])].map(([icon, label]) => {
          const disabled = unavailable.has(label) || (demoMode && (!['Overview', 'Voice Map', 'Analysis', 'Curation'].includes(label) || (label === 'Curation' && !demoCurationReady)))
          return <button className={activeLabel === label ? 'active' : ''} key={label} disabled={disabled} aria-disabled={disabled} aria-label={collapsed ? label : undefined} title={collapsed ? label : undefined} onClick={() => onNavigate(label)}>
            <Icon icon={icon} />
            <span>{label}</span>
          </button>
        })}
      </nav>
      <div className="dataset-card">
        <span>Reviews analyzed</span>
        <strong>{dataset.reviews.toLocaleString()}</strong>
        <small>{dataset.sources} {dataset.sources === 1 ? 'source' : 'sources'}</small>
        <span className="confidence-label">Confidence</span>
        <div>{confidence || 'Not analyzed'} {confidence ? <i aria-hidden="true" /> : null}</div>
      </div>
      <div className="profile">
        {demoMode ? <><span className="avatar">D</span><span><strong>Demo mode</strong><small>Expires after 24 hours</small></span><button type="button" className="logout-button" onClick={onLogout}>Exit demo</button></> : <>
        <span className="avatar">{initials(accountLabel)}</span>
        <span><strong>{accountLabel}</strong><small>{account?.email}{account?.role ? ` · ${account.role}` : ''}</small></span>
        <button type="button" className="logout-button" onClick={onLogout}>Log out</button>
        </>}
      </div>
    </aside>
  )
}
