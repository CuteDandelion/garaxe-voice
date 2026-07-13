import { useEffect, useId, useRef } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  Clock3,
  GitMerge,
  Pencil,
  Pin,
  Scissors,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Icon } from './Icon'
import './CurationWorkspace.css'

export type CurationDecision = 'pending' | 'approved' | 'edited' | 'rejected'
export type CurationConfidence = 'high' | 'moderate' | 'emerging' | 'weak' | 'insufficient'

export type CurationEvidence = {
  id: string
  reviewId: string
  quote: string
  quoteStart: number
  quoteEnd: number
  originalText: string
  entity: string | null
  provider?: string | null
  rating: number | null
  sourceCreatedAt: string | null
  pinned: boolean
  excluded: boolean
}

function HighlightedFeedback({ evidence }: { evidence: CurationEvidence }) {
  const validSpan = evidence.quoteStart >= 0 && evidence.quoteEnd > evidence.quoteStart
    && evidence.originalText.slice(evidence.quoteStart, evidence.quoteEnd) === evidence.quote
  if (!validSpan) return <blockquote>“{evidence.originalText || evidence.quote}”</blockquote>
  return <blockquote>“{evidence.originalText.slice(0, evidence.quoteStart)}<mark>{evidence.quote}</mark>{evidence.originalText.slice(evidence.quoteEnd)}”</blockquote>
}

export type CurationTheme = {
  id: string
  rank: number
  machine: { name: string; summary: string }
  curated: { name: string; summary: string } | null
  decision: CurationDecision
  confidence: CurationConfidence
  reviewCount: number
  evidence: CurationEvidence[]
  groupingSuggestion?: { action: 'split'; reason: string } | null
}

export type CurationRun = {
  id: string
  createdAt: string
  analysisVersion: string
  pipelineVersion: string
  totalThemes: number
  reviewedThemes: number
  requiredThemes: number
  ready: boolean
}

export type CurationActivity = {
  id: string
  createdAt: string
  actorName: string
  action: string
  themeName?: string | null
}

export type CurationEditDraft = { themeId: string; name: string; summary: string }
export type CurationMergeDraft = { name: string; summary: string }
export type CurationSplitDraft = {
  themeId: string
  firstName: string
  secondName: string
  assignments: Record<string, 'first' | 'second' | 'unassigned'>
}

export type CurationWorkspaceProps = {
  status: 'loading' | 'ready' | 'error'
  run: CurationRun | null
  themes: CurationTheme[]
  activity: CurationActivity[]
  selectedThemeId: string | null
  editDraft: CurationEditDraft | null
  mergeSelection: string[]
  mergeDraft: CurationMergeDraft
  splitDraft: CurationSplitDraft | null
  gateErrors?: string[]
  error?: string | null
  submitting?: boolean
  onThemeSelect: (themeId: string) => void
  onThemeClose: () => void
  onApprove: (themeId: string) => void
  onReject: (themeId: string) => void
  onEditStart: (themeId: string) => void
  onEditDraftChange: (draft: CurationEditDraft) => void
  onEditSave: () => void
  onEditCancel: () => void
  onEvidencePin: (themeId: string, evidenceId: string, pinned: boolean) => void
  onEvidenceExclude: (themeId: string, evidenceId: string, excluded: boolean) => void
  onMergeSelectionChange: (themeIds: string[]) => void
  onMergeDraftChange: (draft: CurationMergeDraft) => void
  onMerge: () => void
  onMergeCancel: () => void
  onSplitStart: (themeId: string) => void
  onSplitDraftChange: (draft: CurationSplitDraft) => void
  onSplit: () => void
  onSplitCancel: () => void
  onMarkReady: () => void
}

const decisionLabels: Record<CurationDecision, string> = {
  pending: 'Needs review',
  approved: 'Approved',
  edited: 'Edited',
  rejected: 'Rejected',
}

function formatDate(value: string | null) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date)
}

function activeName(theme: CurationTheme) {
  return theme.curated?.name || theme.machine.name
}

function DialogFocus({ children, onClose, labelledBy, className }: {
  children: React.ReactNode
  onClose: () => void
  labelledBy: string
  className: string
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus.current?.focus() }
  }, [onClose])

  return (
    <div className="curation-workspace__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside ref={dialogRef} className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>{children}</aside>
    </div>
  )
}

function ThemeEditor({ draft, disabled, onChange, onSave, onCancel }: {
  draft: CurationEditDraft
  disabled: boolean
  onChange: (draft: CurationEditDraft) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <form className="curation-workspace__editor" onSubmit={(event) => { event.preventDefault(); onSave() }}>
      <label>Curated theme name<input data-autofocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} required /></label>
      <label>Curated interpretation<textarea value={draft.summary} onChange={(event) => onChange({ ...draft, summary: event.target.value })} rows={4} required /></label>
      <div className="curation-workspace__form-actions">
        <button type="button" className="curation-workspace__quiet-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="curation-workspace__dark-button" disabled={disabled || !draft.name.trim() || !draft.summary.trim()}>Save curated version</button>
      </div>
    </form>
  )
}

function SplitEditor({ theme, draft, disabled, onChange, onSave, onCancel }: {
  theme: CurationTheme
  draft: CurationSplitDraft
  disabled: boolean
  onChange: (draft: CurationSplitDraft) => void
  onSave: () => void
  onCancel: () => void
}) {
  const firstCount = Object.values(draft.assignments).filter((value) => value === 'first').length
  const secondCount = Object.values(draft.assignments).filter((value) => value === 'second').length
  return (
    <section className="curation-workspace__split" aria-labelledby="curation-split-title">
      <div className="curation-workspace__section-heading">
        <div><p>Split proposal</p><h3 id="curation-split-title">Separate this theme by evidence</h3></div>
        <button type="button" aria-label="Cancel split" onClick={onCancel}><Icon icon={X} size={17} /></button>
      </div>
      <div className="curation-workspace__split-names">
        <label>First theme<input data-autofocus value={draft.firstName} onChange={(event) => onChange({ ...draft, firstName: event.target.value })} required /></label>
        <label>Second theme<input value={draft.secondName} onChange={(event) => onChange({ ...draft, secondName: event.target.value })} required /></label>
      </div>
      <fieldset>
        <legend>Assign every excerpt</legend>
        {theme.evidence.filter((item) => !item.excluded).map((evidence) => (
          <div className="curation-workspace__split-row" key={evidence.id}>
            <HighlightedFeedback evidence={evidence} />
            <div>
              <label><input type="radio" name={`split-${evidence.id}`} checked={draft.assignments[evidence.id] === 'first'} onChange={() => onChange({ ...draft, assignments: { ...draft.assignments, [evidence.id]: 'first' } })} /> First</label>
              <label><input type="radio" name={`split-${evidence.id}`} checked={draft.assignments[evidence.id] === 'second'} onChange={() => onChange({ ...draft, assignments: { ...draft.assignments, [evidence.id]: 'second' } })} /> Second</label>
            </div>
          </div>
        ))}
      </fieldset>
      <div className="curation-workspace__form-actions">
        <span>{firstCount} first · {secondCount} second</span>
        <button type="button" className="curation-workspace__dark-button" disabled={disabled || !draft.firstName.trim() || !draft.secondName.trim() || firstCount === 0 || secondCount === 0} onClick={onSave}>Create two curated themes</button>
      </div>
    </section>
  )
}

function ThemeDrawer({ theme, editDraft, splitDraft, submitting, onClose, onApprove, onReject, onEditStart, onEditDraftChange, onEditSave, onEditCancel, onEvidencePin, onEvidenceExclude, onSplitStart, onSplitDraftChange, onSplit, onSplitCancel }: {
  theme: CurationTheme
  editDraft: CurationEditDraft | null
  splitDraft: CurationSplitDraft | null
  submitting: boolean
  onClose: () => void
  onApprove: (themeId: string) => void
  onReject: (themeId: string) => void
  onEditStart: (themeId: string) => void
  onEditDraftChange: (draft: CurationEditDraft) => void
  onEditSave: () => void
  onEditCancel: () => void
  onEvidencePin: (themeId: string, evidenceId: string, pinned: boolean) => void
  onEvidenceExclude: (themeId: string, evidenceId: string, excluded: boolean) => void
  onSplitStart: (themeId: string) => void
  onSplitDraftChange: (draft: CurationSplitDraft) => void
  onSplit: () => void
  onSplitCancel: () => void
}) {
  const titleId = useId()
  return (
    <DialogFocus onClose={onClose} labelledBy={titleId} className="curation-workspace__drawer">
      <header className="curation-workspace__drawer-header">
        <div><p>Theme {String(theme.rank).padStart(2, '0')} · {decisionLabels[theme.decision]}</p><h2 id={titleId}>{activeName(theme)}</h2></div>
        <button data-autofocus type="button" aria-label="Close theme review" onClick={onClose}><Icon icon={X} size={18} /></button>
      </header>

      <section className="curation-workspace__comparison" aria-label="Machine and curated versions">
        <article><p>Machine proposal</p><h3>{theme.machine.name}</h3><span>{theme.machine.summary}</span></article>
        <article className={theme.curated ? 'has-curation' : ''}><p>Curated layer</p>{theme.curated ? <><h3>{theme.curated.name}</h3><span>{theme.curated.summary}</span></> : <span>No human edits yet. Machine output remains unchanged.</span>}</article>
      </section>

      {theme.groupingSuggestion ? (
        <aside className="curation-workspace__grouping-suggestion">
          <Icon icon={AlertTriangle} size={17} />
          <div><strong>Grouping check recommends a split</strong><span>{theme.groupingSuggestion.reason}</span></div>
        </aside>
      ) : null}

      <div className="curation-workspace__decision-bar" aria-label="Theme review actions">
        <button type="button" onClick={() => onApprove(theme.id)} disabled={submitting}><Icon icon={Check} size={15} /> Approve</button>
        <button type="button" onClick={() => onEditStart(theme.id)} disabled={submitting}><Icon icon={Pencil} size={14} /> Edit</button>
        <button type="button" onClick={() => onSplitStart(theme.id)} disabled={submitting || theme.evidence.filter((item) => !item.excluded).length < 2}><Icon icon={Scissors} size={14} /> Split</button>
        <button type="button" className="is-danger" onClick={() => onReject(theme.id)} disabled={submitting}><Icon icon={X} size={15} /> Reject</button>
      </div>

      {editDraft?.themeId === theme.id ? <ThemeEditor draft={editDraft} disabled={submitting} onChange={onEditDraftChange} onSave={onEditSave} onCancel={onEditCancel} /> : null}
      {splitDraft?.themeId === theme.id ? <SplitEditor theme={theme} draft={splitDraft} disabled={submitting} onChange={onSplitDraftChange} onSave={onSplit} onCancel={onSplitCancel} /> : null}

      <section className="curation-workspace__evidence" aria-labelledby={`${titleId}-evidence`}>
        <div className="curation-workspace__section-heading"><div><p>Full source feedback</p><h3 id={`${titleId}-evidence`}>{theme.evidence.length} source reviews</h3></div><span>{theme.evidence.filter((item) => item.pinned).length} pinned</span></div>
        {theme.evidence.map((evidence) => (
          <article className={evidence.excluded ? 'is-excluded' : ''} key={evidence.id}>
            <HighlightedFeedback evidence={evidence} />
            <p>{evidence.entity || 'Unknown entity'} · {evidence.provider || 'Imported'} · {evidence.rating === null ? 'No rating' : `${evidence.rating} stars`} · {formatDate(evidence.sourceCreatedAt)}</p>
            <div>
              <button type="button" aria-pressed={evidence.pinned} disabled={submitting || evidence.excluded || evidence.pinned} onClick={() => onEvidencePin(theme.id, evidence.id, true)}><Icon icon={Pin} size={13} /> {evidence.pinned ? 'Pinned' : 'Pin evidence'}</button>
              <button type="button" aria-pressed={evidence.excluded} disabled={submitting || evidence.excluded} onClick={() => onEvidenceExclude(theme.id, evidence.id, true)}><Icon icon={Ban} size={13} /> {evidence.excluded ? 'Excluded' : 'Exclude'}</button>
            </div>
          </article>
        ))}
      </section>
    </DialogFocus>
  )
}

function MergeComposer({ themes, selection, draft, submitting, onDraftChange, onMerge, onCancel }: {
  themes: CurationTheme[]
  selection: string[]
  draft: CurationMergeDraft
  submitting: boolean
  onDraftChange: (draft: CurationMergeDraft) => void
  onMerge: () => void
  onCancel: () => void
}) {
  const selected = themes.filter((theme) => selection.includes(theme.id))
  return (
    <form className="curation-workspace__merge" onSubmit={(event) => { event.preventDefault(); onMerge() }} aria-labelledby="merge-heading">
      <div><p>Merge proposal</p><h2 id="merge-heading">Combine {selected.length} related themes</h2><span>{selected.map(activeName).join(' + ')}</span></div>
      <label>Curated name<input value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} required /></label>
      <label>Curated interpretation<textarea value={draft.summary} onChange={(event) => onDraftChange({ ...draft, summary: event.target.value })} rows={2} required /></label>
      <div className="curation-workspace__form-actions">
        <button type="button" className="curation-workspace__quiet-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="curation-workspace__dark-button" disabled={submitting || selected.length < 2 || !draft.name.trim() || !draft.summary.trim()}><Icon icon={GitMerge} size={14} /> Merge themes</button>
      </div>
    </form>
  )
}

export function CurationWorkspace(props: CurationWorkspaceProps) {
  const { status, run, themes, activity, selectedThemeId, mergeSelection, gateErrors = [], error, submitting = false } = props
  const selectedTheme = themes.find((theme) => theme.id === selectedThemeId) ?? null

  if (status === 'loading') return <main className="curation-workspace curation-workspace__state" aria-live="polite"><Clock3 aria-hidden="true" /><h1>Preparing the review queue.</h1><p>Loading machine proposals, source evidence, and the append-only activity record.</p></main>
  if (status === 'error' || !run) return <main className="curation-workspace curation-workspace__state" role="alert"><AlertTriangle aria-hidden="true" /><h1>Curation is unavailable.</h1><p>{error || 'The analysis run could not be loaded.'}</p></main>

  const progress = run.requiredThemes === 0 ? 100 : Math.min(100, Math.round((run.reviewedThemes / run.requiredThemes) * 100))
  const pending = themes.filter((theme) => theme.decision === 'pending').length

  return (
    <main className="curation-workspace">
      <header className="curation-workspace__hero">
        <div>
          <p>Human review · Run {run.id.slice(0, 8)}</p>
          <h1>Shape the machine’s findings without losing the evidence.</h1>
        </div>
        <dl>
          <div><dt>Analysis</dt><dd>{run.analysisVersion}</dd></div>
          <div><dt>Pipeline</dt><dd>{run.pipelineVersion}</dd></div>
          <div><dt>Created</dt><dd>{formatDate(run.createdAt)}</dd></div>
        </dl>
      </header>

      <section className="curation-workspace__readiness" aria-labelledby="curation-readiness-title">
        <div>
          <p>Publication readiness</p>
          <h2 id="curation-readiness-title">{run.ready ? 'Ready for an immutable report.' : `${run.reviewedThemes} of ${run.requiredThemes} required themes reviewed.`}</h2>
          <div className="curation-workspace__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Curation progress"><span style={{ width: `${progress}%` }} /></div>
        </div>
        <div className="curation-workspace__ready-action">
          <span>{pending} pending · {themes.filter((theme) => theme.decision === 'approved' || theme.decision === 'edited').length} accepted</span>
          <button type="button" className="curation-workspace__dark-button" onClick={props.onMarkReady} disabled={submitting || gateErrors.length > 0 || run.ready}><Icon icon={ShieldCheck} size={16} /> {run.ready ? 'Marked ready' : 'Mark ready'}</button>
        </div>
        {gateErrors.length ? <ul className="curation-workspace__gates" role="alert">{gateErrors.map((message) => <li key={message}><AlertTriangle size={14} aria-hidden="true" /> {message}</li>)}</ul> : null}
      </section>

      {mergeSelection.length >= 2 ? <MergeComposer themes={themes} selection={mergeSelection} draft={props.mergeDraft} submitting={submitting} onDraftChange={props.onMergeDraftChange} onMerge={props.onMerge} onCancel={props.onMergeCancel} /> : null}

      <div className="curation-workspace__layout">
        <section aria-labelledby="theme-review-queue">
          <div className="curation-workspace__section-heading curation-workspace__queue-heading"><div><p>Ranked machine proposals</p><h2 id="theme-review-queue">Theme review queue</h2></div><span>Select two or more to merge</span></div>
          <ol className="curation-workspace__queue">
            {themes.map((theme) => {
              const selectedForMerge = mergeSelection.includes(theme.id)
              return (
                <li key={theme.id} className={`is-${theme.decision}`}>
                  <label className="curation-workspace__merge-select"><input type="checkbox" checked={selectedForMerge} aria-label={`Select ${activeName(theme)} for merge`} onChange={() => props.onMergeSelectionChange(selectedForMerge ? mergeSelection.filter((id) => id !== theme.id) : [...mergeSelection, theme.id])} /><span /></label>
                  <button type="button" onClick={() => props.onThemeSelect(theme.id)}>
                    <span className="curation-workspace__rank">{String(theme.rank).padStart(2, '0')}</span>
                    <span className="curation-workspace__theme-copy"><small>{decisionLabels[theme.decision]} · {theme.confidence} confidence</small><strong>{activeName(theme)}</strong><em>{theme.curated?.summary || theme.machine.summary}</em></span>
                    <span className="curation-workspace__theme-metrics"><strong>{theme.reviewCount}</strong><small>reviews</small><strong>{theme.evidence.filter((item) => item.pinned).length}</strong><small>pinned</small></span>
                    <Icon icon={ArrowRight} size={16} />
                  </button>
                </li>
              )
            })}
          </ol>
        </section>

        <aside className="curation-workspace__activity" aria-labelledby="curation-activity-heading">
          <div className="curation-workspace__section-heading"><div><p>Append-only record</p><h2 id="curation-activity-heading">Activity</h2></div></div>
          <ol>{activity.map((item) => <li key={item.id}><span /><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time><p><strong>{item.actorName}</strong> {item.action}{item.themeName ? <> <em>{item.themeName}</em></> : null}</p></li>)}</ol>
          {!activity.length ? <p className="curation-workspace__empty">No curation decisions have been recorded.</p> : null}
        </aside>
      </div>

      {selectedTheme ? <ThemeDrawer
        theme={selectedTheme}
        editDraft={props.editDraft}
        splitDraft={props.splitDraft}
        submitting={submitting}
        onClose={props.onThemeClose}
        onApprove={props.onApprove}
        onReject={props.onReject}
        onEditStart={props.onEditStart}
        onEditDraftChange={props.onEditDraftChange}
        onEditSave={props.onEditSave}
        onEditCancel={props.onEditCancel}
        onEvidencePin={props.onEvidencePin}
        onEvidenceExclude={props.onEvidenceExclude}
        onSplitStart={props.onSplitStart}
        onSplitDraftChange={props.onSplitDraftChange}
        onSplit={props.onSplit}
        onSplitCancel={props.onSplitCancel}
      /> : null}
    </main>
  )
}
