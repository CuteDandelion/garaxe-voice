import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { Evidence } from '../data/voiceMap'
import { Icon } from './Icon'

type EvidenceDrawerProps = {
  open: boolean
  items: Evidence[]
  onClose: () => void
}

export function EvidenceDrawer({ open, items, onClose }: EvidenceDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  return (
    <>
      <button
        className={`drawer-backdrop ${open ? 'is-open' : ''}`}
        aria-label="Close evidence"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside className={`evidence-drawer ${open ? 'is-open' : ''}`} aria-hidden={!open} aria-label="Evidence">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Evidence</p>
            <h2>Configuration fatigue</h2>
          </div>
          <button ref={closeButtonRef} className="icon-button" aria-label="Close evidence" onClick={onClose}>
            <Icon icon={X} size={20} />
          </button>
        </div>
        <div className="confidence-strip">
          <span>184 supporting reviews</span>
          <span>High confidence</span>
        </div>
        <div className="drawer-list">
          {items.map((item) => (
            <article className="evidence-item" key={item.id}>
              <blockquote>“{item.quote}”</blockquote>
              <div className="evidence-meta">
                <span>{item.source}</span>
                <span>{item.rating} stars</span>
                <time dateTime={item.date}>{item.date}</time>
              </div>
            </article>
          ))}
        </div>
      </aside>
    </>
  )
}
