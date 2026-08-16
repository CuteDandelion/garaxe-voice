import { useEffect, useId, useRef, useState } from 'react'
import type { AnalysisCoverageItem, PrimarySemanticCategory, VoiceSentiment } from '../lib/api'
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
import { customerCoverageReason, customerDispositionLabel } from './CoverageSummary'
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
  category?: PrimarySemanticCategory
  sentiment?: VoiceSentiment
  reviewCount: number
  evidence: CurationEvidence[]
  groupingSuggestion?: { action: 'split'; reason: string } | null
  origin?: 'model_confirmed' | 'user_curated'
}

export type EmergingEvidence = { reviewId: string; originalText: string; reason: string }

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
  demoMode?: boolean
  expiresAt?: string | null
  revision?: number
  emergingEvidence?: EmergingEvidence[]
  coverageItems?: AnalysisCoverageItem[]
  onThemeSelect: (themeId: string) => void
  onThemeClose: () => void
  onApprove: (themeId: string) => void
  onApproveMany: (themeIds: string[]) => void
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
  onCreateCustomTheme: (name: string, summary: string, reviewIds: string[]) => void
  onMoveEvidence: (fromThemeId: string, signalId: string, toThemeId: string) => void
  onRestoreRevision: (revision: number) => void
}

const decisionLabels: Record<CurationDecision, string> = {
  pending: 'Suggested',
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
      <label>Bucket name<input data-autofocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} required /></label>
      <label>Why these comments belong together<textarea value={draft.summary} onChange={(event) => onChange({ ...draft, summary: event.target.value })} rows={4} required /></label>
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

function ThemeDrawer({ theme, themes, editDraft, splitDraft, submitting, onClose, onApprove, onReject, onEditStart, onEditDraftChange, onEditSave, onEditCancel, onEvidencePin, onEvidenceExclude, onMoveEvidence, onCreateCustomTheme, onCombineStart, onSplitStart, onSplitDraftChange, onSplit, onSplitCancel }: {
  theme: CurationTheme
  themes: CurationTheme[]
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
  onMoveEvidence: (fromThemeId: string, signalId: string, toThemeId: string) => void
  onCreateCustomTheme: (name: string, summary: string, reviewIds: string[]) => void
  onCombineStart: (themeId: string) => void
  onSplitStart: (themeId: string) => void
  onSplitDraftChange: (draft: CurationSplitDraft) => void
  onSplit: () => void
  onSplitCancel: () => void
}) {
  const titleId = useId()
  const canSplit = theme.evidence.filter((item) => !item.excluded).length >= 2
  const pending = theme.decision === 'pending'
  const decisionCopy = pending
    ? 'This suggestion is waiting for your decision. Check the source feedback, then accept it or adjust it.'
    : theme.decision === 'approved'
      ? 'This bucket is accepted. Open Adjust only when your team needs a correction.'
      : theme.decision === 'edited'
        ? 'Your correction is saved separately from the original analysis.'
        : 'This suggestion is excluded from the curated map.'
  return (
    <DialogFocus onClose={onClose} labelledBy={titleId} className="curation-workspace__drawer">
      <header className="curation-workspace__drawer-header">
        <div><p>Theme {String(theme.rank).padStart(2, '0')} · {decisionLabels[theme.decision]}</p><h2 id={titleId}>{activeName(theme)}</h2></div>
        <button data-autofocus type="button" aria-label="Close theme review" onClick={onClose}><Icon icon={X} size={18} /></button>
      </header>

      <section className="curation-workspace__comparison" aria-label="Original analysis and your correction">
        <article><p>Original analysis</p><h3>{theme.machine.name}</h3><span>{theme.machine.summary}</span></article>
        <article className={theme.curated ? 'has-curation' : ''}><p>Your correction</p>{theme.curated ? <><h3>{theme.curated.name}</h3><span>{theme.curated.summary}</span></> : <span>No edits yet. The original analysis remains unchanged.</span>}</article>
      </section>

      {theme.groupingSuggestion ? (
        <aside className="curation-workspace__grouping-suggestion">
          <Icon icon={AlertTriangle} size={17} />
          <div><strong>These comments may describe more than one topic</strong><span>{theme.groupingSuggestion.reason}</span></div>
        </aside>
      ) : null}

      <div className="curation-workspace__decision-bar" aria-label="Theme review actions">
        <div><strong>{decisionLabels[theme.decision]}</strong><span>{decisionCopy}</span></div>
        {pending && theme.groupingSuggestion && canSplit
          ? <button type="button" onClick={() => onSplitStart(theme.id)} disabled={submitting}><Icon icon={Scissors} size={14} /> Review suggested split</button>
          : pending ? <button type="button" onClick={() => onApprove(theme.id)} disabled={submitting}><Icon icon={Check} size={15} /> Accept this bucket</button> : null}
        <details><summary>Adjust this bucket</summary><div>
          <button type="button" onClick={() => onEditStart(theme.id)} disabled={submitting}><Icon icon={Pencil} size={14} /> Rename or rewrite</button>
          {!theme.groupingSuggestion && canSplit ? <button type="button" onClick={() => onSplitStart(theme.id)} disabled={submitting}><Icon icon={Scissors} size={14} /> Split</button> : null}
          {themes.some((item) => item.id !== theme.id) ? <button type="button" onClick={() => onCombineStart(theme.id)} disabled={submitting}><Icon icon={GitMerge} size={14} /> Combine with another bucket</button> : null}
          <button type="button" className="is-danger" onClick={() => onReject(theme.id)} disabled={submitting}><Icon icon={X} size={15} /> Reject suggestion</button>
        </div></details>
      </div>

      {editDraft?.themeId === theme.id ? <ThemeEditor draft={editDraft} disabled={submitting} onChange={onEditDraftChange} onSave={onEditSave} onCancel={onEditCancel} /> : null}
      {splitDraft?.themeId === theme.id ? <SplitEditor theme={theme} draft={splitDraft} disabled={submitting} onChange={onSplitDraftChange} onSave={onSplit} onCancel={onSplitCancel} /> : null}

      <section className="curation-workspace__evidence" aria-labelledby={`${titleId}-evidence`}>
        <div className="curation-workspace__section-heading"><div><p>Full source feedback</p><h3 id={`${titleId}-evidence`}>{theme.evidence.length} source reviews</h3></div><span>{theme.evidence.filter((item) => item.pinned).length} pinned</span></div>
        {theme.evidence.map((evidence) => (
          <article className={evidence.excluded ? 'is-excluded' : ''} key={evidence.id}>
            <HighlightedFeedback evidence={evidence} />
            <p>{evidence.entity || 'Unknown entity'} · {evidence.provider || 'Imported'} · {evidence.rating === null ? 'No rating' : `${evidence.rating} stars`} · {formatDate(evidence.sourceCreatedAt)}</p>
            <details className="curation-workspace__evidence-actions"><summary>Move or exclude this comment</summary><div>
              <button type="button" aria-pressed={evidence.pinned} disabled={submitting || evidence.excluded || evidence.pinned} onClick={() => onEvidencePin(theme.id, evidence.id, true)}><Icon icon={Pin} size={13} /> {evidence.pinned ? 'Pinned' : 'Pin as representative'}</button>
              <button type="button" aria-pressed={evidence.excluded} disabled={submitting || evidence.excluded} onClick={() => onEvidenceExclude(theme.id, evidence.id, true)}><Icon icon={Ban} size={13} /> {evidence.excluded ? 'Excluded' : 'Exclude from bucket'}</button>
            </div>
            {themes.some((item) => item.id !== theme.id) ? <form className="curation-workspace__move" onSubmit={(event) => {
              event.preventDefault()
              const target = new FormData(event.currentTarget).get('targetThemeId')
              if (typeof target === 'string') onMoveEvidence(theme.id, evidence.id, target)
            }}><label>Move evidence to<select aria-label="Move evidence to" name="targetThemeId" defaultValue="" required><option value="" disabled>Choose a bucket</option>{themes.filter((item) => item.id !== theme.id).map((item) => <option value={item.id} key={item.id}>{activeName(item)}</option>)}</select></label><button type="submit" className="curation-workspace__quiet-button" disabled={submitting}>Move comment</button></form> : null}
            <form className="curation-workspace__new-bucket" onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              onCreateCustomTheme(String(data.get('name') || ''), String(data.get('summary') || ''), [evidence.reviewId])
            }}><label>New bucket name<input name="name" required /></label><label>Why this comment belongs there<textarea name="summary" rows={2} required /></label><button type="submit" className="curation-workspace__quiet-button" disabled={submitting}>Create bucket from this comment</button></form>
            </details>
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
  const [combineMode, setCombineMode] = useState(false)

  if (status === 'loading') return <section className="curation-workspace curation-workspace__state" aria-label="Curation workspace" aria-live="polite"><Clock3 aria-hidden="true" /><h1>Preparing the review queue.</h1><p>Loading suggested buckets, source evidence, and saved activity.</p></section>
  if (status === 'error' || !run) return <section className="curation-workspace curation-workspace__state" aria-label="Curation workspace" role="alert"><AlertTriangle aria-hidden="true" /><h1>Curation is unavailable.</h1><p>{error || 'The analysis run could not be loaded.'}</p></section>

  const progress = run.requiredThemes === 0 ? 100 : Math.min(100, Math.round((run.reviewedThemes / run.requiredThemes) * 100))
  const pending = themes.filter((theme) => theme.decision === 'pending').length
  const nextTheme = themes.find((theme) => theme.decision === 'pending') || null
  const coverageItems = props.coverageItems || []
  const retainedCoverage = coverageItems.filter((item) => !['excluded', 'error'].includes(item.disposition))

  return (
    <section className="curation-workspace" aria-label="Curation workspace">
      {props.demoMode ? <div className="curation-workspace__temporary" role="status"><div><strong>Temporary demo curation</strong><span>Changes stay inside this isolated demo and expire {props.expiresAt ? formatDate(props.expiresAt) : 'after 24 hours'}.</span></div>{(props.revision || 0) > 0 ? <button type="button" className="curation-workspace__quiet-button" disabled={submitting} onClick={() => props.onRestoreRevision((props.revision || 1) - 1)}>Undo latest change</button> : null}</div> : null}
      <header className="curation-workspace__hero">
        <div>
          <p>Curation · Evidence stays attached</p>
          <h1>Refine the analysis without losing the evidence.</h1>
        </div>
        <dl>
          <div><dt>Buckets</dt><dd>{run.totalThemes}</dd></div>
          <div><dt>Reviewed</dt><dd>{run.reviewedThemes} / {run.requiredThemes}</dd></div>
          <div><dt>Created</dt><dd>{formatDate(run.createdAt)}</dd></div>
        </dl>
      </header>

      <section className="curation-workspace__start" aria-labelledby="curation-start-title">
        <div><p>Optional touch-up</p><h2 id="curation-start-title">Review one suggested bucket at a time.</h2><span>Every valid comment already has a category. Accept this suggestion, or adjust it when your team uses a clearer name.</span></div>
        {nextTheme ? <button type="button" className="curation-workspace__dark-button" onClick={() => props.onThemeSelect(nextTheme.id)}>Review next: {activeName(nextTheme)}</button> : <span>All suggested buckets have a decision.</span>}
      </section>

      {coverageItems.length ? <section className="curation-workspace__coverage" aria-label="Complete feedback coverage">
        <div className="curation-workspace__section-heading"><div><p>Complete coverage</p><h2>{retainedCoverage.length} retained comments</h2></div><span>Every valid comment has one bucket.</span></div>
        <dl><div><dt>Recurring</dt><dd>{retainedCoverage.filter((item) => item.disposition === 'recurring').length}</dd></div><div><dt>Emerging</dt><dd>{retainedCoverage.filter((item) => item.disposition === 'emerging').length}</dd></div><div><dt>User curated</dt><dd>{retainedCoverage.filter((item) => item.disposition === 'user_curated').length}</dd></div><div><dt>Input errors</dt><dd>{coverageItems.filter((item) => item.disposition === 'error').length}</dd></div></dl>
        <details><summary>Trace all {retainedCoverage.length} comments</summary><ol>{retainedCoverage.map((item) => <li key={item.reviewId}><strong>{customerDispositionLabel(item.disposition)}</strong><p>{item.originalText}</p>{item.signals.map((signal) => <span key={`${signal.signalType}:${signal.label}`}>{signal.category.replaceAll('_', ' ')} · {signal.label}</span>)}<small>{customerCoverageReason(item)}</small>{item.themeIds.map((themeId) => <button type="button" key={themeId} onClick={() => props.onThemeSelect(themeId)}>Review this bucket</button>)}</li>)}</ol></details>
      </section> : null}

      {mergeSelection.length >= 2 ? <MergeComposer themes={themes} selection={mergeSelection} draft={props.mergeDraft} submitting={submitting} onDraftChange={props.onMergeDraftChange} onMerge={props.onMerge} onCancel={() => { setCombineMode(false); props.onMergeCancel() }} /> : null}

      <div className="curation-workspace__layout">
        <section aria-labelledby="theme-review-queue">
          <div className="curation-workspace__section-heading curation-workspace__queue-heading"><div><p>{combineMode ? 'Combine buckets' : 'Suggested buckets'}</p><h2 id="theme-review-queue">Review queue</h2></div><span>{combineMode ? 'Choose one more bucket, then name the combined result.' : 'Select a bucket to inspect its source feedback.'}</span></div>
          <ol className="curation-workspace__queue">
            {themes.map((theme) => {
              const selectedForMerge = mergeSelection.includes(theme.id)
              return (
                <li key={theme.id} className={`is-${theme.decision}${combineMode ? ' is-combining' : ''}`}>
                  {combineMode ? <label className="curation-workspace__merge-select"><input type="checkbox" checked={selectedForMerge} aria-label={`Select ${activeName(theme)} for merge`} onChange={() => props.onMergeSelectionChange(selectedForMerge ? mergeSelection.filter((id) => id !== theme.id) : [...mergeSelection, theme.id])} /><span /></label> : null}
                  <button type="button" onClick={() => props.onThemeSelect(theme.id)}>
                    <span className="curation-workspace__rank">{String(theme.rank).padStart(2, '0')}</span>
                    <span className="curation-workspace__theme-copy"><small>{theme.origin === 'user_curated' ? 'Your bucket' : 'Suggested bucket'} · {theme.category?.replaceAll('_', ' ') || 'uncategorized'} · {theme.sentiment || 'neutral'} sentiment · {decisionLabels[theme.decision]} · {theme.confidence} confidence</small><strong>{activeName(theme)}</strong><em>{theme.curated?.summary || theme.machine.summary}</em></span>
                    <span className="curation-workspace__theme-metrics"><strong>{theme.reviewCount}</strong><small>reviews</small><strong>{theme.evidence.filter((item) => item.pinned).length}</strong><small>pinned</small></span>
                    <Icon icon={ArrowRight} size={16} />
                  </button>
                </li>
              )
            })}
          </ol>
        </section>

        <aside className="curation-workspace__activity" aria-labelledby="curation-activity-heading">
          <div className="curation-workspace__section-heading"><div><p>Append-only record</p><h2 id="curation-activity-heading">Activity</h2></div>{!props.demoMode && (props.revision || 0) > 0 ? <button type="button" className="curation-workspace__quiet-button" disabled={submitting} onClick={() => props.onRestoreRevision((props.revision || 1) - 1)}>Undo latest change</button> : null}</div>
          <ol>{activity.map((item) => <li key={item.id}><span /><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time><p><strong>{item.actorName}</strong> {item.action}{item.themeName ? <> <em>{item.themeName}</em></> : null}</p></li>)}</ol>
          {!activity.length ? <p className="curation-workspace__empty">No curation decisions have been recorded.</p> : null}
        </aside>
      </div>

      <section className="curation-workspace__readiness" aria-labelledby="curation-readiness-title">
        <div><p>Publication readiness</p><h2 id="curation-readiness-title">{run.ready ? 'Ready for an immutable report.' : pending ? `${run.reviewedThemes} of ${run.requiredThemes} required themes reviewed.` : 'All required buckets are reviewed.'}</h2><div className="curation-workspace__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Curation progress"><span style={{ width: `${progress}%` }} /></div></div>
        <div className="curation-workspace__ready-action"><span>{pending} pending · {themes.filter((theme) => theme.decision === 'approved' || theme.decision === 'edited').length} accepted</span>{pending === 0 ? <button type="button" className="curation-workspace__dark-button" onClick={props.onMarkReady} disabled={submitting || gateErrors.length > 0 || run.ready}><Icon icon={ShieldCheck} size={16} /> {run.ready ? 'Marked ready' : 'Mark ready'}</button> : <span>Review the remaining buckets to continue.</span>}</div>
        {gateErrors.length ? <ul className="curation-workspace__gates" role="alert">{gateErrors.map((message) => <li key={message}><AlertTriangle size={14} aria-hidden="true" /> {message}</li>)}</ul> : null}
      </section>

      {selectedTheme ? <ThemeDrawer
        theme={selectedTheme}
        themes={themes}
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
        onMoveEvidence={props.onMoveEvidence}
        onCreateCustomTheme={props.onCreateCustomTheme}
        onCombineStart={(themeId) => { setCombineMode(true); props.onMergeSelectionChange([themeId]); props.onThemeClose() }}
        onSplitStart={props.onSplitStart}
        onSplitDraftChange={props.onSplitDraftChange}
        onSplit={props.onSplit}
        onSplitCancel={props.onSplitCancel}
      /> : null}
    </section>
  )
}
