import {
  BarChart3,
  BookOpenText,
  Boxes,
  FileText,
  FolderSearch2,
  Lightbulb,
  ListChecks,
  MessageSquareQuote,
  Rows3,
  ScanSearch,
  Sparkles,
  Target,
} from 'lucide-react'
import { Icon } from './Icon'
import type { Project } from '../lib/api'

const nav = [
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
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '—'
}

export function Sidebar({ open, projects, projectId, activeLabel, dataset, account, onNavigate, onProjectChange, onNewProject, onLogout }: SidebarProps) {
  const confidence = dataset.confidence ? dataset.confidence.charAt(0).toUpperCase() + dataset.confidence.slice(1).toLowerCase() : null
  const accountLabel = account?.displayName || account?.email || 'Signed-in user'
  return (
    <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Project navigation">
      <div className="brand">garaxe.<span>voice</span></div>
      <div className="project-switcher">
        <span>Project</span>
        <div>
          <select aria-label="Switch project" value={projectId ?? ''} onChange={(event) => onProjectChange(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button type="button" aria-label="Create new project" onClick={onNewProject}>+</button>
        </div>
      </div>
      <nav className="side-nav">
        {nav.map(([icon, label]) => (
          <button className={activeLabel === label ? 'active' : ''} key={label} disabled={unavailable.has(label)} aria-disabled={unavailable.has(label)} title={unavailable.has(label) ? 'Coming in the next delivery phase' : undefined} onClick={() => onNavigate(label)}>
            <Icon icon={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="dataset-card">
        <span>Reviews analyzed</span>
        <strong>{dataset.reviews.toLocaleString()}</strong>
        <small>{dataset.sources} {dataset.sources === 1 ? 'source' : 'sources'}</small>
        <span className="confidence-label">Confidence</span>
        <div>{confidence || 'Not analyzed'} {confidence ? <i aria-hidden="true" /> : null}</div>
      </div>
      <div className="profile">
        <span className="avatar">{initials(accountLabel)}</span>
        <span><strong>{accountLabel}</strong><small>{account?.email}{account?.role ? ` · ${account.role}` : ''}</small></span>
        <button type="button" className="logout-button" onClick={onLogout}>Log out</button>
      </div>
    </aside>
  )
}
