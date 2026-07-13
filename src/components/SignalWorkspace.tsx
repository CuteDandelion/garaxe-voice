import { ArrowRight, Quote, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Icon } from './Icon'
import type { VoiceMapTheme } from './VoiceMapWorkspace'
import './SignalWorkspace.css'

export type SignalKind = 'pain' | 'outcome' | 'objection' | 'emotion'

const content: Record<SignalKind, { eyebrow: string; title: string; description: string; empty: string }> = {
  pain: { eyebrow: 'Pain phrases', title: 'Where the experience breaks down.', description: 'Repeated customer language describing friction, failure, and unmet expectations.', empty: 'No validated pain evidence was found in this analysis.' },
  outcome: { eyebrow: 'Desired outcomes', title: 'What customers are trying to reach.', description: 'The results, relief, and progress customers describe in their own language.', empty: 'No validated outcome evidence was found in this analysis.' },
  objection: { eyebrow: 'Objections', title: 'What makes customers hesitate.', description: 'Doubts, trust gaps, and purchase blockers grounded in exact review evidence.', empty: 'No validated objection evidence was found in this analysis.' },
  emotion: { eyebrow: 'Emotional triggers', title: 'The feeling underneath the feedback.', description: 'Emotional states and transformations connected to real customer excerpts.', empty: 'No validated emotional evidence was found in this analysis.' },
}

type Props = {
  kind: SignalKind
  status: 'loading' | 'ready' | 'empty' | 'error'
  themes: VoiceMapTheme[]
  selected: VoiceMapTheme | null
  error?: string | null
  onSelect: (theme: VoiceMapTheme) => void
  onClose: () => void
  onOpenReview: (reviewId: string) => void
}

export function SignalWorkspace({ kind, status, themes, selected, error, onSelect, onClose, onOpenReview }: Props) {
  const copy = content[kind]
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!selected) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.querySelector<HTMLButtonElement>('[data-dialog-close]')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus.current?.focus() }
  }, [onClose, selected])
  if (status === 'loading') return <section className="signal-workspace signal-workspace__state" aria-live="polite"><p>{copy.eyebrow}</p><h1>Reading the evidence trail.</h1></section>
  if (status === 'error') return <section className="signal-workspace signal-workspace__state" role="alert"><p>{copy.eyebrow}</p><h1>This workspace could not be assembled.</h1><span>{error}</span></section>
  return (
    <section className="signal-workspace">
      <header className="signal-workspace__hero"><div><p>{copy.eyebrow}</p><h1>{copy.title}</h1></div><p>{copy.description}</p></header>
      {status === 'empty' || themes.length === 0 ? <div className="signal-workspace__empty"><Quote aria-hidden="true" /><h2>Insufficient evidence</h2><p>{copy.empty}</p></div> : (
        <ol className="signal-workspace__themes" aria-label={`${copy.eyebrow} themes`}>
          {themes.map((theme, index) => <li key={theme.id}><button type="button" onClick={() => onSelect(theme)}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div><small>{theme.metrics.reviewCount} supporting reviews</small><h2>{theme.name}</h2><p>{theme.summary}</p>{theme.representativeQuote ? <blockquote>“{theme.representativeQuote}”</blockquote> : null}</div>
            <dl><div><dt>Confidence</dt><dd>{theme.confidence}</dd></div><div><dt>Prevalence</dt><dd>{Math.round(theme.metrics.prevalence * 100)}%</dd></div></dl>
            <Icon icon={ArrowRight} size={17} />
          </button></li>)}
        </ol>
      )}
      {selected ? <div className="signal-workspace__scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <aside ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="signal-dialog-title" className="signal-workspace__dialog">
          <header><div><p>Evidence trail</p><h2 id="signal-dialog-title">{selected.name}</h2></div><button type="button" data-dialog-close aria-label="Close evidence" onClick={onClose}><Icon icon={X} size={18} /></button></header>
          <p>{selected.summary}</p>
          <section aria-labelledby="signal-excerpts"><h3 id="signal-excerpts">Exact customer excerpts</h3>{selected.evidence.map((item) => <article key={item.id}><blockquote>“{item.quote}”</blockquote><footer><span>{item.entity || 'Unknown entity'}{item.rating ? ` · ${item.rating} stars` : ''}</span><button type="button" onClick={() => onOpenReview(item.reviewId)}>Open source review <Icon icon={ArrowRight} size={12} /></button></footer></article>)}</section>
        </aside>
      </div> : null}
    </section>
  )
}
