import { Check, Copy, Quote } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import type { VoiceMapTheme } from './VoiceMapWorkspace'
import './CopyLabWorkspace.css'

type Format = 'Homepage hero' | 'Ad hook' | 'Email subject' | 'FAQ answer'
type Tone = 'Direct' | 'Reassuring' | 'Provocative'

function draft(theme: VoiceMapTheme, format: Format, tone: Tone) {
  const name = theme.name.replace(/[.!?]+$/, '')
  const phrase = theme.representativeQuote || theme.evidence[0]?.quote || name
  const lead = tone === 'Direct' ? `Move past ${name.toLowerCase()}.` : tone === 'Provocative' ? `Still accepting ${name.toLowerCase()}?` : `There is a clearer way through ${name.toLowerCase()}.`
  if (format === 'Ad hook') return { title: lead, body: `Built around what customers ask for: “${phrase}”` }
  if (format === 'Email subject') return { title: lead, body: `Evidence basis: ${theme.metrics.reviewCount} customer reviews.` }
  if (format === 'FAQ answer') return { title: `How do you address ${name.toLowerCase()}?`, body: `${theme.summary} Our response should directly address the customer language: “${phrase}”` }
  return { title: lead, body: `${theme.summary} Designed for customers who say: “${phrase}”` }
}

export function CopyLabWorkspace({ status, themes, error, onOpenReview }: { status: 'loading' | 'ready' | 'empty' | 'error'; themes: VoiceMapTheme[]; error?: string | null; onOpenReview: (reviewId: string) => void }) {
  const [themeId, setThemeId] = useState('')
  const [format, setFormat] = useState<Format>('Homepage hero')
  const [tone, setTone] = useState<Tone>('Direct')
  const [copied, setCopied] = useState(false)
  const selected = themes.find((theme) => theme.id === themeId) || themes[0] || null
  const output = useMemo(() => selected ? draft(selected, format, tone) : null, [format, selected, tone])
  if (status === 'loading') return <section className="copy-lab copy-lab__state" aria-live="polite"><p>Copy Lab</p><h1>Preparing validated customer language.</h1></section>
  if (status === 'error') return <section className="copy-lab copy-lab__state" role="alert"><p>Copy Lab</p><h1>The evidence basis is unavailable.</h1><span>{error}</span></section>
  if (status === 'empty' || !selected || !output) return <section className="copy-lab copy-lab__state"><p>Copy Lab</p><h1>Copy begins after evidence.</h1><span>Complete an analysis with a validated theme before generating a draft.</span></section>
  return <section className="copy-lab">
    <header className="copy-lab__hero"><div><p>Copy Lab</p><h1>Build from customer language.</h1></div><p>Deterministic drafts stay available without an LLM. Every line shows the approved theme and exact excerpts it was built from.</p></header>
    <div className="copy-lab__grid">
      <form className="copy-lab__controls" onSubmit={(event) => event.preventDefault()}>
        <label>Source tension<select aria-label="Source tension" value={selected.id} onChange={(event) => setThemeId(event.target.value)}>{themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
        <label>Format<select aria-label="Format" value={format} onChange={(event) => setFormat(event.target.value as Format)}>{['Homepage hero', 'Ad hook', 'Email subject', 'FAQ answer'].map((value) => <option key={value}>{value}</option>)}</select></label>
        <fieldset><legend>Tone</legend>{(['Direct', 'Reassuring', 'Provocative'] as Tone[]).map((value) => <button type="button" className={tone === value ? 'active' : ''} aria-pressed={tone === value} key={value} onClick={() => setTone(value)}>{value}</button>)}</fieldset>
      </form>
      <article className="copy-lab__draft"><small>Draft · {format}</small><h2>{output.title}</h2><p>{output.body}</p><button type="button" onClick={async () => { await navigator.clipboard?.writeText(`${output.title}\n\n${output.body}`); setCopied(true) }}><Icon icon={copied ? Check : Copy} size={15} />{copied ? 'Copied' : 'Copy draft'}</button></article>
      <aside className="copy-lab__evidence"><p>Evidence basis</p><h2>{selected.name}</h2><span>{selected.metrics.reviewCount} reviews · {selected.confidence} confidence</span>{selected.evidence.slice(0, 3).map((item) => <article key={item.id}><blockquote><Icon icon={Quote} size={14} />“{item.quote}”</blockquote><button type="button" onClick={() => onOpenReview(item.reviewId)}>Open source review</button></article>)}</aside>
    </div>
  </section>
}
