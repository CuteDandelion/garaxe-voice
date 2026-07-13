import { describe, expect, it } from 'vitest'
import { normalizeReviewText, preprocessReviews, type PreprocessingReview } from './preprocessing'

const base = (id: string, overrides: Partial<PreprocessingReview> = {}): PreprocessingReview => ({
  id,
  bodyOriginal: 'Friendly staff and a thoughtful, reliable service experience.',
  ratingValue: 5,
  language: 'en',
  sourceCreatedAt: '2026-06-15T12:00:00Z',
  entityId: 'location-1',
  entityName: 'Berlin Mitte',
  ...overrides,
})

const config = { writtenOnly: true, minTextLength: 10 }

describe('normalizeReviewText', () => {
  it('normalizes Unicode and whitespace without changing the input source', () => {
    const original = '  Ｈｅｌｌｏ\n\tworld  '
    expect(normalizeReviewText(original)).toBe('Hello world')
    expect(original).toBe('  Ｈｅｌｌｏ\n\tworld  ')
  })
})

describe('preprocessReviews', () => {
  it('preserves original text and records normalized derived text', () => {
    const result = preprocessReviews([base('one', { bodyOriginal: '  Great\n service  ' })], { ...config, minTextLength: 1 })
    expect(result.reviews[0]).toMatchObject({
      originalText: '  Great\n service  ',
      normalizedText: 'Great service',
      status: 'included',
      reason: 'included',
    })
  })

  it('applies deterministic exclusion precedence and every required reason', () => {
    const result = preprocessReviews([
      base('user', { userExcluded: true, sourceCreatedAt: '2020-01-01', bodyOriginal: '' }),
      base('date', { sourceCreatedAt: '2020-01-01' }),
      base('rating-only', { bodyOriginal: '', isRatingOnly: true }),
      base('empty', { bodyOriginal: '', isRatingOnly: false }),
      base('short', { bodyOriginal: 'Brief' }),
      base('language', { language: 'de' }),
      base('spam', { isSuspectedSpam: true }),
      base('canonical'),
      base('duplicate'),
    ], { ...config, languages: ['en'], dateFrom: '2026-01-01' })
    expect(result.reviews.map(({ reason }) => reason)).toEqual([
      'user_excluded', 'outside_date_range', 'rating_only', 'empty_text', 'too_short',
      'user_excluded', 'suspected_spam', 'included', 'duplicate',
    ])
    expect(result.qualityReport.exclusionReasons).toEqual({
      rating_only: 1,
      empty_text: 1,
      too_short: 1,
      duplicate: 1,
      unsupported_language: 0,
      outside_date_range: 1,
      suspected_spam: 1,
      user_excluded: 2,
    })
  })

  it('can include rating-only records when writtenOnly is false and distinguishes empty text', () => {
    const result = preprocessReviews([
      base('rating', { bodyOriginal: '', isRatingOnly: true }),
      base('empty', { bodyOriginal: '', isRatingOnly: false }),
    ], { writtenOnly: false, minTextLength: 0 })
    expect(result.reviews.map(({ reason }) => reason)).toEqual(['included', 'empty_text'])
    expect(result.qualityReport.ratingOnly).toBe(1)
  })

  it('applies entity, rating, language, and inclusive date filters', () => {
    const result = preprocessReviews([
      base('included', { sourceCreatedAt: '2026-06-30T23:59:59Z' }),
      base('wrong-entity', { entityId: 'location-2' }),
      base('wrong-rating', { ratingValue: 2 }),
      base('unknown-language', { language: null }),
      base('too-late', { sourceCreatedAt: '2026-07-01T00:00:00Z' }),
    ], {
      ...config,
      entityIds: ['location-1'],
      ratings: [5],
      languages: ['EN'],
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    })
    expect(result.reviews.map(({ reason }) => reason)).toEqual([
      'included', 'user_excluded', 'user_excluded', 'duplicate', 'outside_date_range',
    ])
  })

  it('detects exact, hash, and near duplicates but keeps different ratings separate', () => {
    const result = preprocessReviews([
      base('canonical', { bodyOriginal: 'The staff were kind and the service was exceptionally fast today.' }),
      base('exact', { bodyOriginal: ' The staff were kind and the service was exceptionally fast today. ' }),
      base('near', { bodyOriginal: 'The staff were kind and the service was exceptionally fast today!' }),
      base('hash-a', { bodyOriginal: 'Entirely different first wording here.', canonicalHash: 'shared' }),
      base('hash-b', { bodyOriginal: 'Entirely different second wording here.', canonicalHash: 'shared' }),
      base('rating', { bodyOriginal: 'The staff were kind and the service was exceptionally fast today.', ratingValue: 4 }),
    ], config)
    expect(result.reviews.map(({ reason }) => reason)).toEqual([
      'included', 'duplicate', 'duplicate', 'included', 'duplicate', 'included',
    ])
    expect(result.reviews[1].duplicateOfReviewId).toBe('canonical')
    expect(result.qualityReport.duplicateGroups).toEqual([
      { canonicalReviewId: 'canonical', duplicateReviewIds: ['exact', 'near'] },
      { canonicalReviewId: 'hash-a', duplicateReviewIds: ['hash-b'] },
    ])
  })

  it('still detects exact text duplicates when provider identifiers produced different hashes', () => {
    const result = preprocessReviews([
      base('first', { bodyOriginal: 'The delivery was late and the fries were cold and soggy.', ratingValue: 2, canonicalHash: 'provider-id-a' }),
      base('second', { bodyOriginal: 'The delivery was late and the fries were cold and soggy.', ratingValue: 2, canonicalHash: 'provider-id-b' }),
    ], config)
    expect(result.reviews.map(({ reason }) => reason)).toEqual(['included', 'duplicate'])
    expect(result.reviews[1].duplicateOfReviewId).toBe('first')
  })

  it('uses conservative deterministic spam heuristics', () => {
    const result = preprocessReviews([
      base('normal', { bodyOriginal: 'Visit our documentation at https://example.com for setup guidance.' }),
      base('promo', { bodyOriginal: 'BUY NOW click here https://a.test https://b.test https://c.test' }),
      base('repeated', { bodyOriginal: 'spam spam spam spam spam spam spam spam' }),
    ], config)
    expect(result.reviews.map(({ reason }) => reason)).toEqual(['included', 'suspected_spam', 'suspected_spam'])
  })

  it('calculates aggregate quality metrics and confidence deterministically', () => {
    const reviews = Array.from({ length: 55 }, (_, index) => base(String(index), {
      bodyOriginal: `Detailed customer feedback ${index} describes a reliably positive and thoughtful service experience.`,
    }))
    const result = preprocessReviews(reviews, config)
    expect(result.qualityReport).toMatchObject({
      found: 55,
      included: 55,
      excluded: 0,
      written: 55,
      ratingOnly: 0,
      duplicateGroupCount: 0,
      confidence: 'moderate',
    })
    expect(result.qualityReport.averageTextLength).toBeGreaterThan(70)
    expect(result.qualityReport.medianTextLength).toBeGreaterThan(70)
    expect(result.qualityReport.languageDistribution).toEqual({ en: 55 })
  })

  it('reports quality metrics for the included evidence set rather than excluded records', () => {
    const result = preprocessReviews([
      base('de', { language: 'de', bodyOriginal: 'Ausfuehrliches deutsches Kundenfeedback beschreibt die Erfahrung.' }),
      base('en', { language: 'en', bodyOriginal: 'Detailed English customer feedback describes the experience.' }),
      base('rating', { language: 'de', bodyOriginal: '', isRatingOnly: true }),
    ], { writtenOnly: false, minTextLength: 10, languages: ['de'] })

    expect(result.reviews.map(({ reason }) => reason)).toEqual(['included', 'user_excluded', 'included'])
    expect(result.qualityReport).toMatchObject({
      found: 3,
      included: 2,
      excluded: 1,
      written: 1,
      ratingOnly: 1,
      languageDistribution: { de: 2 },
    })
    expect(result.qualityReport.averageTextLength).toBe(result.reviews[0].textLength)
    expect(result.qualityReport.medianTextLength).toBe(result.reviews[0].textLength)
  })

  it('reports insufficient confidence for empty datasets and validates config', () => {
    expect(preprocessReviews([], config).qualityReport).toMatchObject({
      found: 0,
      averageTextLength: 0,
      medianTextLength: 0,
      confidence: 'insufficient',
    })
    expect(() => preprocessReviews([], { ...config, minTextLength: -1 })).toThrow(/minTextLength/)
    expect(() => preprocessReviews([], { ...config, duplicateSimilarityThreshold: 2 })).toThrow(/duplicateSimilarityThreshold/)
  })
})
