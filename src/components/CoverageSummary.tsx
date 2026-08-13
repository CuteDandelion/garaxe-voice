import type { PrimarySemanticCategory, VoiceSentiment } from '../lib/api'

export type CoverageItem = {
  reviewId: string
  originalText: string
  disposition: 'recurring' | 'emerging' | 'user_curated' | 'error' | 'excluded'
  reason: string
  themeIds: string[]
  signals?: Array<{ label: string; topic?: string | null; signalType: PrimarySemanticCategory; signalTypes?: PrimarySemanticCategory[]; category?: PrimarySemanticCategory; categories?: PrimarySemanticCategory[]; sentiment?: VoiceSentiment; confidence: number; quote: string; interpretedBy?: 'analysis_engine' | 'deterministic' }>
}

export function customerDispositionLabel(disposition: CoverageItem['disposition']) {
  return ({ recurring: 'Recurring', emerging: 'Emerging', user_curated: 'Your changes', error: 'Input errors', excluded: 'Excluded' } as const)[disposition]
}

export function customerCoverageReason(item: Pick<CoverageItem, 'disposition'>) {
  return ({
    recurring: 'Recurring topic supported by more than one comment.',
    emerging: 'This comment has its own topic; more feedback may confirm recurrence.',
    user_curated: 'Moved by a person during Curation.',
    error: 'This input could not be analyzed.',
    excluded: 'Excluded by this run’s feedback filters.',
  } as const)[item.disposition]
}

export function CoverageSummary({ items, onThemeSelect, demo = false }: {
  items: CoverageItem[]
  onThemeSelect: (themeId: string) => void
  demo?: boolean
}) {
  const counts = items.reduce<Record<string, number>>((result, item) => ({ ...result, [item.disposition]: (result[item.disposition] || 0) + 1 }), {})
  const emerging = items.filter((item) => item.disposition === 'emerging' && item.signals?.length)
  return <section className="coverage-summary" aria-label="Feedback coverage">
    <p className="voice-map-workspace__label">Feedback coverage</p>
    <h2>Every submitted comment is accounted for.</h2>
    <p className="coverage-summary__status">{items.length} comments accounted for{demo ? ' · temporary workspace expires after 24 hours' : ''}</p>
    <dl>{(['recurring', 'emerging', 'user_curated', 'error', 'excluded'] as CoverageItem['disposition'][]).map((key) => <div key={key}><dt>{customerDispositionLabel(key)}</dt><dd>{counts[key] || 0}</dd></div>)}</dl>
    {emerging.length ? <section className="coverage-summary__emerging" aria-label="Emerging signals"><p className="voice-map-workspace__label">Individual signal · visible in Voice Map</p><h3>Emerging signals</h3><p>Each valid comment has a category and full-colour bubble. Recurrence is communicated by feedback count and bubble size.</p><ol>{emerging.map((item) => <li key={item.reviewId}>{item.signals!.map((signal) => <div key={`${signal.signalType}:${signal.label}`}><strong>{signal.label}</strong><span>{signal.category || signal.signalType} · {signal.sentiment || 'neutral'} sentiment{signal.topic ? ` · ${signal.topic}` : ''} · {Math.round(signal.confidence * 100)}% confidence</span><blockquote>“{signal.quote}”</blockquote></div>)}<small>{customerCoverageReason(item)}</small></li>)}</ol></section> : null}
    <details><summary>Trace all {items.length} comments</summary><ol>{items.map((item) => <li key={item.reviewId}><strong>{customerDispositionLabel(item.disposition)}</strong><p>{item.originalText}</p>{item.signals?.map((signal) => <span key={`${signal.signalType}:${signal.label}`}>{signal.category?.replaceAll('_', ' ') || signal.signalType.replaceAll('_', ' ')} · {signal.label}</span>)}<small>{customerCoverageReason(item)}</small>{item.themeIds.map((themeId) => <button key={themeId} onClick={() => onThemeSelect(themeId)}>Open linked theme</button>)}</li>)}</ol></details>
  </section>
}
