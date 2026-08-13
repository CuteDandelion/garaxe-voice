import { describe, expect, it } from 'vitest'
import { adaptArtifact, applyCuratedProjection, categorizeVisibleSignals, emergingThemesFromCoverage } from './VoiceMapWorkspaceContainer'
import type { VoiceMapTheme } from './VoiceMapWorkspace'
import type { CurationProjection } from '../lib/api'
import { themeMatchesSignalKind } from './SignalWorkspaceContainer'

describe('Voice Map interpretation candidates', () => {
  it('fills all four actionable signal homes from grounded individual categories without claiming recurrence', () => {
    const kinds = [
      ['pain', 'Payment failed', 4], ['desired_outcome', 'Clear next step', 3], ['objection', 'Unsure it will fit', 2], ['emotion', 'Fear of losing work', 1],
    ] as const
    const themes = kinds.map(([signalType, name, reviewCount], index) => ({
      id: `theme-${index}`, rank: index + 1, name, type: signalType, signalTypes: [signalType], summary: `${name} is grounded in one comment.`, confidence: 'emerging' as const,
      representativeQuote: name, metrics: { reviewCount, signalCount: reviewCount, prevalence: .25, averageRating: null, trend: null, contradictionRate: 0 }, topPhrases: [], entityBreakdown: [], languageBreakdown: [],
      evidence: [{ id: `e-${index}`, reviewId: `r-${index}`, quote: name, quoteStart: 0, quoteEnd: name.length, originalText: name, rating: null, provider: 'Voice Map intelligence', entity: null, language: null, sourceCreatedAt: null, sourceUrl: null, strength: .5 }],
    }))
    const empty = (type: 'primary_pain' | 'desired_outcome' | 'main_objection' | 'emotional_driver') => ({ id: type, type, title: 'Insufficient validated evidence', narrative: '', confidence: 'insufficient' as const, reviewCount: 0, supportingThemeIds: [] })
    const result = categorizeVisibleSignals({ primaryPain: { ...empty('primary_pain'), title: 'Arbitrary placeholder', reviewCount: 99 }, desiredOutcome: empty('desired_outcome'), mainObjection: empty('main_objection'), emotionalDriver: empty('emotional_driver') }, themes)
    expect(Object.values(result).map((signal) => signal.title)).toEqual(kinds.map(([, name]) => name))
    expect(Object.values(result).map((signal) => signal.reviewCount)).toEqual([4, 3, 2, 1])
    expect(Object.values(result).map((signal) => signal.supportingThemeIds[0])).toEqual(themes.map((theme) => theme.id))
    expect(Object.values(result).every((signal) => signal.confidence === 'emerging')).toBe(true)
  })

  it('selects top evidence within each category by count and stable bucket id', () => {
    const theme = (id: string, signalType: 'pain' | 'desired_outcome', name: string, reviewCount: number): VoiceMapTheme => ({
      id, rank: 1, name, type: signalType, signalTypes: [signalType], summary: `${reviewCount} exact supporting comments.`, confidence: 'emerging',
      representativeQuote: name, metrics: { reviewCount, signalCount: reviewCount, prevalence: .25, averageRating: null, trend: null, contradictionRate: 0 },
      topPhrases: [], entityBreakdown: [], languageBreakdown: [], evidence: [],
    })
    const empty = (type: 'primary_pain' | 'desired_outcome' | 'main_objection' | 'emotional_driver') => ({ id: type, type, title: '', narrative: '', confidence: 'insufficient' as const, reviewCount: 0, supportingThemeIds: [] })
    const result = categorizeVisibleSignals({ primaryPain: empty('primary_pain'), desiredOutcome: empty('desired_outcome'), mainObjection: empty('main_objection'), emotionalDriver: empty('emotional_driver') }, [
      theme('pain-low', 'pain', 'Lower pain', 3), theme('pain-top-z', 'pain', 'Later tie', 8), theme('pain-top-a', 'pain', 'Stable top pain', 8),
      theme('outcome-low', 'desired_outcome', 'Lower outcome', 2), theme('outcome-top', 'desired_outcome', 'Top outcome', 5),
    ])
    expect(result.primaryPain).toMatchObject({ title: 'Stable top pain', reviewCount: 8, supportingThemeIds: ['pain-top-a'] })
    expect(result.desiredOutcome).toMatchObject({ title: 'Top outcome', reviewCount: 5, supportingThemeIds: ['outcome-top'] })
  })

  it('does not reuse a pain or withheld multi-label bucket as a desired outcome', () => {
    const empty = (type: 'primary_pain' | 'desired_outcome' | 'main_objection' | 'emotional_driver') => ({ id: type, type, title: 'Insufficient validated evidence', narrative: '', confidence: 'insufficient' as const, reviewCount: 0, supportingThemeIds: [] })
    const themes: VoiceMapTheme[] = [{
      id: 'feature-request', rank: 1, name: 'Unrelated UI feature requests', type: 'pain' as const,
      signalTypes: ['pain', 'desired_outcome'], summary: 'Several unrelated interface requests require review.', confidence: 'emerging' as const,
      representativeQuote: 'Please add a compact activity bar.', metrics: { reviewCount: 4, signalCount: 4, prevalence: 1, averageRating: null, trend: null, contradictionRate: 0 },
      topPhrases: [], entityBreakdown: [], languageBreakdown: [], evidence: [],
    }, {
      id: 'withheld-outcome', rank: 2, name: 'Mixed desired outcomes', type: 'desired_outcome' as const,
      signalTypes: ['desired_outcome'], summary: 'Unresolved mixed evidence.', confidence: 'insufficient' as const,
      representativeQuote: 'I want fewer steps.', metrics: { reviewCount: 3, signalCount: 3, prevalence: 1, averageRating: null, trend: null, contradictionRate: 0 },
      topPhrases: [], entityBreakdown: [], languageBreakdown: [], evidence: [],
    }]

    const result = categorizeVisibleSignals({ primaryPain: empty('primary_pain'), desiredOutcome: empty('desired_outcome'), mainObjection: empty('main_objection'), emotionalDriver: empty('emotional_driver') }, themes)

    expect(result.primaryPain.title).toBe('Unrelated UI feature requests')
    expect(result.desiredOutcome.title).toBe('No desired outcome signal identified')
  })

  it('turns every engine-interpreted individual comment into one exact emerging bubble theme', () => {
    const themes = emergingThemesFromCoverage([{
      reviewId: 'review-emerging', originalText: 'The account choice was confusing.', disposition: 'emerging',
      reason: 'Not enough similar feedback yet.', themeIds: [],
      signals: [{ label: 'Confusing account choice', topic: 'account migration proof', signalType: 'objection', signalTypes: ['objection'], category: 'objection', categories: ['objection'], sentiment: 'neutral', confidence: .35, quote: 'account choice was confusing', interpretedBy: 'analysis_engine' }],
    }])

    expect(themes).toHaveLength(1)
    expect(themes[0]).toMatchObject({ name: 'Confusing account choice', topic: 'account migration proof', type: 'objection', confidence: 'emerging', metrics: { reviewCount: 1 } })
    expect(themes[0].evidence).toEqual([expect.objectContaining({ reviewId: 'review-emerging', quote: 'account choice was confusing', originalText: 'The account choice was confusing.' })])
  })

  it('renders a grounded other signal without inventing a public top-level type', () => {
    const [theme] = emergingThemesFromCoverage([{
      reviewId: 'review-other', originalText: 'The policy wording mentions regional handling.', disposition: 'emerging',
      reason: 'Engine-categorized individual signal; recurrence is not yet confirmed.', themeIds: [],
      signals: [{ label: 'Regional policy wording', topic: 'regional policy wording', signalType: 'other', signalTypes: ['other'], category: 'other', categories: ['other'], sentiment: 'neutral', confidence: .35, quote: 'policy wording mentions regional handling', interpretedBy: 'analysis_engine' }],
    }])
    expect(theme).toMatchObject({ name: 'Regional policy wording', topic: 'regional policy wording', type: 'other', signalTypes: ['other'], confidence: 'emerging' })
    expect(theme.evidence[0]).toMatchObject({ quote: 'policy wording mentions regional handling', quoteStart: 4 })
  })

  it('projects only taxonomy-v2 categories while keeping sentiment orthogonal', () => {
    const categories = [
      ['pain', 'negative'],
      ['desired_outcome', 'positive'],
      ['objection', 'neutral'],
      ['emotion', 'positive'],
      ['other', 'neutral'],
    ] as const
    const themes = emergingThemesFromCoverage(categories.map(([category, sentiment], index) => ({
      reviewId: `review-${index}`, originalText: `Exact evidence ${index}.`, disposition: 'emerging' as const,
      reason: 'Engine-categorized individual signal.', themeIds: [],
      signals: [{ label: `Signal ${index}`, topic: `Topic ${index}`, signalType: category,
        signalTypes: [category], category, categories: [category], sentiment, confidence: .4,
        quote: `Exact evidence ${index}`, interpretedBy: 'analysis_engine' as const }],
    })))

    expect(themes.map(({ type, sentiment, topic }) => ({ type, sentiment, topic }))).toEqual([
      { type: 'pain', sentiment: 'negative', topic: 'Topic 0' },
      { type: 'desired_outcome', sentiment: 'positive', topic: 'Topic 1' },
      { type: 'objection', sentiment: 'neutral', topic: 'Topic 2' },
      { type: 'emotion', sentiment: 'positive', topic: 'Topic 3' },
      { type: 'other', sentiment: 'neutral', topic: 'Topic 4' },
    ])
  })

  it('never fabricates source offsets when a retained quote is not exact', () => {
    const [theme] = emergingThemesFromCoverage([{
      reviewId: 'review-invalid-offset', originalText: 'The account choice was confusing.', disposition: 'emerging', reason: 'Emerging.', themeIds: [],
      signals: [{ label: 'Different quote', signalType: 'pain', category: 'pain', sentiment: 'negative', confidence: .3, quote: 'not in source', interpretedBy: 'analysis_engine' }],
    }])
    expect(theme.evidence[0]).toMatchObject({ quoteStart: -1, quoteEnd: -1 })
  })

  it('previews temporary curated buckets with exact source context before report readiness', () => {
    const projection = {
      readiness: { isReady: false }, machineThemes: [], actions: [], session: null,
      effectiveThemes: [{
        id: 'curated-1', machineThemeId: null, originThemeIds: [], rank: 1, name: 'Dismissed error recovery', summary: 'A user-curated temporary grouping.',
        type: 'pain_point', signalTypes: ['pain'], categories: ['primary_pain'], sentiment: 'negative', confidence: 'Emerging', validationStatus: 'validated', status: 'pending',
        evidence: [{ signalId: 'signal-1', reviewId: 'review-1', quote: 'error disappeared', quoteStart: 4, quoteEnd: 21, originalText: 'The error disappeared before I could read it.', entity: null, provider: 'upload', rating: null, sourceCreatedAt: null, confidence: .4, pinned: false, excluded: false }],
        groupingSuggestion: null, publishable: false, origin: 'user_curated', provenance: { createdBy: 'user-1', createdAt: '2026-08-11T00:00:00Z', sourceReviewIds: ['review-1'] },
      }],
    } as unknown as CurationProjection

    const result = applyCuratedProjection([], projection, true)
    expect(result).toEqual([expect.objectContaining({ id: 'curated-1', name: 'Dismissed error recovery', evidence: [expect.objectContaining({ originalText: 'The error disappeared before I could read it.' })] })])
  })

  it('replaces stale artifact category and topic with the canonical Curation projection', () => {
    const base = [{
      id: 'machine-1', rank: 1, name: 'Old pain label', topic: 'old pain topic', type: 'pain', signalTypes: ['pain'], summary: 'Old summary', confidence: 'emerging', representativeQuote: 'need proof',
      metrics: { reviewCount: 1, signalCount: 1, prevalence: 1, averageRating: null, trend: null, contradictionRate: 0 },
      topPhrases: [], entityBreakdown: [], languageBreakdown: [], evidence: [],
    }] as VoiceMapTheme[]
    const projection = {
      readiness: { isReady: false }, machineThemes: [], actions: [], session: null,
      effectiveThemes: [{
        id: 'machine-1', machineThemeId: 'machine-1', originThemeIds: ['machine-1'], rank: 1,
        name: 'Migration proof barrier', topic: 'migration proof', summary: 'Canonical summary', type: 'objection',
        signalTypes: ['pain', 'objection'], categories: ['main_objection'], sentiment: 'mixed', confidence: 'Emerging',
        validationStatus: 'validated', status: 'pending', evidence: [], groupingSuggestion: null, publishable: false,
        origin: 'model_confirmed', provenance: { createdBy: null, createdAt: null, sourceReviewIds: [] },
      }],
    } as unknown as CurationProjection

    expect(applyCuratedProjection(base, projection, true)[0]).toMatchObject({
      name: 'Migration proof barrier', topic: 'migration proof', type: 'objection', signalTypes: ['objection'],
    })
  })

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
      name: 'Failed delivery handoff', type: 'pain', signalTypes: ['pain'], sentiment: 'negative',
      summary: 'Root cause: Nobody answered the phone. Consequence: The order was left outside and leaked.',
      evidence: [{ originalText: 'Nobody answered the phone, so the curry was left outside.' }],
    })
    expect(adapted.voiceMap.phrases[0]).toMatchObject({ text: 'Failed delivery handoff', category: 'pain' })
    expect(adapted.voiceMap.signals.primaryPain).toMatchObject({
      title: 'Failed delivery handoff',
      narrative: 'Root cause: Nobody answered the phone. Consequence: The order was left outside and leaked.',
    })
    expect(adapted.voiceMap.signals.mainObjection).toMatchObject({ title: 'No main objection signal identified', reviewCount: 0 })
    expect(adapted.voiceMap.signals.emotionalDriver).toMatchObject({ title: 'No emotional driver signal identified', reviewCount: 0 })
    expect(themeMatchesSignalKind(adapted.themes[0], 'pain')).toBe(true)
    expect(themeMatchesSignalKind(adapted.themes[0], 'objection')).toBe(false)
    expect(themeMatchesSignalKind(adapted.themes[0], 'emotion')).toBe(false)
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
    expect(adapted.voiceMap.signals.primaryPain).toMatchObject({ title: 'No primary pain signal identified', reviewCount: 0 })
    expect(adapted.voiceMap.conclusion.title).toBe('No categorized feedback available')
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
