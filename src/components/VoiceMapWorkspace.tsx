import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  ArrowRight,
  BarChart3,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Handshake,
  Lightbulb,
  ListChecks,
  Mail,
  Megaphone,
  MessageSquareQuote,
  Quote,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
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
  ratingScale?: number | null
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
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
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

const storyCategories: Array<{ key: VoiceMapSignalType; label: string }> = [
  { key: 'pain', label: 'Pain' }, { key: 'desired_outcome', label: 'Desired outcome' },
  { key: 'objection', label: 'Objection' }, { key: 'emotion', label: 'Emotion' }, { key: 'other', label: 'Other' },
]

function storySource(provider: string) {
  const key = (provider || 'unknown').trim().toLowerCase().replaceAll(' ', '_')
  if (key.includes('csv') || key.includes('upload') || key === 'demo_submission') return { key: 'uploaded_csv', label: 'Uploaded CSV', icon: FileSpreadsheet }
  if (key.includes('google')) return { key: 'google_reviews', label: 'Google reviews', icon: Star }
  if (key.includes('email')) return { key: 'email', label: 'Email', icon: Mail }
  if (key.includes('support') || key.includes('intercom') || key.includes('zendesk')) return { key: 'support_tickets', label: 'Support tickets', icon: MessageSquareQuote }
  if (key.includes('survey') || key.includes('typeform')) return { key: 'surveys', label: 'Surveys', icon: ClipboardList }
  return { key, label: provider ? provider.replaceAll('_', ' ') : 'Unknown source', icon: FileText }
}

function storyShare(count: number, total: number) {
  return total ? Math.round((count / total) * 100) : 0
}

function storyDateBucket(date: string, orderedDates: string[]) {
  const first = new Date(`${orderedDates[0]}T00:00:00Z`)
  const last = new Date(`${orderedDates.at(-1)}T00:00:00Z`)
  const spanDays = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86_400_000))
  const current = new Date(`${date}T00:00:00Z`)
  if (spanDays <= 31) return date
  if (spanDays <= 180) {
    const day = current.getUTCDay()
    current.setUTCDate(current.getUTCDate() - ((day + 6) % 7))
  } else {
    current.setUTCDate(1)
  }
  return current.toISOString().slice(0, 10)
}

export function buildSignalStory(themes: VoiceMapTheme[]) {
  const orderedThemes = [...themes].sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))
  const reviews = new Map<string, { category: VoiceMapSignalType; provider: string; date: string | null; rating: number | null; ratingScale: number | null; themeId: string; topic: string }>()
  for (const theme of orderedThemes) {
    for (const evidence of theme.evidence) {
      if (reviews.has(evidence.reviewId)) continue
      const date = evidence.sourceCreatedAt ? new Date(evidence.sourceCreatedAt) : null
      reviews.set(evidence.reviewId, {
        category: storyCategories.some(({ key }) => key === theme.type) ? theme.type : 'other',
        provider: evidence.provider,
        date: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null,
        rating: evidence.rating,
        ratingScale: evidence.ratingScale ?? null,
        themeId: theme.id,
        topic: theme.topic || theme.name,
      })
    }
  }
  const total = reviews.size
  const topicCounts = new Map<string, { label: string; count: number }>()
  for (const review of reviews.values()) {
    const prior = topicCounts.get(review.themeId)
    topicCounts.set(review.themeId, { label: review.topic, count: (prior?.count || 0) + 1 })
  }
  const topTopics = [...topicCounts.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .slice(0, 5)
  const topTopicIds = new Set(topTopics.map(([key]) => key))
  const topicKey = (themeId: string) => topTopicIds.has(themeId) ? themeId : 'other'
  const topicMix = topTopics.map(([key, value], index) => ({ key, label: value.label, count: value.count, share: storyShare(value.count, total), color: categoryColors[index % categoryColors.length] }))
  const otherCount = total - topicMix.reduce((sum, item) => sum + item.count, 0)
  if (otherCount > 0) topicMix.push({ key: 'other', label: 'Other topics', count: otherCount, share: storyShare(otherCount, total), color: categoryColors[topicMix.length % categoryColors.length] })
  const sourceCounts = new Map<string, { label: string; count: number }>()
  const categoryCounts = new Map<VoiceMapSignalType, number>()
  const dateCounts = new Map<string, number>()
  const topicDateCounts = new Map<string, Record<string, number>>()
  const experienceDateCounts = new Map<string, { negative: number; neutral: number; positive: number; unrated: number; ratingPercentTotal: number; ratingTotal: number; ratingScales: Set<number>; ratedCount: number }>()
  const orderedDates = [...new Set([...reviews.values()].flatMap((review) => review.date ? [review.date] : []))].sort()
  for (const review of reviews.values()) {
    categoryCounts.set(review.category, (categoryCounts.get(review.category) || 0) + 1)
    const source = storySource(review.provider)
    const priorSource = sourceCounts.get(source.key)
    sourceCounts.set(source.key, { label: source.label, count: (priorSource?.count || 0) + 1 })
    if (review.date) {
      const dateBucket = storyDateBucket(review.date, orderedDates)
      dateCounts.set(dateBucket, (dateCounts.get(dateBucket) || 0) + 1)
      const counts = topicDateCounts.get(dateBucket) || {}
      const key = topicKey(review.themeId)
      counts[key] = (counts[key] || 0) + 1
      topicDateCounts.set(dateBucket, counts)
      const experience = experienceDateCounts.get(dateBucket) || { negative: 0, neutral: 0, positive: 0, unrated: 0, ratingPercentTotal: 0, ratingTotal: 0, ratingScales: new Set<number>(), ratedCount: 0 }
      if (review.rating === null || !review.ratingScale || review.ratingScale <= 0) experience.unrated += 1
      else {
        const ratio = review.rating / review.ratingScale
        experience[ratio <= .4 ? 'negative' : ratio >= .8 ? 'positive' : 'neutral'] += 1
        experience.ratingPercentTotal += ratio * 100
        experience.ratingTotal += review.rating
        experience.ratingScales.add(review.ratingScale)
        experience.ratedCount += 1
      }
      experienceDateCounts.set(dateBucket, experience)
    }
  }
  const sourceMix = [...sourceCounts.entries()]
    .map(([key, value]) => ({ key, ...value, share: storyShare(value.count, total) }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
  const categoryMix = storyCategories.flatMap(({ key, label }) => {
    const count = categoryCounts.get(key) || 0
    return count ? [{ key, label, count, share: storyShare(count, total) }] : []
  })
  const timeline = [...dateCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({ date, count }))
  const topicTimeline = [...topicDateCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, counts]) => ({ date, counts }))
  const experienceTimeline = [...experienceDateCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, counts]) => ({
    date,
    negative: counts.negative,
    neutral: counts.neutral,
    positive: counts.positive,
    unrated: counts.unrated,
    averageRatingPercent: counts.ratedCount ? Math.round(counts.ratingPercentTotal / counts.ratedCount) : null,
    averageRating: counts.ratedCount ? Math.round((counts.ratingTotal / counts.ratedCount) * 10) / 10 : null,
    ratingScale: counts.ratingScales.size === 1 ? [...counts.ratingScales][0] : null,
    ratedCount: counts.ratedCount,
  }))
  const ratedDates = experienceTimeline.filter((item) => item.negative + item.neutral + item.positive > 0).length
  const ratingScales = new Set(experienceTimeline.flatMap((item) => item.ratedCount && item.ratingScale ? [item.ratingScale] : []))
  const hasConsistentRatingScale = ratedDates >= 2
    && ratingScales.size === 1
    && experienceTimeline.every((item) => !item.ratedCount || item.ratingScale !== null)
  return {
    topicMix,
    categoryMix,
    sourceMix,
    timeline: timeline.length >= 2 ? timeline : null,
    topicTimeline: topicTimeline.length >= 2 ? topicTimeline : null,
    experienceTimeline: hasConsistentRatingScale ? experienceTimeline : null,
  }
}

const categoryColors = ['#d7683b', '#56745f', '#8066a3', '#2f6f7a', '#ad7b2e', '#735c4d']

function StoryBar({ label, count, total, color }: { label: string; count: number; total: number; color?: string }) {
  const share = storyShare(count, total)
  const tooltip = `${label}: ${count} feedback, ${share}%`
  return <div className="voice-map-workspace__story-bar" role="img" tabIndex={0} aria-label={tooltip} data-tooltip={tooltip} style={{ '--story-color': color || '#56745f' } as CSSProperties}>
    <div><span>{label}</span><b>{count} · {share}%</b></div>
    <i aria-hidden="true"><span style={{ width: `${share}%` }} /></i>
  </div>
}

function TimeSeriesChart({ timeline }: { timeline: Array<{ date: string; count: number }> }) {
  const [active, setActive] = useState<{ label: string; left: string; top: string; leftward: boolean; above: boolean } | null>(null)
  const width = 720
  const height = 250
  const inset = { top: 24, right: 18, bottom: 38, left: 38 }
  const cumulative = timeline.reduce<Array<{ date: string; count: number }>>((points, item) => {
    points.push({ date: item.date, count: (points.at(-1)?.count || 0) + item.count })
    return points
  }, [])
  const maximum = Math.max(...cumulative.map((item) => item.count), 1)
  const x = (index: number) => inset.left + (index / Math.max(1, cumulative.length - 1)) * (width - inset.left - inset.right)
  const y = (count: number) => height - inset.bottom - (count / maximum) * (height - inset.top - inset.bottom)
  const points = cumulative.map((item, index) => `${x(index)},${y(item.count)}`).join(' ')
  const area = `${inset.left},${height - inset.bottom} ${points} ${x(cumulative.length - 1)},${height - inset.bottom}`
  const labels = [...new Set([0, Math.floor((cumulative.length - 1) / 2), cumulative.length - 1])]
  return <div className="voice-map-workspace__time-series">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Dated feedback volume">
      {[0, .5, 1].map((ratio) => <line key={ratio} x1={inset.left} x2={width - inset.right} y1={y(maximum * ratio)} y2={y(maximum * ratio)} />)}
      <polygon points={area} />
      <polyline points={points} />
      {cumulative.map((item, index) => {
        const label = `${formatDate(item.date)}: ${timeline[index].count} submitted feedback, ${item.count} cumulative`
        const point = { label, left: `${x(index) / width * 100}%`, top: `${y(item.count) / height * 100}%`, leftward: x(index) > width * .72, above: y(item.count) > height * .58 }
        return <circle key={item.date} cx={x(index)} cy={y(item.count)} r="3" tabIndex={0} aria-label={label} onMouseEnter={() => setActive(point)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(point)} onBlur={() => setActive(null)}><title>{label}</title></circle>
      })}
      {labels.map((index) => <text key={index} x={x(index)} y={height - 10} textAnchor={index === 0 ? 'start' : index === cumulative.length - 1 ? 'end' : 'middle'}>{formatDate(cumulative[index].date)}</text>)}
      <text x={inset.left - 8} y={y(maximum) + 4} textAnchor="end">{maximum}</text>
      <text x={inset.left - 8} y={height - inset.bottom + 4} textAnchor="end">0</text>
    </svg>
    <output className={`voice-map-workspace__chart-tooltip${active?.leftward ? ' is-left' : ''}${active?.above ? ' is-above' : ''}`} aria-label="Chart value" style={active ? { left: active.left, top: active.top } : undefined}>{active?.label || ''}</output>
    <p>{cumulative.at(-1)?.count || 0} dated comments · {timeline.length} active {timeline.length === 1 ? 'date' : 'dates'}</p>
  </div>
}

function TopicTimelineChart({ timeline, topics }: { timeline: Array<{ date: string; counts: Record<string, number> }>; topics: Array<{ key: string; label: string; color: string }> }) {
  const [sortOrder, setSortOrder] = useState<'highest' | 'lowest'>('highest')
  const totals = new Map(topics.map((topic) => [topic.key, timeline.reduce((sum, item) => sum + (item.counts[topic.key] || 0), 0)]))
  const sortedTopics = [...topics].sort((left, right) => {
    const difference = (totals.get(right.key) || 0) - (totals.get(left.key) || 0)
    return (sortOrder === 'highest' ? difference : -difference) || left.label.localeCompare(right.label)
  })
  const maximum = Math.max(...timeline.flatMap((item) => Object.values(item.counts)), 1)
  const columns = `minmax(130px, 1.35fr) repeat(${timeline.length}, minmax(44px, 1fr)) 42px`
  return <div className="voice-map-workspace__topic-timeline">
    <label className="voice-map-workspace__topic-sort">Sort topics<select aria-label="Sort topics" value={sortOrder} onChange={(event) => setSortOrder(event.target.value as 'highest' | 'lowest')}><option value="highest">Highest total</option><option value="lowest">Lowest total</option></select></label>
    <div className="voice-map-workspace__topic-heatmap" role="grid" aria-label="Topic mentions by period" style={{ gridTemplateColumns: columns }}>
      <span className="voice-map-workspace__topic-corner" />
      {timeline.map((item) => <span className="voice-map-workspace__topic-date" key={item.date}>{formatDate(item.date)}</span>)}
      <span className="voice-map-workspace__topic-total">Total</span>
      {sortedTopics.flatMap((topic) => {
        const cells = timeline.map((item) => {
          const count = item.counts[topic.key] || 0
          const periodTotal = Object.values(item.counts).reduce((sum, value) => sum + value, 0)
          const label = `${formatDate(item.date)} — ${topic.label}: ${count} ${count === 1 ? 'mention' : 'mentions'}, ${storyShare(count, periodTotal)}% of this period`
          const index = timeline.indexOf(item)
          return <button type="button" key={`${topic.key}:${item.date}`} aria-label={label} data-tooltip={label} data-tooltip-edge={index >= timeline.length - 2 ? 'right' : index <= 1 ? 'left' : undefined} style={{ '--topic-color': topic.color, '--topic-intensity': `${Math.round((count ? .28 + .72 * (count / maximum) : .06) * 100)}%` } as CSSProperties}><span>{count || '—'}</span></button>
        })
        return [<span className="voice-map-workspace__topic-row" key={`${topic.key}:label`}><i style={{ backgroundColor: topic.color }} />{topic.label}</span>, ...cells, <strong key={`${topic.key}:total`}>{totals.get(topic.key) || 0}</strong>]
      })}
    </div>
    <small>Cell intensity reflects exact unique evidence mentions in each period.</small>
  </div>
}

function ExperienceTrendChart({ timeline }: { timeline: Array<{ date: string; averageRatingPercent: number | null; averageRating: number | null; ratingScale: number | null; ratedCount: number }> }) {
  const [active, setActive] = useState<{ label: string; left: string; top: string; leftward: boolean; above: boolean } | null>(null)
  const rated = timeline.filter((item): item is typeof item & { averageRating: number; ratingScale: number } => item.averageRating !== null && item.ratingScale !== null)
  const scale = rated[0]?.ratingScale || 1
  const endpoints = scale === 5 ? '1 = very negative · 5 = very positive' : `1 = lowest rating · ${scale} = highest rating`
  const width = 620; const height = 210; const inset = { top: 22, right: 18, bottom: 38, left: 52 }
  const x = (index: number) => inset.left + (index / Math.max(1, rated.length - 1)) * (width - inset.left - inset.right)
  const y = (value: number) => height - inset.bottom - ((value - 1) / Math.max(1, scale - 1)) * (height - inset.top - inset.bottom)
  const points = rated.map((item, index) => `${x(index)},${y(item.averageRating)}`).join(' ')
  return <div className="voice-map-workspace__experience-trend">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Average rating on 1–${scale} source scale over time`}>
      {[1, Math.round(((scale + 1) / 2) * 10) / 10, scale].map((value) => <g key={value}><line x1={inset.left} x2={width - inset.right} y1={y(value)} y2={y(value)} /><text x={inset.left - 8} y={y(value) + 4} textAnchor="end">{value}</text></g>)}
      <polyline points={points} />
      {rated.map((item, index) => {
        const label = `${formatDate(item.date)}: ${item.averageRating}/${item.ratingScale} average mapped rating, ${item.ratedCount} rated feedback`
        const point = { label, left: `${x(index) / width * 100}%`, top: `${y(item.averageRating) / height * 100}%`, leftward: x(index) > width * .72, above: y(item.averageRating) > height * .58 }
        return <circle key={item.date} cx={x(index)} cy={y(item.averageRating)} r="4" tabIndex={0} aria-label={label} onMouseEnter={() => setActive(point)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(point)} onBlur={() => setActive(null)}><title>{label}</title></circle>
      })}
      <text x={inset.left} y={height - 10}>1 = lowest</text><text x={width - inset.right} y={height - 10} textAnchor="end">{scale} = highest</text>
    </svg>
    <output className={`voice-map-workspace__chart-tooltip${active?.leftward ? ' is-left' : ''}${active?.above ? ' is-above' : ''}`} aria-label="Chart value" style={active ? { left: active.left, top: active.top } : undefined}>{active?.label || ''}</output>
    <footer><span>{endpoints}</span><span>Higher is better on this declared positive source scale. Original values remain unchanged.</span></footer>
  </div>
}

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

export function PhraseBubbleMap({ phrases, themes = [], onSelect }: { phrases: SynthesizedVoiceMap['phrases']; themes?: VoiceMapTheme[]; onSelect: (themeId: string) => void }) {
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
  const bubbleLabel = (bubble: typeof bubbles[number]) => {
    const base = bubble.state === 'emerging' ? `${bubble.themeName}, ${bubble.count} feedback, emerging signal` : bubble.state === 'curated' ? `${bubble.themeName}, ${bubble.count} feedback, user curated` : `${bubble.themeName}, ${bubble.count} supporting reviews, ${bubble.category.replaceAll('_', ' ')}`
    const evidence = themes.find((theme) => theme.id === bubble.themeId)?.evidence || []
    if (!evidence.length) return base
    const sources = [...new Set(evidence.map((item) => storySource(item.provider).label))].join(', ')
    const dates = evidence.flatMap((item) => item.sourceCreatedAt ? [item.sourceCreatedAt] : []).sort()
    const dateContext = dates.length ? `${formatDate(dates[0])}${dates.length > 1 ? ` to ${formatDate(dates.at(-1) || null)}` : ''}` : 'date unavailable'
    return `${base}, ${evidence.length} linked evidence, ${sources}, ${dateContext}`
  }
  if (!rankedPhrases.length) return <p className="voice-map-workspace__no-evidence">No categorized feedback is available yet.</p>
  const activeBubble = active === null ? null : bubbles[active]
  const activeBubbleLabel = activeBubble ? bubbleLabel(activeBubble) : ''
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
            aria-label={bubbleLabel(bubble)}
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
            {active === index ? <title>{bubbleLabel(bubble)}</title> : null}
          </g>
        ))}
      </svg>
      <output className={`voice-map-workspace__chart-tooltip${activeBubble && activeBubble.x > 480 * .72 ? ' is-left' : ''}${activeBubble && activeBubble.y > height * .58 ? ' is-above' : ''}`} aria-label="Chart value" style={activeBubble ? { left: `${activeBubble.x / 480 * 100}%`, top: `${activeBubble.y / height * 100}%` } : undefined}>{activeBubbleLabel}</output>
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
          <PhraseBubbleMap phrases={voiceMap.phrases} themes={themes} onSelect={onThemeSelect} />
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
  const story = buildSignalStory(themes)
  const storyTotal = story.topicMix.reduce((sum, item) => sum + item.count, 0)
  const brief = overviewBrief?.status === 'ready' ? overviewBrief.brief : null
  return <div className="voice-map-workspace__overview">
    <header className="voice-map-workspace__overview-heading"><div><p className="voice-map-workspace__label">Signal Story · saved evidence</p><h1>Overview</h1></div></header>
    {brief ? <section className="voice-map-workspace__intelligence-banner" aria-label="Signal intelligence">
      <Icon icon={Sparkles} size={22} />
      <article><span className="voice-map-workspace__brief-label">What Voice Lab understood</span><h2>{brief.understood.title}</h2><p>{brief.understood.narrative}</p><OverviewCitations item={brief.understood} themes={themes} onSelect={onThemeSelect} /></article>
      <div className="voice-map-workspace__intelligence-asides">
        {brief.majorOpportunity ? <article><span className="voice-map-workspace__brief-label"><Icon icon={Lightbulb} size={15} />Major opportunity</span><h3>{brief.majorOpportunity.title}</h3><OverviewCitations item={brief.majorOpportunity} themes={themes} onSelect={onThemeSelect} /></article> : null}
        {brief.majorRisk ? <article><span className="voice-map-workspace__brief-label"><Icon icon={TriangleAlert} size={15} />Major risk</span><h3>{brief.majorRisk.title}</h3><OverviewCitations item={brief.majorRisk} themes={themes} onSelect={onThemeSelect} /></article> : null}
      </div>
    </section> : <p className="voice-map-workspace__overview-fallback" role="status">{overviewBrief?.message || 'Preparing the intelligence brief…'}</p>}
    <section className="voice-map-workspace__story-dashboard" aria-label="Signal Story from saved evidence">
      <div className="voice-map-workspace__story-primary">
        {story.timeline ? <figure className="voice-map-workspace__story-chart is-volume" aria-label="Feedback over time"><figcaption><span>Evidence volume</span><h2>How feedback accumulated</h2><p>Valid dated comments, counted once.</p></figcaption><TimeSeriesChart timeline={story.timeline} /></figure> : null}
        {story.topicTimeline ? <figure className="voice-map-workspace__story-chart is-primary" aria-label="Topic composition over time"><figcaption><span>Topics over time</span><h2>What customers talked about, and when</h2><p>Each comment is counted once under its saved Voice Map topic.</p></figcaption><TopicTimelineChart timeline={story.topicTimeline} topics={story.topicMix} /></figure> : <div className="voice-map-workspace__story-chart is-primary"><p className="voice-map-workspace__story-unavailable">No topic timeline is shown because the saved evidence does not span enough valid dates.</p></div>}
        <figure className="voice-map-workspace__story-chart is-source" aria-label="Source mix"><figcaption><span>Source mix</span><h2>Where the signal came from</h2><p>Known source aliases are grouped; stored provider values stay intact.</p></figcaption><div>{story.sourceMix.map((item) => <div className="voice-map-workspace__story-source" key={item.key}><Icon icon={storySource(item.key).icon} size={17} /><StoryBar label={item.label} count={item.count} total={storyTotal} /></div>)}</div></figure>
      </div>
      <div className="voice-map-workspace__story-support">
        {story.experienceTimeline ? <figure className="voice-map-workspace__story-chart is-experience" aria-label="Rated experience over time"><figcaption><span>Ratings over time</span><h2>How submitted ratings shifted</h2><p>Calculated only from one consistent declared positive source scale; not proof of product improvement.</p></figcaption><ExperienceTrendChart timeline={story.experienceTimeline} /></figure> : <figure className="voice-map-workspace__story-chart is-experience" aria-label="Rating trend unavailable"><p className="voice-map-workspace__story-unavailable">A rating trend needs mapped ratings on one consistent declared positive scale across at least two valid dated periods.</p></figure>}
        <figure className="voice-map-workspace__story-chart is-category" aria-label="Category composition"><figcaption><span>Category context</span><h2>How the feedback is framed</h2><p>Supporting context from each comment’s saved category.</p></figcaption><div className="voice-map-workspace__category-band" role="img" aria-label={`Category composition: ${story.categoryMix.map((item) => `${item.label} ${item.count}`).join(', ')}`}>{story.categoryMix.map((item, index) => <i key={item.key} style={{ width: `${item.share}%`, backgroundColor: categoryColors[index] }} />)}</div><div className="voice-map-workspace__category-legend">{story.categoryMix.map((item, index) => { const tooltip = `${item.label}: ${item.count} feedback, ${item.share}%`; return <div key={item.key} role="img" tabIndex={0} aria-label={tooltip} data-tooltip={tooltip}><i style={{ backgroundColor: categoryColors[index] }} /><span>{item.label}</span><b>{item.count} · {item.share}%</b></div> })}</div></figure>
      </div>
    </section>
    {brief ? <section className="voice-map-workspace__recommended-actions" aria-label="Recommended actions">
      <header><p className="voice-map-workspace__label">Evidence-backed action</p><h2>Where to act next</h2><p>Interpretation only. Every recommendation links back to the saved Voice Map.</p></header>
      <div>
        <section><h3><Icon icon={Handshake} size={19} />Sales</h3>{brief.salesImplications.slice(0, 1).map((item) => <article key={`${item.title}-${item.themeIds.join('-')}`}><h4>{item.title}</h4><p>{item.narrative}</p><OverviewCitations item={item} themes={themes} onSelect={onThemeSelect} /></article>)}</section>
        <section><h3><Icon icon={Megaphone} size={19} />Marketing</h3>{brief.marketingImplications.slice(0, 1).map((item) => <article key={`${item.title}-${item.themeIds.join('-')}`}><h4>{item.title}</h4><p>{item.narrative}</p><OverviewCitations item={item} themes={themes} onSelect={onThemeSelect} /></article>)}</section>
        <section><h3><Icon icon={ListChecks} size={19} />Product &amp; team</h3>{brief.nextActions.slice(0, 1).map((item) => <article key={`${item.title}-${item.themeIds.join('-')}`}><h4>{item.title}</h4><p>{item.rationale}</p><OverviewCitations item={item} themes={themes} onSelect={onThemeSelect} /></article>)}</section>
      </div>
    </section> : null}
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
