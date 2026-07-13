import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Quote,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { Icon } from './Icon'
import './VoiceMapWorkspace.css'

export type VoiceMapMode = 'read' | 'investigate'
export type VoiceMapConfidence = 'high' | 'moderate' | 'emerging' | 'weak' | 'insufficient'
export type VoiceMapSignalType = 'pain' | 'desired_outcome' | 'objection' | 'praise' | 'purchase_trigger' | 'operational_issue' | 'emotion'

export type VoiceMapRunSummary = {
  id: string
  createdAt: string
  reviewCount: number
  themeCount: number
  confidence: VoiceMapConfidence
  pipelineVersion: string
}

export type VoiceMapInsight = {
  id: string
  type: 'primary_pain' | 'desired_outcome' | 'main_objection' | 'emotional_driver' | 'opportunity'
  title: string
  narrative: string
  confidence: VoiceMapConfidence
  reviewCount: number
  supportingThemeIds: string[]
}

export type VoiceMapEvidence = {
  id: string
  reviewId: string
  quote: string
  quoteStart: number
  quoteEnd: number
  originalText: string
  rating: number | null
  provider: string
  entity: string | null
  language: string | null
  sourceCreatedAt: string | null
  sourceUrl: string | null
  strength: number
}

export type VoiceMapTheme = {
  id: string
  rank: number
  name: string
  type: string
  signalTypes: VoiceMapSignalType[]
  summary: string
  confidence: VoiceMapConfidence
  representativeQuote: string | null
  metrics: {
    reviewCount: number
    signalCount: number
    prevalence: number
    averageRating: number | null
    trend: number | null
    contradictionRate: number | null
    rootCauseRatio?: number
  }
  topPhrases: Array<{ text: string; count: number }>
  entityBreakdown: Array<{ label: string; count: number }>
  languageBreakdown: Array<{ label: string; count: number }>
  evidence: VoiceMapEvidence[]
}

export type SynthesizedVoiceMap = {
  conclusion: { title: string; narrative: string }
  signals: {
    primaryPain: VoiceMapInsight
    desiredOutcome: VoiceMapInsight
    mainObjection: VoiceMapInsight
    emotionalDriver: VoiceMapInsight
  }
  phrases: Array<{ text: string; count: number; themeId: string; themeName: string; category: string }>
  recommendedMoves: Array<{
    id: string
    owner: 'Messaging' | 'Product' | 'Sales' | 'Operations' | 'Support' | 'Onboarding'
    action: string
    supportingThemeIds: string[]
  }>
}

export type VoiceMapWorkspaceProps = {
  mode: VoiceMapMode
  status: 'loading' | 'ready' | 'empty' | 'error'
  run: VoiceMapRunSummary | null
  voiceMap: SynthesizedVoiceMap | null
  themes: VoiceMapTheme[]
  selectedThemeId: string | null
  error?: string | null
  onModeChange: (mode: VoiceMapMode) => void
  onThemeSelect: (themeId: string) => void
  onThemeClose: () => void
  onOpenReview: (reviewId: string) => void
}

const signalLabels: Record<keyof SynthesizedVoiceMap['signals'], string> = {
  primaryPain: 'Primary pain',
  desiredOutcome: 'Desired outcome',
  mainObjection: 'Main objection',
  emotionalDriver: 'Emotional driver',
}

function formatDate(value: string | null) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date)
}

function percent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function confidenceLabel(value: VoiceMapConfidence) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function ThemeLink({ themeId, themes, onSelect }: { themeId: string; themes: VoiceMapTheme[]; onSelect: (id: string) => void }) {
  const theme = themes.find((item) => item.id === themeId)
  if (!theme) return null
  return <button type="button" className="voice-map-workspace__theme-link" onClick={() => onSelect(theme.id)}>{theme.name}<ArrowRight size={12} aria-hidden="true" /></button>
}

const categoryColors = ['#d7683b', '#56745f', '#8066a3', '#2f6f7a', '#ad7b2e', '#735c4d']

function categoryColor(category: string, categories: string[]) {
  return categoryColors[Math.max(0, categories.indexOf(category)) % categoryColors.length]
}

function HighlightedOriginal({ evidence }: { evidence: VoiceMapEvidence }) {
  const originalText = evidence.originalText || evidence.quote
  const exact = evidence.quoteStart >= 0
    && evidence.quoteEnd > evidence.quoteStart
    && originalText.slice(evidence.quoteStart, evidence.quoteEnd) === evidence.quote
  if (!exact) return <p className="voice-map-workspace__original-text">{originalText}</p>
  return (
    <p className="voice-map-workspace__original-text">
      {originalText.slice(0, evidence.quoteStart)}
      <mark>{originalText.slice(evidence.quoteStart, evidence.quoteEnd)}</mark>
      {originalText.slice(evidence.quoteEnd)}
    </p>
  )
}

function PhraseBubbleMap({ phrases, onSelect }: { phrases: SynthesizedVoiceMap['phrases']; onSelect: (themeId: string) => void }) {
  const [active, setActive] = useState<number | null>(null)
  const bubbleNodes = useRef<Array<SVGGElement | null>>([])
  const paused = useRef(false)
  const categories = useMemo(() => [...new Set(phrases.map((phrase) => phrase.category))], [phrases])
  const maximum = Math.max(...phrases.map((phrase) => phrase.count), 1)
  const minimum = Math.min(...phrases.map((phrase) => phrase.count), maximum)
  const bubbles = useMemo(() => phrases.map((phrase, index) => {
    const range = Math.log1p(maximum) - Math.log1p(minimum)
    const scale = range ? (Math.log1p(phrase.count) - Math.log1p(minimum)) / range : .5
    const radius = 34 + Math.sqrt(Math.max(0, scale)) * 38
    const column = index % 3
    const row = Math.floor(index / 3)
    const x = 80 + column * 160 + ((index * 17) % 9) - 4
    const y = 82 + row * 150 + ((index * 11) % 9) - 4
    const words = phrase.text.trim().split(/\s+/)
    const maxLineLength = Math.round(10 + scale * 7)
    const lines = words.reduce<string[]>((result, word) => {
      const last = result.at(-1)
      if (!last || (last.length + word.length + 1 > maxLineLength && result.length < 2)) result.push(word)
      else result[result.length - 1] = `${last} ${word}`
      return result
    }, []).slice(0, 2)
    if (lines[1] && lines.join(' ').length < phrase.text.trim().length) lines[1] = `${lines[1].slice(0, maxLineLength - 1)}…`
    const fontSize = 10.5 + scale * 4.5
    return { ...phrase, radius, x, y, lines, fontSize, lineHeight: fontSize + 1.5 }
  }), [maximum, minimum, phrases])
  const height = Math.max(260, Math.ceil(bubbles.length / 3) * 150 + 20)

  useEffect(() => {
    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const bodies = bubbles.map((bubble, index) => ({
      x: bubble.x, y: bubble.y,
      vx: ((index * 37) % 9 - 4) * .18 || .24,
      vy: ((index * 23) % 7 - 3) * .16 || -.21,
      homeX: bubble.x, homeY: bubble.y, radius: bubble.radius,
      phase: index * 1.73,
      driftX: 5 + (index % 3) * 1.5,
      driftY: 3.5 + (index % 2) * 1.5,
    }))
    const render = () => bodies.forEach((body, index) => bubbleNodes.current[index]?.setAttribute('transform', `translate(${body.x.toFixed(2)} ${body.y.toFixed(2)})`))
    render()
    if (reducedMotion) return
    const schedule = typeof window.requestAnimationFrame === 'function'
      ? (callback: FrameRequestCallback) => window.requestAnimationFrame(callback)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16)
    const cancel = typeof window.cancelAnimationFrame === 'function'
      ? (handle: number) => window.cancelAnimationFrame(handle)
      : (handle: number) => window.clearTimeout(handle)
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min(2, (now - previous) / 16.67)
      previous = now
      if (!paused.current) {
        for (const body of bodies) {
          const seconds = now / 1000
          const targetX = body.homeX + Math.sin(seconds * .62 + body.phase) * body.driftX
          const targetY = body.homeY + Math.cos(seconds * .48 + body.phase) * body.driftY
          body.vx += (targetX - body.x) * .0022 * elapsed
          body.vy += (targetY - body.y) * .0022 * elapsed
          body.vx *= .985
          body.vy *= .985
          body.x += body.vx * elapsed
          body.y += body.vy * elapsed
        }
        for (let pass = 0; pass < 4; pass += 1) {
          for (let left = 0; left < bodies.length; left += 1) {
            for (let right = left + 1; right < bodies.length; right += 1) {
              const a = bodies[left]
              const b = bodies[right]
              const dx = b.x - a.x
              const dy = b.y - a.y
              const distance = Math.sqrt(dx * dx + dy * dy) || .01
              const required = a.radius + b.radius + 3
              if (distance >= required) continue
              const nx = dx / distance
              const ny = dy / distance
              const correction = (required - distance) * .5 + .05
              a.x -= nx * correction; a.y -= ny * correction
              b.x += nx * correction; b.y += ny * correction
              const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
              if (relativeVelocity < 0) {
                const impulse = -relativeVelocity * .72
                a.vx -= nx * impulse; a.vy -= ny * impulse
                b.vx += nx * impulse; b.vy += ny * impulse
              }
            }
          }
        }
        for (const body of bodies) {
          if (body.x - body.radius < 3) { body.x = body.radius + 3; body.vx = Math.abs(body.vx) }
          if (body.x + body.radius > 477) { body.x = 477 - body.radius; body.vx = -Math.abs(body.vx) }
          if (body.y - body.radius < 3) { body.y = body.radius + 3; body.vy = Math.abs(body.vy) }
          if (body.y + body.radius > height - 3) { body.y = height - body.radius - 3; body.vy = -Math.abs(body.vy) }
        }
        render()
      }
      frame = schedule(tick)
    }
    frame = schedule(tick)
    return () => cancel(frame)
  }, [bubbles, height])

  const activate = (index: number | null) => { paused.current = index !== null; setActive(index) }
  if (!phrases.length) return <p className="voice-map-workspace__no-evidence">No evidence bucket met the publication threshold.</p>
  return (
    <div className="voice-map-workspace__bubble-field">
      <div className="voice-map-workspace__bubble-legend" aria-label="Bucket category legend">
        {categories.map((category) => <span key={category}><i style={{ backgroundColor: categoryColor(category, categories) }} />{category.replaceAll('_', ' ')}</span>)}
      </div>
      <svg viewBox={`0 0 480 ${height}`} role="group" aria-label="Interactive evidence bucket bubbles">
        {bubbles.map((bubble, index) => (
          <g
            key={`${bubble.themeId}:${bubble.text}:${index}`}
            ref={(node) => { bubbleNodes.current[index] = node }}
            className={active === index ? 'is-active' : ''}
            role="button"
            tabIndex={0}
            aria-label={`${bubble.themeName}, ${bubble.count} supporting reviews, ${bubble.category.replaceAll('_', ' ')}`}
            onMouseEnter={() => activate(index)}
            onMouseLeave={() => activate(null)}
            onFocus={() => activate(index)}
            onBlur={() => activate(null)}
            onClick={() => onSelect(bubble.themeId)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(bubble.themeId) } }}
          >
            <g className="voice-map-workspace__bubble-drift">
              <circle r={bubble.radius} fill={categoryColor(bubble.category, categories)} />
              <text textAnchor="middle" aria-hidden="true" style={{ fontSize: `${bubble.fontSize}px` }}>
                {bubble.lines.map((line, lineIndex) => <tspan key={lineIndex} x="0" y={bubble.lines.length === 1 ? -3 : -11 + lineIndex * bubble.lineHeight}>{line}</tspan>)}
                <tspan x="0" y="19" className="voice-map-workspace__bubble-count" style={{ fontSize: `${Math.max(8, bubble.fontSize - 2)}px` }}>{bubble.count} reviews</tspan>
              </text>
            </g>
            {active === index ? <title>{`${bubble.themeName} · ${bubble.count} supporting reviews · ${bubble.category.replaceAll('_', ' ')}`}</title> : null}
          </g>
        ))}
      </svg>
      <details className="voice-map-workspace__phrase-fallback">
        <summary>View buckets as an accessible table</summary>
        <table><thead><tr><th>Bucket</th><th>Supporting reviews</th><th>Category</th><th>Evidence</th></tr></thead><tbody>
          {phrases.map((phrase, index) => <tr key={`${phrase.themeId}:row:${index}`}><td>{phrase.themeName}</td><td>{phrase.count}</td><td>{phrase.category.replaceAll('_', ' ')}</td><td><button type="button" onClick={() => onSelect(phrase.themeId)}>Open evidence</button></td></tr>)}
        </tbody></table>
      </details>
    </div>
  )
}

function EvidenceDialog({ theme, onClose, onOpenReview }: { theme: VoiceMapTheme; onClose: () => void; onOpenReview: (reviewId: string) => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const close = dialog?.querySelector<HTMLButtonElement>('[data-dialog-close]')
    close?.focus()
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
  }, [onClose, theme.id])

  return (
    <div className="voice-map-workspace__dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside ref={dialogRef} className="voice-map-workspace__evidence-dialog" role="dialog" aria-modal="true" aria-labelledby="voice-theme-title">
        <header>
          <div>
            <p className="voice-map-workspace__label">Theme {String(theme.rank).padStart(2, '0')} · Evidence</p>
            <h2 id="voice-theme-title">{theme.name}</h2>
          </div>
          <button type="button" data-dialog-close aria-label="Close evidence" onClick={onClose}><Icon icon={X} size={18} /></button>
        </header>

        <p className="voice-map-workspace__dialog-summary">{theme.summary}</p>
        <dl className="voice-map-workspace__dialog-metrics">
          <div><dt>Reviews</dt><dd>{theme.metrics.reviewCount.toLocaleString()}</dd></div>
          <div><dt>Prevalence</dt><dd>{percent(theme.metrics.prevalence)}</dd></div>
          <div><dt>Confidence</dt><dd>{confidenceLabel(theme.confidence)}</dd></div>
          <div><dt>Contradiction</dt><dd>{percent(theme.metrics.contradictionRate)}</dd></div>
        </dl>

        <section className="voice-map-workspace__breakdowns" aria-label="Theme distribution">
          <div><h3>Entities</h3>{theme.entityBreakdown.map((item) => <p key={item.label}><span>{item.label}</span><strong>{item.count}</strong></p>)}</div>
          <div><h3>Languages</h3>{theme.languageBreakdown.map((item) => <p key={item.label}><span>{item.label.toUpperCase()}</span><strong>{item.count}</strong></p>)}</div>
        </section>

        <section className="voice-map-workspace__evidence-list" aria-labelledby="theme-evidence-heading">
          <div className="voice-map-workspace__evidence-heading"><h3 id="theme-evidence-heading">Exact customer evidence</h3><span>{theme.evidence.length} full comments</span></div>
          {theme.evidence.length ? theme.evidence.map((evidence) => (
            <article key={evidence.id}>
              <Quote size={17} aria-hidden="true" />
              <p className="voice-map-workspace__evidence-label">Matched phrase · “{evidence.quote}”</p>
              <HighlightedOriginal evidence={evidence} />
              <footer>
                <span>{(evidence.provider || 'unknown_source').replaceAll('_', ' ')} · {evidence.entity || 'Unknown entity'} · {evidence.rating === null ? 'No rating' : `${evidence.rating} stars`} · {formatDate(evidence.sourceCreatedAt)} · {(evidence.language || 'und').toUpperCase()}</span>
                <button type="button" onClick={() => onOpenReview(evidence.reviewId)}>Open source review <ArrowRight size={12} aria-hidden="true" /></button>
              </footer>
            </article>
          )) : <p className="voice-map-workspace__no-evidence">No representative excerpts are attached to this theme.</p>}
        </section>
      </aside>
    </div>
  )
}

function ReadView({ run, voiceMap, themes, onThemeSelect }: { run: VoiceMapRunSummary; voiceMap: SynthesizedVoiceMap; themes: VoiceMapTheme[]; onThemeSelect: (id: string) => void }) {
  const primaryTheme = themes.find((theme) => voiceMap.signals.primaryPain.supportingThemeIds.includes(theme.id))
  return (
    <div className="voice-map-workspace__read">
      <header className="voice-map-workspace__conclusion">
        <h1>{voiceMap.conclusion.title}</h1>
        <div><p>{voiceMap.conclusion.narrative}</p><span>{run.reviewCount.toLocaleString()} reviews · {run.themeCount} validated themes · {confidenceLabel(run.confidence)} confidence</span></div>
      </header>

      <section className="voice-map-workspace__signal-strip" aria-label="Executive signals">
        {(Object.entries(voiceMap.signals) as Array<[keyof SynthesizedVoiceMap['signals'], VoiceMapInsight]>).map(([key, insight], index) => (
          <article key={insight.id}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div><p className="voice-map-workspace__label">{signalLabels[key]}</p><h2>{insight.title}</h2><small>{insight.reviewCount.toLocaleString()} supporting reviews</small></div>
          </article>
        ))}
      </section>

      <section className="voice-map-workspace__primary-story">
        <div className="voice-map-workspace__story-copy">
          <p className="voice-map-workspace__label">01 · Primary pain</p>
          <blockquote>“{primaryTheme?.representativeQuote || voiceMap.signals.primaryPain.title}”</blockquote>
          <p>{voiceMap.signals.primaryPain.narrative}</p>
          <div className="voice-map-workspace__support-links">{voiceMap.signals.primaryPain.supportingThemeIds.map((id) => <ThemeLink key={id} themeId={id} themes={themes} onSelect={onThemeSelect} />)}</div>
        </div>
        <div className="voice-map-workspace__phrases">
          <p className="voice-map-workspace__label">Top evidence buckets</p>
          <PhraseBubbleMap phrases={voiceMap.phrases} onSelect={onThemeSelect} />
        </div>
      </section>

      <section className="voice-map-workspace__read-lower">
        <div>
          <p className="voice-map-workspace__label">02 · Strategic interpretation</p>
          <div className="voice-map-workspace__interpretations">
            {(['desiredOutcome', 'mainObjection', 'emotionalDriver'] as const).map((key) => <article key={key}><h3>{signalLabels[key]}</h3><p>{voiceMap.signals[key].narrative}</p><div>{voiceMap.signals[key].supportingThemeIds.map((id) => <ThemeLink key={id} themeId={id} themes={themes} onSelect={onThemeSelect} />)}</div></article>)}
          </div>
        </div>
        <div className="voice-map-workspace__moves">
          <p className="voice-map-workspace__label">03 · Recommended moves</p>
          {voiceMap.recommendedMoves.map((move) => <article key={move.id}><strong>{move.owner}</strong><span>{move.action}</span><div>{move.supportingThemeIds.map((id) => <ThemeLink key={id} themeId={id} themes={themes} onSelect={onThemeSelect} />)}</div></article>)}
        </div>
      </section>
    </div>
  )
}

function InvestigateView({ run, themes, onThemeSelect }: { run: VoiceMapRunSummary; themes: VoiceMapTheme[]; onThemeSelect: (id: string) => void }) {
  return (
    <div className="voice-map-workspace__investigate">
      <header className="voice-map-workspace__investigate-heading">
        <div><h1>Every conclusion has a trail.</h1><p>Ranked themes preserve volume, contradiction, distribution, and the exact customer language behind the synthesis.</p></div>
        <dl><div><dt>Validated themes</dt><dd>{run.themeCount}</dd></div><div><dt>Reviews</dt><dd>{run.reviewCount.toLocaleString()}</dd></div><div><dt>Run confidence</dt><dd>{confidenceLabel(run.confidence)}</dd></div></dl>
      </header>
      <ol className="voice-map-workspace__theme-index" aria-label="Ranked themes">
        {themes.map((theme) => (
          <li key={theme.id}><button type="button" onClick={() => onThemeSelect(theme.id)}>
            <span className="voice-map-workspace__theme-rank">{String(theme.rank).padStart(2, '0')}</span>
            <div className="voice-map-workspace__theme-copy"><span>{theme.type}</span><h2>{theme.name}</h2><p>{theme.summary}</p>{theme.representativeQuote ? <blockquote>“{theme.representativeQuote}”</blockquote> : null}</div>
            <dl>
              <div><dt>Reviews</dt><dd>{theme.metrics.reviewCount}</dd></div>
              <div><dt>Prevalence</dt><dd>{percent(theme.metrics.prevalence)}</dd></div>
              <div><dt>Confidence</dt><dd className={`is-${theme.confidence}`}>{confidenceLabel(theme.confidence)}</dd></div>
              <div><dt>Contradiction</dt><dd>{percent(theme.metrics.contradictionRate)}</dd></div>
            </dl>
            <ArrowRight size={17} aria-hidden="true" />
          </button></li>
        ))}
      </ol>
    </div>
  )
}

export function VoiceMapWorkspace(props: VoiceMapWorkspaceProps) {
  const selectedTheme = props.themes.find((theme) => theme.id === props.selectedThemeId) || null
  return (
    <section className="voice-map-workspace" aria-busy={props.status === 'loading'}>
      <div className="voice-map-workspace__mode-bar" role="tablist" aria-label="Voice Map mode">
        <button type="button" role="tab" aria-selected={props.mode === 'read'} className={props.mode === 'read' ? 'is-active' : ''} onClick={() => props.onModeChange('read')}><Icon icon={Sparkles} size={15} /> Read</button>
        <button type="button" role="tab" aria-selected={props.mode === 'investigate'} className={props.mode === 'investigate' ? 'is-active' : ''} onClick={() => props.onModeChange('investigate')}><Icon icon={Search} size={15} /> Investigate</button>
        {props.run ? <span>Run {props.run.id.slice(0, 8)} · {formatDate(props.run.createdAt)}</span> : null}
      </div>

      {props.status === 'loading' ? <div className="voice-map-workspace__state"><span className="voice-map-workspace__loader" aria-hidden="true" /><p className="voice-map-workspace__label">Synthesizing validated evidence</p><h1>Building the narrative from themes.</h1><p>Claims are being linked to their supporting customer language.</p></div> : null}
      {props.status === 'error' ? <div className="voice-map-workspace__state"><Icon icon={ShieldCheck} size={29} /><p className="voice-map-workspace__label">Voice Map unavailable</p><h1>The evidence could not be synthesized.</h1><p role="alert">{props.error || 'The analysis run did not produce a readable Voice Map.'}</p></div> : null}
      {props.status === 'empty' ? <div className="voice-map-workspace__state"><Icon icon={BarChart3} size={29} /><p className="voice-map-workspace__label">No validated themes</p><h1>There is not enough evidence yet.</h1><p>Choose a broader dataset or lower the minimum support threshold, then create a new analysis run.</p></div> : null}
      {props.status === 'ready' && props.run && props.voiceMap ? (props.mode === 'read' ? <ReadView run={props.run} voiceMap={props.voiceMap} themes={props.themes} onThemeSelect={props.onThemeSelect} /> : <InvestigateView run={props.run} themes={props.themes} onThemeSelect={props.onThemeSelect} />) : null}
      {selectedTheme ? <EvidenceDialog theme={selectedTheme} onClose={props.onThemeClose} onOpenReview={props.onOpenReview} /> : null}
    </section>
  )
}
