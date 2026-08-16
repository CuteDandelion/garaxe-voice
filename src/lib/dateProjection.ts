import type { AnalysisCoverageItem } from './api'
import type { VoiceMapTheme } from '../components/VoiceMapWorkspace'

function sourceDate(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return null
  const calendarDate = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  return calendarDate || new Date(value).toISOString().slice(0, 10)
}

export function projectThemeSummary(summary: string, reviewCount: number) {
  return /^\s*\d+\s+feedback items?\s+forms?\s+a\s+category-first\s+recurring\s+candidate\.\s*$/i.test(summary)
    ? reviewCount === 1 ? 'This comment has its own topic; more feedback may confirm recurrence.' : `${reviewCount} feedback items form a category-first recurring candidate.`
    : summary
}

export function projectDateRange(
  themes: VoiceMapTheme[],
  coverage: AnalysisCoverageItem[],
  range: { from: string | null; to: string | null },
) {
  if (!range.from && !range.to) return { themes, coverage }
  const includes = (value: string | null | undefined) => {
    const date = sourceDate(value)
    return date !== null && (!range.from || date >= range.from) && (!range.to || date <= range.to)
  }
  const projectedCoverage = coverage.filter((item) => includes(item.source?.sourceCreatedAt))
  const projectedThemes = themes.flatMap((theme) => {
    const evidence = theme.evidence.filter((item) => includes(item.sourceCreatedAt))
    if (!evidence.length) return []
    const reviewCount = new Set(evidence.map((item) => item.reviewId)).size
    const ratings = evidence.map((item) => item.rating).filter((value): value is number => value !== null && Number.isFinite(value))
    return [{
      ...theme,
      summary: projectThemeSummary(theme.summary, reviewCount),
      representativeQuote: evidence.some((item) => item.quote === theme.representativeQuote) ? theme.representativeQuote : evidence[0].quote,
      evidence,
      metrics: {
        ...theme.metrics,
        reviewCount,
        signalCount: evidence.length,
        prevalence: projectedCoverage.length ? reviewCount / projectedCoverage.length : 0,
        averageRating: ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null,
      },
    }]
  })
  return { themes: projectedThemes, coverage: projectedCoverage }
}
