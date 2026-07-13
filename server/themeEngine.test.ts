import { describe, expect, it } from 'vitest'
import type { ExtractedSignal, SignalType } from './signalExtraction'
import { formThemes, synthesizeVoiceMap, type ThemeEngineReview } from './themeEngine'

const review = (reviewId: string, overrides: Partial<ThemeEngineReview> = {}): ThemeEngineReview => ({
  reviewId,
  rating: 2,
  language: 'en',
  entity: 'Berlin Mitte',
  sourceCreatedAt: '2026-06-12T12:00:00Z',
  ...overrides,
})

const signal = (
  reviewId: string,
  signalType: SignalType,
  normalizedAspect: string,
  quoteText = normalizedAspect,
  overrides: Partial<ExtractedSignal> = {},
): ExtractedSignal => ({
  id: `${reviewId}:signal:0`,
  ordinal: 0,
  reviewId,
  signalType,
  label: normalizedAspect,
  normalizedAspect,
  sentiment: signalType === 'praise' || signalType === 'desired_outcome' ? 'positive' : 'negative',
  confidence: 0.9,
  quoteText,
  quoteStart: 0,
  quoteEnd: quoteText.length,
  attributes: {},
  ...overrides,
})

describe('formThemes', () => {
  it('clusters on signal type and normalized aspect while preserving exact evidence', () => {
    const reviews = [review('r1'), review('r2'), review('r3')]
    const signals = [
      signal('r1', 'pain_point', 'waiting time', 'waited almost an hour'),
      signal('r2', 'pain_point', 'Waiting   Time', 'service took ages'),
      signal('r3', 'praise', 'waiting time', 'served immediately'),
    ]
    const themes = formThemes(signals, reviews, { minimumIndependentEvidence: 2 })
    expect(themes).toHaveLength(2)
    expect(themes[0]).toMatchObject({
      signalType: 'pain_point',
      normalizedAspect: 'waiting time',
      validationStatus: 'validated',
      evidence: { signalIds: ['r1:signal:0', 'r2:signal:0'], reviewIds: ['r1', 'r2'] },
      metrics: { independentReviewCount: 2, signalCount: 2 },
    })
    expect(themes[0].evidence.representativeQuotes.map((item) => item.quoteText)).toEqual([
      'waited almost an hour', 'service took ages',
    ])
  })

  it('protects independent counts from duplicate reviews and repeated same-review signals', () => {
    const reviews = [
      review('canonical', { canonicalHash: 'same' }),
      review('duplicate', { duplicateOfReviewId: 'canonical', canonicalHash: 'same' }),
      review('other', { canonicalHash: 'other' }),
    ]
    const signals = [
      signal('canonical', 'pain_point', 'slow service'),
      signal('canonical', 'pain_point', 'slow service', 'took forever', { id: 'canonical:signal:1', ordinal: 1 }),
      signal('duplicate', 'pain_point', 'slow service'),
      signal('other', 'pain_point', 'slow service'),
    ]
    const [theme] = formThemes(signals, reviews, { minimumIndependentEvidence: 3 })
    expect(theme.metrics).toMatchObject({ signalCount: 4, independentReviewCount: 2, prevalence: 1 })
    expect(theme.validationStatus).toBe('insufficient_evidence')
    expect(theme.evidence.signalIds).toHaveLength(4)
  })

  it('measures contradictory praise and pain for the same aspect', () => {
    const reviews = [review('r1'), review('r2'), review('r3'), review('r4')]
    const themes = formThemes([
      signal('r1', 'pain_point', 'service speed'),
      signal('r2', 'pain_point', 'service speed'),
      signal('r3', 'praise', 'service speed'),
      signal('r4', 'praise', 'service speed'),
    ], reviews, { minimumIndependentEvidence: 2 })
    const pain = themes.find((theme) => theme.signalType === 'pain_point')!
    expect(pain.metrics.contradictionCount).toBe(2)
    expect(pain.metrics.contradictionRatio).toBe(0.5)
    expect(pain.metrics.confidenceScore).toBeLessThan(pain.metrics.averageSignalConfidence)
  })

  it('calculates multi-entity, language, rating, and time metrics', () => {
    const reviews = [
      review('r1'),
      review('r2', { entity: 'Hamburg', language: 'de', rating: 4, sourceCreatedAt: '2026-05-01' }),
      review('r3', { entity: 'Hamburg', language: 'de', rating: 4, sourceCreatedAt: '2026-05-14' }),
    ]
    const [theme] = formThemes(reviews.map((item) => signal(item.reviewId!, 'desired_outcome', 'quick service')), reviews)
    expect(theme.metrics).toMatchObject({ averageRating: 10 / 3, prevalence: 1 })
    expect(theme.metrics.entityBreakdown).toEqual([
      { value: 'Hamburg', count: 2 }, { value: 'Berlin Mitte', count: 1 },
    ])
    expect(theme.metrics.languageBreakdown).toEqual([{ value: 'de', count: 2 }, { value: 'en', count: 1 }])
    expect(theme.metrics.ratingBreakdown).toEqual([{ value: '4', count: 2 }, { value: '2', count: 1 }])
    expect(theme.metrics.timeBreakdown).toEqual([{ value: '2026-05', count: 2 }, { value: '2026-06', count: 1 }])
  })

  it('ranks deterministically using validation, evidence, score, type, then aspect', () => {
    const reviews = [review('r1'), review('r2'), review('r3')]
    const signals = [
      ...reviews.map((item) => signal(item.reviewId!, 'pain_point', 'zebra issue')),
      ...reviews.map((item) => signal(item.reviewId!, 'pain_point', 'alpha issue', 'alpha issue', { id: `${item.reviewId}:signal:1` })),
    ]
    const first = formThemes(signals, reviews)
    const second = formThemes([...signals].reverse(), [...reviews].reverse())
    expect(first.map(({ id, rank }) => ({ id, rank }))).toEqual(second.map(({ id, rank }) => ({ id, rank })))
    expect(first.map((theme) => theme.normalizedAspect)).toEqual(['alpha issue', 'zebra issue'])
  })

  it('validates options and treats sparse evidence honestly', () => {
    const themes = formThemes([signal('r1', 'pain_point', 'parking')], [review('r1')])
    expect(themes[0].metrics.confidenceLabel).toBe('Insufficient')
    expect(themes[0].validationStatus).toBe('insufficient_evidence')
    expect(() => formThemes([], [], { minimumIndependentEvidence: 0 })).toThrow(/minimumIndependentEvidence/)
  })
})

describe('synthesizeVoiceMap', () => {
  it('links every generated insight, journey stage, phrase, and move to validated evidence', () => {
    const reviews = Array.from({ length: 4 }, (_, index) => review(`r${index + 1}`))
    const signals = reviews.flatMap((item) => [
      signal(item.reviewId!, 'pain_point', 'setup complexity', 'too much setup'),
      signal(item.reviewId!, 'desired_outcome', 'easy setup', 'just wanted it to work', { id: `${item.reviewId}:signal:1`, ordinal: 1 }),
      signal(item.reviewId!, 'objection', 'niche fit', 'not sure it would work for us', { id: `${item.reviewId}:signal:2`, ordinal: 2 }),
      signal(item.reviewId!, 'emotion', 'relief', 'finally felt relieved', { id: `${item.reviewId}:signal:3`, ordinal: 3 }),
    ])
    const themes = formThemes(signals, reviews)
    const map = synthesizeVoiceMap(themes, reviews)
    const themeIds = new Set(themes.map((theme) => theme.id))
    expect(map.executiveConclusion.supportingThemeIds).toHaveLength(2)
    for (const insight of [map.executiveConclusion, map.primaryPain, map.desiredOutcome, map.mainObjection, map.emotionalDriver]) {
      expect(insight).not.toBeNull()
      expect(insight!.supportingThemeIds.every((id) => themeIds.has(id))).toBe(true)
      expect(insight!.evidenceReviewCount).toBeGreaterThan(0)
    }
    expect(map.journeyStages.every((stage) => stage.supportingThemeIds.every((id) => themeIds.has(id)))).toBe(true)
    expect(map.recommendedMoves.every((move) => move.supportingThemeIds.every((id) => themeIds.has(id)))).toBe(true)
  })

  it('never invents customer phrases', () => {
    const reviews = [review('r1'), review('r2'), review('r3')]
    const signals = reviews.map((item) => signal(item.reviewId!, 'praise', 'friendly staff', `exact quote ${item.reviewId}`))
    const map = synthesizeVoiceMap(formThemes(signals, reviews), reviews)
    const sourceQuotes = new Set(signals.map((item) => item.quoteText))
    expect(map.customerPhrases.length).toBeGreaterThan(0)
    expect(map.customerPhrases.every((phrase) => sourceQuotes.has(phrase.quoteText))).toBe(true)
  })

  it('degrades to explicit insufficient evidence without unsupported content', () => {
    const reviews = [review('r1')]
    const map = synthesizeVoiceMap(formThemes([signal('r1', 'pain_point', 'parking')], reviews), reviews)
    expect(map.executiveConclusion).toMatchObject({
      title: 'Insufficient evidence for an executive conclusion',
      supportingThemeIds: [],
      evidenceReviewCount: 0,
      confidence: 'Insufficient',
    })
    expect(map.primaryPain).toBeNull()
    expect(map.customerPhrases).toEqual([])
    expect(map.recommendedMoves).toEqual([])
  })
})
