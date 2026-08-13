import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Handshake,
  Lightbulb,
  ListChecks,
  Megaphone,
  Quote,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Icon } from './Icon'
import type { OverviewBriefItem, OverviewBriefResult } from '../lib/api'
import './VoiceMapWorkspace.css'

export type VoiceMapMode = 'overview' | 'read' | 'investigate'
export type VoiceMapConfidence = 'high' | 'moderate' | 'emerging' | 'weak' | 'insufficient'
export type VoiceMapSignalType = 'pain' | 'desired_outcome' | 'objection' | 'emotion' | 'other'
export type VoiceMapSentiment = 'positive' | 'neutral' | 'negative'

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
  topic?: string
  type: VoiceMapSignalType
  signalTypes: VoiceMapSignalType[]
  sentiment?: VoiceMapSentiment
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
  phrases: Array<{ text: string; count: number; themeId: string; themeName: string; category: VoiceMapSignalType; state?: 'confirmed' | 'emerging' | 'curated' }>
  recommendedMoves: Array<{
    id: string
    owner: 'Messaging' | 'Product' | 'Sales' | 'Operations' | 'Support' | 'Onboarding'
    action: string
    supportingThemeIds: string[]
  }>
}

export type VoiceMapWorkspaceProps = {
  section?: 'overview' | 'voice-map'
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
  onOpenCuration: () => void
  onOpenVoiceMap?: (mode: Exclude<VoiceMapMode, 'overview'>) => void
  overviewBrief?: OverviewBriefResult | null
}

const signalLabels: Record<keyof SynthesizedVoiceMap['signals'], string> = {
  primaryPain: 'Primary pain',
  desiredOutcome: 'Desired outcome',
  mainObjection: 'Main objection',
  emotionalDriver: 'Emotional driver',
}

function SignalStrip({ signals }: { signals: SynthesizedVoiceMap['signals'] }) {
  return <section className="voice-map-workspace__signal-strip" aria-label="Executive signals">
    {(Object.entries(signals) as Array<[keyof SynthesizedVoiceMap['signals'], VoiceMapInsight]>).map(([key, insight], index) => (
      <article key={insight.id}>
        <span>{String(index + 1).padStart(2, '0')}</span>
        <div><p className="voice-map-workspace__label">{signalLabels[key]}</p><h2>{insight.title}</h2><small>{insight.reviewCount.toLocaleString()} {insight.confidence === 'emerging' ? 'categorized feedback · emerging, recurrence unconfirmed' : 'supporting reviews'}</small></div>
      </article>
    ))}
  </section>
}

function formatDate(value: string | null) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date)
}

function percent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}%`
}

function confidenceLabel(value: VoiceMapConfidence) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function ThemeLink({ themeId, themes, onSelect }: { themeId: string; themes: VoiceMapTheme[]; onSelect: (id: string) => void }) {
  const theme = themes.find((item) => item.id === themeId)
  if (!theme) return null
  return <button type="button" className="voice-map-workspace__theme-link" onClick={() => onSelect(theme.id)}>{theme.name}<ArrowRight size={12} aria-hidden="true" /></button>
}

function OverviewCitations({ item, themes, onSelect }: { item: Pick<OverviewBriefItem, 'themeIds'>; themes: VoiceMapTheme[]; onSelect: (id: string) => void }) {
  return <div className="voice-map-workspace__overview-citations">{item.themeIds.map((id) => {
    const theme = themes.find((candidate) => candidate.id === id)
    return theme ? <button type="button" key={id} onClick={() => onSelect(id)} aria-label={`Open evidence for ${theme.name}`}>{theme.name}<ArrowRight size={11} aria-hidden="true" /></button> : null
  })}</div>
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

export function PhraseBubbleMap({ phrases, onSelect }: { phrases: SynthesizedVoiceMap['phrases']; onSelect: (themeId: string) => void }) {
  const [active, setActive] = useState<number | null>(null)
  const bubbleNodes = useRef<Array<SVGGElement | null>>([])
  const paused = useRef(false)
  const rankedPhrases = useMemo(() => [...phrases]
    .sort((left, right) => right.count - left.count || left.themeId.localeCompare(right.themeId))
    .slice(0, 10), [phrases])
  const categories = useMemo(() => [...new Set(rankedPhrases.map((phrase) => phrase.category))], [rankedPhrases])
  const maximum = Math.max(...rankedPhrases.map((phrase) => phrase.count), 1)
  const minimum = Math.min(...rankedPhrases.map((phrase) => phrase.count), maximum)
  const bubbles = useMemo(() => rankedPhrases.map((phrase, index) => {
    const range = Math.log1p(maximum) - Math.log1p(minimum)
    const scale = range ? (Math.log1p(phrase.count) - Math.log1p(minimum)) / range : .5
    const radius = 30 + Math.sqrt(Math.max(0, scale)) * 38
    const column = index % 3
    const row = Math.floor(index / 3)
    const x = 80 + column * 160 + ((index * 17) % 9) - 4
    const y = 82 + row * 150 + ((index * 11) % 9) - 4
    const words = phrase.text.trim().split(/\s+/)
    const maxLineLength = Math.round(8 + scale * 9)
    const shorten = (word: string) => word.length > maxLineLength ? `${word.slice(0, maxLineLength - 1)}…` : word
    const lines = words.map(shorten).reduce<string[]>((result, word) => {
      const last = result.at(-1)
      if (!last || (last.length + word.length + 1 > maxLineLength && result.length < 2)) result.push(word)
      else result[result.length - 1] = `${last} ${word}`
      return result
    }, []).slice(0, 2)
    if (lines[1] && (lines[1].length > maxLineLength || lines.join(' ').length < phrase.text.trim().length)) lines[1] = `${lines[1].slice(0, maxLineLength - 1)}…`
    const fontSize = 8.5 + scale * 6.5
    return { ...phrase, radius, x, y, lines, fontSize, lineHeight: fontSize + 1.5 }
  }), [maximum, minimum, rankedPhrases])
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
  if (!rankedPhrases.length) return <p className="voice-map-workspace__no-evidence">No categorized feedback is available yet.</p>
  return (
    <div className="voice-map-workspace__bubble-field">
      <div className="voice-map-workspace__bubble-legend" aria-label="Bucket category legend">
        <span>Bubble size · feedback count</span>
        {categories.map((category) => <span key={category}><i style={{ backgroundColor: categoryColor(category, categories) }} />{category.replaceAll('_', ' ')}</span>)}
        {rankedPhrases.some((phrase) => phrase.state === 'curated') ? <span><i className="is-curated" />User curated · not engine-confirmed</span> : null}
      </div>
      <svg viewBox={`0 0 480 ${height}`} role="group" aria-label="Interactive evidence bucket bubbles">
        {bubbles.map((bubble, index) => (
          <g
            key={`${bubble.themeId}:${bubble.text}:${index}`}
            ref={(node) => { bubbleNodes.current[index] = node }}
            className={[active === index ? 'is-active' : '', bubble.state === 'emerging' ? 'is-emerging' : '', bubble.state === 'curated' ? 'is-curated' : ''].filter(Boolean).join(' ')}
            role="button"
            tabIndex={0}
            aria-label={bubble.state === 'emerging' ? `${bubble.themeName}, ${bubble.count} feedback, emerging signal` : bubble.state === 'curated' ? `${bubble.themeName}, ${bubble.count} feedback, user curated` : `${bubble.themeName}, ${bubble.count} supporting reviews, ${bubble.category.replaceAll('_', ' ')}`}
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
                <tspan x="0" y="19" className="voice-map-workspace__bubble-count" style={{ fontSize: `${Math.max(8, bubble.fontSize - 2)}px` }}>{bubble.count} {bubble.state === 'emerging' ? 'feedback' : bubble.count === 1 ? 'review' : 'reviews'}</tspan>
              </text>
            </g>
            {active === index ? <title>{bubble.state === 'emerging' ? `${bubble.themeName} · ${bubble.count} feedback · emerging signal` : bubble.state === 'curated' ? `${bubble.themeName} · ${bubble.count} feedback · user curated` : `${bubble.themeName} · ${bubble.count} supporting reviews · ${bubble.category.replaceAll('_', ' ')}`}</title> : null}
          </g>
        ))}
      </svg>
      <details className="voice-map-workspace__phrase-fallback">
        <summary>View buckets as an accessible table</summary>
        <table><thead><tr><th>Bucket</th><th>Feedback</th><th>Category</th><th>Status</th><th>Evidence</th></tr></thead><tbody>
          {rankedPhrases.map((phrase, index) => <tr key={`${phrase.themeId}:row:${index}`}><td>{phrase.themeName}</td><td>{phrase.count}</td><td>{phrase.category.replaceAll('_', ' ')}</td><td>{phrase.state === 'emerging' ? 'Emerging' : phrase.state === 'curated' ? 'User curated' : 'Recurring'}</td><td><button type="button" onClick={() => onSelect(phrase.themeId)}>Open evidence</button></td></tr>)}
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

      <SignalStrip signals={voiceMap.signals} />

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

function OverviewView({ themes, overviewBrief, onModeChange, onThemeSelect, onOpenCuration }: {
  themes: VoiceMapTheme[]
  overviewBrief?: OverviewBriefResult | null
  onModeChange: (mode: Exclude<VoiceMapMode, 'overview'>) => void
  onThemeSelect: (id: string) => void
  onOpenCuration: () => void
}) {
  const evidenceByReview = new Map(themes.flatMap((theme) => theme.evidence).map((item) => [item.reviewId, item]))
  const sources = [...evidenceByReview.values()].reduce<Record<string, number>>((totals, item) => {
    const source = item.provider || 'Unknown source'; totals[source] = (totals[source] || 0) + 1; return totals
  }, {})
  const categoryMix = themes.reduce<Record<string, number>>((totals, theme) => {
    totals[theme.type] = (totals[theme.type] || 0) + theme.metrics.reviewCount; return totals
  }, {})
  const categoryTotal = Object.values(categoryMix).reduce((total, count) => total + count, 0)
  const sourceTotal = Object.values(sources).reduce((total, count) => total + count, 0)
  const recurrence = themes.reduce((totals, theme) => {
    totals[theme.metrics.reviewCount >= 2 ? 'recurring' : 'emerging'] += 1; return totals
  }, { recurring: 0, emerging: 0 })
  const months = [...evidenceByReview.values()].reduce<Record<string, number>>((totals, item) => {
    if (item.sourceCreatedAt && !Number.isNaN(Date.parse(item.sourceCreatedAt))) totals[item.sourceCreatedAt.slice(0, 7)] = (totals[item.sourceCreatedAt.slice(0, 7)] || 0) + 1
    return totals
  }, {})
  const monthEntries = Object.entries(months).sort(([left], [right]) => left.localeCompare(right))
  const brief = overviewBrief?.status === 'ready' ? overviewBrief.brief : null
  return <div className="voice-map-workspace__overview">
    <header className="voice-map-workspace__overview-proof-heading">
      <div><p className="voice-map-workspace__label">Proof · from the saved run</p><h1>Evidence context</h1></div>
      <p>These compact signals describe breadth and maturity. Detailed topics, counts, and comments stay in Voice Map and linked evidence.</p>
    </header>
    <section className="voice-map-workspace__overview-graphs" aria-label="Evidence context from the saved run">
      <article><h2>Source breadth</h2><strong>{Object.keys(sources).length} {Object.keys(sources).length === 1 ? 'source' : 'sources'}</strong><ul>{Object.entries(sources).sort(([, left], [, right]) => right - left).map(([source, count]) => <li key={source}><span>{source === 'csv_import' ? 'Uploaded feedback' : source.replaceAll('_', ' ')}</span><b>{sourceTotal ? Math.round((count / sourceTotal) * 100) : 0}%</b></li>)}</ul></article>
      <article><h2>Category mix</h2><ul>{Object.entries(categoryMix).sort(([, left], [, right]) => right - left).map(([category, count]) => <li key={category}><span>{category.replaceAll('_', ' ')}</span><b>{categoryTotal ? Math.round((count / categoryTotal) * 100) : 0}%</b></li>)}</ul></article>
      <article><h2>Signal maturity</h2><ul><li><span>Recurring</span><b>{recurrence.recurring}</b></li><li><span>Emerging</span><b>{recurrence.emerging}</b></li></ul><p>{recurrence.recurring === 0 ? 'Early signals only; recurrence is not established yet.' : 'Recurring signals have support from more than one comment.'}</p></article>
      <article><h2>Time context</h2>{monthEntries.length >= 2 ? <ol>{monthEntries.map(([month, count]) => <li key={month}><span>{month}</span><b>{count}</b></li>)}</ol> : <p>No trend is shown because the saved evidence does not span enough dated periods.</p>}</article>
    </section>
    {brief ? <section className="voice-map-workspace__intelligence" aria-labelledby="overview-intelligence-title">
      <header><p className="voice-map-workspace__label">Interpretation · Voice Lab intelligence</p><h2 id="overview-intelligence-title">What does the evidence mean?</h2><p>Each interpretation is grounded in the saved map and links back to its evidence. It cannot alter the proof above.</p></header>
      <article className="voice-map-workspace__intelligence-lead"><span className="voice-map-workspace__brief-label"><Icon icon={Sparkles} size={15} />What Voice Lab understood</span><h3>{brief.understood.title}</h3><p>{brief.understood.narrative}</p><OverviewCitations item={brief.understood} themes={themes} onSelect={onThemeSelect} /></article>
      <div className="voice-map-workspace__intelligence-grid">
        {brief.majorOpportunity ? <article><span className="voice-map-workspace__brief-label"><Icon icon={Lightbulb} size={15} />Major opportunity</span><h3>{brief.majorOpportunity.title}</h3><p>{brief.majorOpportunity.narrative}</p><OverviewCitations item={brief.majorOpportunity} themes={themes} onSelect={onThemeSelect} /></article> : null}
        {brief.majorRisk ? <article><span className="voice-map-workspace__brief-label"><Icon icon={TriangleAlert} size={15} />Major risk</span><h3>{brief.majorRisk.title}</h3><p>{brief.majorRisk.narrative}</p><OverviewCitations item={brief.majorRisk} themes={themes} onSelect={onThemeSelect} /></article> : null}
      </div>
      <div className="voice-map-workspace__intelligence-grid">
        <section><h3><Icon icon={Handshake} size={18} />Sales implications</h3>{brief.salesImplications.map((item) => <article key={`${item.title}-${item.themeIds.join('-')}`}><h4>{item.title}</h4><p>{item.narrative}</p><OverviewCitations item={item} themes={themes} onSelect={onThemeSelect} /></article>)}</section>
        <section><h3><Icon icon={Megaphone} size={18} />Marketing implications</h3>{brief.marketingImplications.map((item) => <article key={`${item.title}-${item.themeIds.join('-')}`}><h4>{item.title}</h4><p>{item.narrative}</p><OverviewCitations item={item} themes={themes} onSelect={onThemeSelect} /></article>)}</section>
      </div>
    </section> : <p className="voice-map-workspace__overview-fallback" role="status">{overviewBrief?.message || 'The intelligence brief is unavailable. Evidence context remains available.'}</p>}
    {brief ? <section className="voice-map-workspace__next-actions" aria-labelledby="overview-actions-title"><header><p className="voice-map-workspace__brief-label"><Icon icon={ListChecks} size={17} />Next actions</p><h2 id="overview-actions-title">What should we do next?</h2><p>These actions are interpretation, not changes to the saved map. Each one links to the evidence that supports it.</p></header><ol>{brief.nextActions.map((item) => <li key={`${item.title}-${item.themeIds.join('-')}`}><article><h3>{item.title}</h3><p>{item.rationale}</p><OverviewCitations item={item} themes={themes} onSelect={onThemeSelect} /></article></li>)}</ol></section> : null}
    <nav className="voice-map-workspace__overview-actions" aria-label="Decision brief next actions">
      <button type="button" onClick={() => onModeChange('read')}>Open Voice Map <ArrowRight size={15} aria-hidden="true" /></button>
      <button type="button" onClick={() => onModeChange('investigate')}>Inspect evidence <ArrowRight size={15} aria-hidden="true" /></button>
      <button type="button" onClick={onOpenCuration}>Open Curation <ArrowRight size={15} aria-hidden="true" /></button>
    </nav>
  </div>
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
  const section = props.section || 'voice-map'
  const voiceMapMode = props.mode === 'investigate' ? 'investigate' : 'read'
  return (
    <section className="voice-map-workspace" aria-busy={props.status === 'loading'}>
      {section === 'voice-map' ? <div className="voice-map-workspace__mode-bar" role="tablist" aria-label="Voice Map mode">
        <button type="button" role="tab" aria-selected={voiceMapMode === 'read'} className={voiceMapMode === 'read' ? 'is-active' : ''} onClick={() => props.onModeChange('read')}><Icon icon={Sparkles} size={15} /> Read</button>
        <button type="button" role="tab" aria-selected={voiceMapMode === 'investigate'} className={voiceMapMode === 'investigate' ? 'is-active' : ''} onClick={() => props.onModeChange('investigate')}><Icon icon={Search} size={15} /> Investigate</button>
        {props.run ? <span>Run {props.run.id.slice(0, 8)} · {formatDate(props.run.createdAt)}</span> : null}
      </div> : null}

      {props.status === 'loading' ? <div className="voice-map-workspace__state"><span className="voice-map-workspace__loader" aria-hidden="true" /><p className="voice-map-workspace__label">Synthesizing validated evidence</p><h1>Building the narrative from themes.</h1><p>Claims are being linked to their supporting customer language.</p></div> : null}
      {props.status === 'error' ? <div className="voice-map-workspace__state"><Icon icon={ShieldCheck} size={29} /><p className="voice-map-workspace__label">Voice Map unavailable</p><h1>The evidence could not be synthesized.</h1><p role="alert">{props.error || 'The analysis run did not produce a readable Voice Map.'}</p></div> : null}
      {props.status === 'empty' ? <div className="voice-map-workspace__state"><Icon icon={BarChart3} size={29} /><p className="voice-map-workspace__label">No validated themes</p><h1>There is not enough evidence yet.</h1><p>Choose a broader dataset or lower the minimum support threshold, then create a new analysis run.</p></div> : null}
      {props.status === 'ready' && props.run && props.voiceMap ? (section === 'overview'
        ? <OverviewView themes={props.themes} overviewBrief={props.overviewBrief} onModeChange={props.onOpenVoiceMap || props.onModeChange} onThemeSelect={props.onThemeSelect} onOpenCuration={props.onOpenCuration} />
        : voiceMapMode === 'read' ? <ReadView run={props.run} voiceMap={props.voiceMap} themes={props.themes} onThemeSelect={props.onThemeSelect} />
          : <InvestigateView run={props.run} themes={props.themes} onThemeSelect={props.onThemeSelect} />) : null}
      {selectedTheme ? <EvidenceDialog theme={selectedTheme} onClose={props.onThemeClose} onOpenReview={props.onOpenReview} /> : null}
    </section>
  )
}
