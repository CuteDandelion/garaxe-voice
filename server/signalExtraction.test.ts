import { describe, expect, it } from 'vitest'
import {
  SIGNAL_EXTRACTOR_VERSION,
  extractAdaptiveSignals,
  extractSignals,
  extractSignalsFromReview,
  type SignalExtractionReview,
} from './signalExtraction'

const review = (text: string | null, overrides: Partial<SignalExtractionReview> = {}): SignalExtractionReview => ({
  reviewId: 'review-1',
  text,
  rating: 3,
  language: 'en',
  entity: 'Berlin Mitte',
  sourceCreatedAt: '2026-07-01T12:00:00Z',
  ...overrides,
})

describe('extractSignalsFromReview', () => {
  it('extracts exact source spans and never invents evidence', () => {
    const text = 'The setup was too complicated for our team.'
    const [signal] = extractSignalsFromReview(review(text))
    expect(signal).toMatchObject({
      id: 'review-1:signal:1',
      ordinal: 1,
      reviewId: 'review-1',
      signalType: 'pain_point',
      normalizedAspect: 'setup complexity',
      quoteText: 'setup was too complicated',
      quoteStart: 4,
      quoteEnd: 29,
      attributes: { extractorVersion: SIGNAL_EXTRACTOR_VERSION, rating: 3, language: 'en' },
    })
    expect(signal.quoteText).toBe(text.slice(signal.quoteStart, signal.quoteEnd))
  })

  it('selects the matching occurrence when a phrase repeats', () => {
    const text = 'Setup was fine yesterday; today the setup was too complicated.'
    const [signal] = extractSignalsFromReview(review(text))
    expect(signal.quoteStart).toBe(text.lastIndexOf('setup'))
    expect(signal.quoteText).toBe('setup was too complicated')
  })

  it('keeps praise and complaint clauses as independent evidence', () => {
    const text = 'The staff were lovely, but we waited almost an hour.'
    const signals = extractSignalsFromReview(review(text, { rating: 2 }))
    expect(signals.map(({ signalType, normalizedAspect }) => [signalType, normalizedAspect])).toEqual([
      ['praise', 'staff friendliness'],
      ['service_issue', 'waiting time'],
    ])
    expect(signals.map(({ quoteText }) => quoteText)).toEqual(['staff were lovely', 'waited almost an hour'])
  })

  it('does not misclassify negated praise and recognizes explicit negative usability', () => {
    const signals = extractSignalsFromReview(review('It was not easy to use, although the staff were friendly.'))
    expect(signals.map(({ signalType, normalizedAspect }) => [signalType, normalizedAspect])).toEqual([
      ['pain_point', 'usability'],
      ['praise', 'staff friendliness'],
    ])
    expect(signals.filter(({ normalizedAspect }) => normalizedAspect === 'usability')).toHaveLength(1)
    expect(signals[0].sentiment).toBe('negative')
  })

  it('returns no evidence for empty and rating-only records', () => {
    expect(extractSignalsFromReview(review(null, { rating: 5 }))).toEqual([])
    expect(extractSignalsFromReview(review('   ', { rating: 1 }))).toEqual([])
  })

  it('uses JavaScript UTF-16 offsets safely for Unicode text', () => {
    const text = '😊 Café visit: the staff were kind and helpful.'
    const [signal] = extractSignalsFromReview(review(text))
    expect(signal.quoteStart).toBe(text.indexOf('staff'))
    expect(signal.quoteText).toBe('staff were kind')
    expect(text.slice(signal.quoteStart, signal.quoteEnd)).toBe(signal.quoteText)
  })

  it('keeps confidence bounded and stable identifiers/order across runs', () => {
    const input = review('I felt relieved because the friendly staff helped, but delivery was late.')
    const first = extractSignalsFromReview(input)
    const second = extractSignalsFromReview(input)
    expect(second).toEqual(first)
    expect(first.map(({ id }) => id)).toEqual([
      'review-1:signal:1',
      'review-1:signal:2',
      'review-1:signal:3',
    ])
    expect(first.every(({ confidence }) => confidence >= 0 && confidence <= 1)).toBe(true)
    expect(first.map(({ quoteStart }) => quoteStart)).toEqual([...first.map(({ quoteStart }) => quoteStart)].sort((a, b) => a - b))
  })

  it('extracts a conservative range of common aspects and intentions', () => {
    const signals = extractSignalsFromReview(review(
      "I wasn't sure it would work for my niche. I chose it because support was quick. I wish it had offline mode.",
    ))
    expect(signals.map(({ signalType }) => signalType)).toEqual(['objection', 'purchase_trigger', 'praise', 'feature_request'])
    expect(signals.map(({ normalizedAspect }) => normalizedAspect)).toEqual([
      'niche fit', 'purchase motivation', 'support speed', 'feature request',
    ])
  })

  it('recognizes natural setup, documentation, and price language from review exports', () => {
    const text = 'The setup took days and the documentation sent us in circles. The price felt high, but a much simpler setup was welcome.'
    const signals = extractSignalsFromReview(review(text))
    expect(signals.map(({ normalizedAspect }) => normalizedAspect)).toEqual([
      'setup complexity', 'documentation', 'price and value', 'setup complexity',
    ])
    for (const signal of signals) expect(text.slice(signal.quoteStart, signal.quoteEnd)).toBe(signal.quoteText)
  })
})

describe('extractSignals', () => {
  it('preserves review order while assigning review-local stable ordinals', () => {
    const signals = extractSignals([
      review('Great value.', { reviewId: 'a' }),
      review('Support was too slow.', { reviewId: 'b' }),
    ])
    expect(signals.map(({ id }) => id)).toEqual(['a:signal:1', 'b:signal:1'])
    for (const signal of signals) {
      const source = signal.reviewId === 'a' ? 'Great value.' : 'Support was too slow.'
      expect(signal.quoteText).toBe(source.slice(signal.quoteStart, signal.quoteEnd))
    }
  })
})

describe('extractAdaptiveSignals', () => {
  it('discovers repeated aspects from the dataset instead of a fixed domain vocabulary', () => {
    const reviews = [
      review('The noodles arrived cold and soggy.', { reviewId: 'a', rating: 1 }),
      review('Cold fries and torn packaging.', { reviewId: 'b', rating: 2 }),
      review('The soup was cold at the table.', { reviewId: 'c', rating: 2 }),
      review('Fresh herbs and crisp vegetables.', { reviewId: 'd', rating: 5 }),
      review('The bread tasted fresh today.', { reviewId: 'e', rating: 5 }),
      review('Fresh ingredients made the meal excellent.', { reviewId: 'f', rating: 4 }),
    ]
    const signals = extractAdaptiveSignals(reviews, [])
    expect(signals.filter((signal) => signal.normalizedAspect === 'cold')).toHaveLength(3)
    expect(signals.filter((signal) => signal.normalizedAspect === 'fresh')).toHaveLength(3)
    expect(signals.find((signal) => signal.normalizedAspect === 'cold')).toMatchObject({ signalType: 'pain_point', quoteText: 'cold' })
    expect(signals.find((signal) => signal.normalizedAspect === 'fresh')).toMatchObject({ signalType: 'praise', quoteText: 'Fresh' })
    for (const signal of signals) {
      const source = reviews.find((item) => item.reviewId === signal.reviewId)?.text || ''
      expect(source.slice(signal.quoteStart, signal.quoteEnd)).toBe(signal.quoteText)
    }
  })
})
