import { describe, expect, it } from 'vitest'
import { adaptArtifact } from './VoiceMapWorkspaceContainer'
import { themeMatchesSignalKind } from './SignalWorkspaceContainer'

describe('Voice Map interpretation candidates', () => {
  it('uses the validated root-cause label and evaluation while retaining exact evidence', () => {
    const engineInsight = { title: 'Current', narrative: 'Current narrative', supportingThemeIds: ['theme-1'], evidenceReviewCount: 1, confidence: 'Moderate' }
    const adapted = adaptArtifact({
      synthesisVersion: 'v1', run: {} as never,
      artifact: { validationThreshold: 1, voiceMap: {
        engineVersion: 'v1', executiveConclusion: engineInsight, primaryPain: engineInsight,
        desiredOutcome: null, mainObjection: null, emotionalDriver: null, journeyStages: [], customerPhrases: [], recommendedMoves: [],
      } },
      themes: [{
        id: 'theme-1', rank: 1, name: 'Bag Leaked Curry Doorstep', summary: 'Old consequence-first summary.',
        type: 'praise', sentiment: 'positive', confidence: 'Moderate',
        metrics: { signalCount: 1, independentReviewCount: 1, prevalence: 1, averageRating: 1,
          contradictionRatio: 0, rootCauseRatio: 1, entityBreakdown: [], languageBreakdown: [] },
        validation: { status: 'validated', repeatedPhrases: [], interpretationCandidate: {
          label: 'Failed delivery handoff', aspect: 'delivery handoff', evaluation: 'pain',
          signalTypes: ['pain', 'objection', 'emotion'],
          rootCause: 'Nobody answered the phone.', consequence: 'The order was left outside and leaked.', confidence: .92,
          publicationAction: 'publish', publicationReason: null,
          provider: 'opencode_go', model: 'test-model', promptVersion: 'root-cause-first-v5', schemaVersion: 'cluster-interpretation-v3',
        } },
        evidence: [{ id: 'signal-1', reviewId: 'review-1', quote: 'Nobody answered the phone', quoteStart: 0, quoteEnd: 25,
          originalText: 'Nobody answered the phone, so the curry was left outside.', rating: 1, provider: 'upload', entity: null,
          language: 'en', sourceCreatedAt: null, strength: .9, isRepresentative: true }],
      }],
    })
    expect(adapted.themes[0]).toMatchObject({
      name: 'Failed delivery handoff', type: 'pain_point', signalTypes: ['pain', 'objection', 'emotion'],
      summary: 'Root cause: Nobody answered the phone. Consequence: The order was left outside and leaked.',
      evidence: [{ originalText: 'Nobody answered the phone, so the curry was left outside.' }],
    })
    expect(adapted.voiceMap.phrases[0]).toMatchObject({ text: 'Failed delivery handoff', category: 'pain_point' })
    expect(adapted.voiceMap.signals.primaryPain).toMatchObject({
      title: 'Failed delivery handoff',
      narrative: 'Root cause: Nobody answered the phone. Consequence: The order was left outside and leaked.',
    })
    expect(adapted.voiceMap.signals.mainObjection).toMatchObject({ title: 'Failed delivery handoff' })
    expect(adapted.voiceMap.signals.emotionalDriver).toMatchObject({ title: 'Failed delivery handoff' })
    expect(themeMatchesSignalKind(adapted.themes[0], 'pain')).toBe(true)
    expect(themeMatchesSignalKind(adapted.themes[0], 'objection')).toBe(true)
    expect(themeMatchesSignalKind(adapted.themes[0], 'emotion')).toBe(true)
    expect(themeMatchesSignalKind(adapted.themes[0], 'outcome')).toBe(false)
  })

  it('removes an LLM-discarded context cluster from publication surfaces', () => {
    const source = {
      synthesisVersion: 'v1', run: {} as never,
      artifact: { validationThreshold: 1, voiceMap: {
        engineVersion: 'v1', executiveConclusion: { title: 'Context', narrative: 'Context only', supportingThemeIds: ['theme-context'], evidenceReviewCount: 2, confidence: 'High' },
        primaryPain: { title: 'Context', narrative: 'Context only', supportingThemeIds: ['theme-context'], evidenceReviewCount: 2, confidence: 'High' },
        desiredOutcome: null, mainObjection: null, emotionalDriver: null, journeyStages: [], customerPhrases: [], recommendedMoves: [],
      } },
      themes: [{
        id: 'theme-context', rank: 1, name: 'Weekly session', summary: 'Repeated context.', type: 'pain_point', sentiment: 'negative', confidence: 'High',
        metrics: { signalCount: 2, independentReviewCount: 2, prevalence: 1, averageRating: 2, contradictionRatio: 0, rootCauseRatio: 0, entityBreakdown: [], languageBreakdown: [] },
        validation: { status: 'validated', repeatedPhrases: [], interpretationCandidate: {
          label: 'Irrelevant session context', aspect: 'session context', evaluation: 'mixed' as const, signalTypes: ['pain' as const], rootCause: null, consequence: null, confidence: .98,
          publicationAction: 'discard' as const, publicationReason: 'Shared boilerplate joins unrelated feedback.', provider: 'opencode_go', model: 'test', promptVersion: 'v9', schemaVersion: 'v5',
        } }, evidence: [],
      }, {
        id: 'theme-uninterpreted', rank: 2, name: 'Returning Three Months', summary: 'Machine-only context.', type: 'praise', sentiment: 'positive', confidence: 'High',
        metrics: { signalCount: 2, independentReviewCount: 2, prevalence: 1, averageRating: 5, contradictionRatio: 0, rootCauseRatio: 0, entityBreakdown: [], languageBreakdown: [] },
        validation: { status: 'validated', repeatedPhrases: [] }, evidence: [],
      }, {
        id: 'theme-split', rank: 3, name: 'Mixed semantic neighborhood', summary: 'Two issues need separation.', type: 'pain_point', sentiment: 'negative', confidence: 'Moderate',
        metrics: { signalCount: 2, independentReviewCount: 2, prevalence: 1, averageRating: 2, contradictionRatio: 0, rootCauseRatio: 1, entityBreakdown: [], languageBreakdown: [] },
        validation: { status: 'validated', repeatedPhrases: [], interpretationCandidate: {
          label: 'Mixed semantic neighborhood', aspect: 'mixed', evaluation: 'pain' as const, signalTypes: ['pain' as const], rootCause: 'Two distinct issues were joined.', consequence: 'The conclusion is not safe to publish.', confidence: .8,
          publicationAction: 'publish' as const, publicationReason: null, groupingAction: 'split' as const, groupingReason: 'Separate the two issues.', provider: 'opencode_go', model: 'test', promptVersion: 'v9', schemaVersion: 'v5',
        } }, evidence: [],
      }],
    }
    const adapted = adaptArtifact(source)
    expect(adapted.themes).toEqual([])
    expect(adapted.voiceMap.phrases).toEqual([])
    expect(adapted.voiceMap.signals.primaryPain).toMatchObject({ title: 'Insufficient validated evidence', reviewCount: 0 })
    expect(adapted.voiceMap.conclusion.title).toBe('Insufficient validated evidence')
  })

  it('deduplicates interpretations backed by the same reviews and signal kind', () => {
    const evidence = [{ id: 'signal-1', reviewId: 'review-1', quote: 'I worried the payment was lost.', quoteStart: 0, quoteEnd: 31,
      originalText: 'I worried the payment was lost.', rating: 2, provider: 'upload', entity: null,
      language: 'en', sourceCreatedAt: null, strength: .9, isRepresentative: true }]
    const candidate = (label: string) => ({
      label, aspect: 'currency delivery', evaluation: 'pain' as const, signalTypes: ['emotion' as const],
      rootCause: 'Purchased currency arrived the next day.', consequence: 'The customer feared the payment was lost.', confidence: .9,
      publicationAction: 'publish' as const, publicationReason: null, provider: 'opencode_go', model: 'test', promptVersion: 'v9', schemaVersion: 'v5',
    })
    const engineInsight = { title: 'Machine theme', narrative: 'Machine summary', supportingThemeIds: ['theme-1'], evidenceReviewCount: 1, confidence: 'Moderate' }
    const adapted = adaptArtifact({
      synthesisVersion: 'v1', run: {} as never,
      artifact: { validationThreshold: 1, voiceMap: { engineVersion: 'v1', executiveConclusion: engineInsight,
        primaryPain: null, desiredOutcome: null, mainObjection: null, emotionalDriver: engineInsight,
        journeyStages: [], customerPhrases: [], recommendedMoves: [] } },
      themes: ['Delayed currency delivery', 'Delayed currency delivery anxiety'].map((name, index) => ({
        id: `theme-${index + 1}`, rank: index + 1, name, summary: 'Machine summary', type: 'pain_point', sentiment: 'negative', confidence: 'Moderate',
        metrics: { signalCount: 1, independentReviewCount: 1, prevalence: 1, averageRating: 2, contradictionRatio: 0, rootCauseRatio: 1, entityBreakdown: [], languageBreakdown: [] },
        validation: { status: 'validated', repeatedPhrases: [], interpretationCandidate: candidate(name) }, evidence,
      })),
    })

    expect(adapted.themes).toHaveLength(1)
    expect(adapted.voiceMap.phrases).toHaveLength(1)
    expect(adapted.voiceMap.signals.emotionalDriver.title).toBe('Delayed currency delivery')
  })

  it('chooses representative evidence that matches the LLM interpretation', () => {
    const engineInsight = { title: 'Machine theme', narrative: 'Machine summary', supportingThemeIds: ['theme-1'], evidenceReviewCount: 2, confidence: 'Moderate' }
    const adapted = adaptArtifact({
      synthesisVersion: 'v1', run: {} as never,
      artifact: { validationThreshold: 1, voiceMap: { engineVersion: 'v1', executiveConclusion: engineInsight,
        primaryPain: engineInsight, desiredOutcome: null, mainObjection: null, emotionalDriver: engineInsight,
        journeyStages: [], customerPhrases: [], recommendedMoves: [] } },
      themes: [{
        id: 'theme-1', rank: 1, name: 'Machine cluster', summary: 'Machine summary', type: 'pain_point', sentiment: 'negative', confidence: 'Moderate',
        metrics: { signalCount: 2, independentReviewCount: 2, prevalence: 1, averageRating: 2, contradictionRatio: 0, rootCauseRatio: 1, entityBreakdown: [], languageBreakdown: [] },
        validation: { status: 'validated', repeatedPhrases: [], interpretationCandidate: {
          label: 'Delayed currency delivery', aspect: 'purchased currency', evaluation: 'pain', signalTypes: ['emotion'],
          rootCause: 'Purchased currency was charged but not credited.', consequence: 'Players worried the payment was lost.', confidence: .9,
          publicationAction: 'publish', publicationReason: null, provider: 'opencode_go', model: 'test', promptVersion: 'v9', schemaVersion: 'v5',
        } },
        evidence: [{ id: 'signal-unrelated', reviewId: 'review-1', quote: 'the form submitted it without warning.', quoteStart: 0, quoteEnd: 38,
          originalText: 'The feedback form submitted without a confirmation warning.', rating: 2, provider: 'upload', entity: null,
          language: 'en', sourceCreatedAt: null, strength: .95, isRepresentative: true },
        { id: 'signal-currency', reviewId: 'review-2', quote: 'but did not appear until the next day.', quoteStart: 0, quoteEnd: 38,
          originalText: 'I purchased credits and the payment was charged, but they did not appear until the next day.', rating: 1, provider: 'upload', entity: null,
          language: 'en', sourceCreatedAt: null, strength: .8, isRepresentative: false }],
      }],
    })

    expect(adapted.themes[0].representativeQuote).toBe('but did not appear until the next day.')
  })
})
