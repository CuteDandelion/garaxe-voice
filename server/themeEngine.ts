import type { ExtractedSignal, SignalType } from './signalExtraction'

export const THEME_ENGINE_VERSION = 'deterministic-theme-engine-v1'

export type ConfidenceLabel = 'High' | 'Moderate' | 'Emerging' | 'Weak' | 'Insufficient'

export type ThemeEngineReview = {
  reviewId?: string
  id?: string
  rating?: number | null
  ratingValue?: number | null
  language?: string | null
  entity?: string | null
  entityName?: string | null
  sourceCreatedAt?: string | Date | null
  canonicalHash?: string | null
  duplicateOfReviewId?: string | null
}

export type ThemeFormationOptions = {
  minimumIndependentEvidence?: number
  maximumRepresentativeQuotes?: number
  maximumRepeatedPhrases?: number
}

export type CountBreakdown = { value: string; count: number }

export type ThemeEvidenceQuote = {
  signalId: string
  reviewId: string
  quoteText: string
  quoteStart: number
  quoteEnd: number
  confidence: number
}

export type Theme = {
  id: string
  rank: number
  signalType: SignalType
  normalizedAspect: string
  name: string
  summary: string
  validationStatus: 'validated' | 'insufficient_evidence'
  evidence: {
    signalIds: string[]
    reviewIds: string[]
    independentReviewIds: string[]
    representativeQuotes: ThemeEvidenceQuote[]
  }
  repeatedPhrases: Array<{ text: string; count: number }>
  metrics: {
    signalCount: number
    independentReviewCount: number
    prevalence: number
    averageRating: number | null
    averageSignalConfidence: number
    contradictionCount: number
    contradictionRatio: number
    sentimentBreakdown: CountBreakdown[]
    ratingBreakdown: CountBreakdown[]
    entityBreakdown: CountBreakdown[]
    languageBreakdown: CountBreakdown[]
    timeBreakdown: CountBreakdown[]
    confidenceScore: number
    confidenceLabel: ConfidenceLabel
    rootCauseRatio: number
    semanticMeanSimilarity?: number
    semanticMinimumMemberSimilarity?: number
    semanticAmbiguousMemberCount?: number
    semanticNeedsAdjudication?: boolean
  }
}

export type VoiceMapInsight = {
  title: string
  narrative: string
  supportingThemeIds: string[]
  evidenceReviewCount: number
  confidence: ConfidenceLabel
}

export type VoiceMapJourneyStage = {
  stage: 'Pain' | 'Doubt' | 'Trigger' | 'Experience' | 'Outcome'
  label: string
  supportingThemeIds: string[]
  evidenceReviewCount: number
}

export type VoiceMapMove = {
  function: 'Messaging' | 'Operations' | 'Sales' | 'Product'
  recommendation: string
  supportingThemeIds: string[]
  evidenceReviewCount: number
}

export type VoiceMap = {
  engineVersion: typeof THEME_ENGINE_VERSION
  executiveConclusion: VoiceMapInsight
  primaryPain: VoiceMapInsight | null
  desiredOutcome: VoiceMapInsight | null
  mainObjection: VoiceMapInsight | null
  emotionalDriver: VoiceMapInsight | null
  journeyStages: VoiceMapJourneyStage[]
  customerPhrases: ThemeEvidenceQuote[]
  recommendedMoves: VoiceMapMove[]
}

type ReviewIndexEntry = {
  id: string
  independenceKey: string
  rating: number | null
  language: string
  entity: string
  month: string
}

const painTypes = new Set<SignalType>(['pain_point', 'service_issue'])
const positiveTypes = new Set<SignalType>(['praise'])

function normalizeKey(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase('en-US'))
}

function reviewId(review: ThemeEngineReview) {
  const id = review.reviewId ?? review.id
  if (!id) throw new Error('Each review must have a reviewId or id')
  return id
}

function monthOf(value: string | Date | null | undefined) {
  if (!value) return 'Unknown'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Unknown' : date.toISOString().slice(0, 7)
}

function indexReviews(reviews: readonly ThemeEngineReview[]) {
  const base = new Map<string, ThemeEngineReview>()
  for (const review of reviews) base.set(reviewId(review), review)

  const resolveRoot = (id: string) => {
    const visited = new Set<string>()
    let current = id
    while (!visited.has(current)) {
      visited.add(current)
      const parent = base.get(current)?.duplicateOfReviewId
      if (!parent || !base.has(parent)) break
      current = parent
    }
    return current
  }

  const result = new Map<string, ReviewIndexEntry>()
  for (const review of reviews) {
    const id = reviewId(review)
    const rootId = resolveRoot(id)
    const rating = review.rating ?? review.ratingValue ?? null
    result.set(id, {
      id,
      independenceKey: base.get(rootId)?.canonicalHash || review.canonicalHash || rootId,
      rating: typeof rating === 'number' && Number.isFinite(rating) ? rating : null,
      language: review.language?.trim().toLocaleLowerCase('en-US') || 'Unknown',
      entity: review.entity?.trim() || review.entityName?.trim() || 'Unknown',
      month: monthOf(review.sourceCreatedAt),
    })
  }
  return result
}

function sortedBreakdown(values: readonly string[]): CountBreakdown[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value))
}

function confidenceLabel(score: number, evidence: number, minimum: number): ConfidenceLabel {
  if (evidence < minimum) return 'Insufficient'
  if (evidence >= 10 && score >= 0.8) return 'High'
  if (evidence >= 5 && score >= 0.65) return 'Moderate'
  if (score >= 0.5) return 'Emerging'
  return 'Weak'
}

function uniqueIndependentSignals(signals: readonly ExtractedSignal[], reviews: Map<string, ReviewIndexEntry>) {
  const byIndependence = new Map<string, ExtractedSignal>()
  for (const signal of signals) {
    const key = reviews.get(signal.reviewId)?.independenceKey ?? signal.reviewId
    const incumbent = byIndependence.get(key)
    if (!incumbent || signal.confidence > incumbent.confidence ||
      (signal.confidence === incumbent.confidence && signal.id.localeCompare(incumbent.id) < 0)) {
      byIndependence.set(key, signal)
    }
  }
  return [...byIndependence.values()]
}

function oppositeTypes(type: SignalType) {
  if (painTypes.has(type)) return positiveTypes
  if (positiveTypes.has(type)) return painTypes
  return new Set<SignalType>()
}

function confidenceScore(
  evidence: number,
  averageExtraction: number,
  entityDiversity: number,
  timeDiversity: number,
  contradictionRatio: number,
) {
  const volume = Math.min(1, Math.log2(evidence + 1) / Math.log2(11))
  const diversity = Math.min(1, ((Math.min(entityDiversity, 3) / 3) + (Math.min(timeDiversity, 3) / 3)) / 2)
  return clamp((volume * 0.45) + (averageExtraction * 0.4) + (diversity * 0.15) - (contradictionRatio * 0.3))
}

export function formThemes(
  signals: readonly ExtractedSignal[],
  reviews: readonly ThemeEngineReview[],
  options: ThemeFormationOptions = {},
): Theme[] {
  const minimum = options.minimumIndependentEvidence ?? 3
  const quoteLimit = options.maximumRepresentativeQuotes ?? 3
  const phraseLimit = options.maximumRepeatedPhrases ?? 5
  if (!Number.isInteger(minimum) || minimum < 1) throw new Error('minimumIndependentEvidence must be a positive integer')
  if (!Number.isInteger(quoteLimit) || quoteLimit < 0) throw new Error('maximumRepresentativeQuotes must be a non-negative integer')
  if (!Number.isInteger(phraseLimit) || phraseLimit < 0) throw new Error('maximumRepeatedPhrases must be a non-negative integer')

  const reviewIndex = indexReviews(reviews)
  const universe = new Set([...reviewIndex.values()].map((review) => review.independenceKey)).size
  const groups = new Map<string, ExtractedSignal[]>()
  for (const signal of signals) {
    if (signal.attributes.clusterStatus === 'unclustered') continue
    const aspect = normalizeKey(signal.normalizedAspect)
    if (!aspect || !reviewIndex.has(signal.reviewId)) continue
    const key = `${signal.signalType}\u0000${aspect}`
    const group = groups.get(key) ?? []
    group.push(signal)
    groups.set(key, group)
  }

  const themes = [...groups.entries()].map(([key, groupedSignals]) => {
    const [signalTypeValue, normalizedAspect] = key.split('\u0000') as [SignalType, string]
    const independentSignals = uniqueIndependentSignals(groupedSignals, reviewIndex)
    const opposing = oppositeTypes(signalTypeValue)
    const contradictionSignals = uniqueIndependentSignals(signals.filter((signal) =>
      signal.attributes.clusterStatus !== 'unclustered'
      && reviewIndex.has(signal.reviewId) && normalizeKey(signal.normalizedAspect) === normalizedAspect && opposing.has(signal.signalType)), reviewIndex)
    const evidence = independentSignals.length
    const contradictionCount = contradictionSignals.length
    const contradictionRatio = (evidence + contradictionCount) === 0 ? 0 : contradictionCount / (evidence + contradictionCount)
    const averageSignalConfidence = evidence === 0
      ? 0
      : independentSignals.reduce((total, signal) => total + clamp(signal.confidence), 0) / evidence
    const rootCauseRatio = evidence === 0 ? 0 : independentSignals.filter((signal) => signal.attributes.causeBearing === true).length / evidence
    const semanticDiagnostic = independentSignals.map((signal) => signal.attributes.clusterDiagnostic)
      .find((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value))
    const evidenceReviews = independentSignals.map((signal) => reviewIndex.get(signal.reviewId)!)
    const ratings = evidenceReviews.flatMap((review) => review.rating === null ? [] : [review.rating])
    const phraseCounts = new Map<string, { text: string; count: number }>()
    for (const signal of independentSignals) {
      const phraseKey = normalizeKey(signal.quoteText)
      if (!phraseKey) continue
      const existing = phraseCounts.get(phraseKey)
      phraseCounts.set(phraseKey, { text: existing?.text ?? signal.quoteText.trim(), count: (existing?.count ?? 0) + 1 })
    }
    const repeatedPhrases = [...phraseCounts.values()]
      .filter((phrase) => phrase.count > 1)
      .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
      .slice(0, phraseLimit)
    const quoteCandidates = [...independentSignals]
      .sort((a, b) => b.confidence - a.confidence || b.quoteText.length - a.quoteText.length || a.id.localeCompare(b.id))
      .slice(0, quoteLimit)
      .map(({ id, reviewId: sourceReviewId, quoteText, quoteStart, quoteEnd, confidence }) => ({
        signalId: id, reviewId: sourceReviewId, quoteText, quoteStart, quoteEnd, confidence,
      }))
    const score = confidenceScore(
      evidence,
      averageSignalConfidence,
      new Set(evidenceReviews.map((review) => review.entity)).size,
      new Set(evidenceReviews.map((review) => review.month)).size,
      contradictionRatio,
    )
    const label = confidenceLabel(score, evidence, minimum)
    return {
      id: `theme:${signalTypeValue}:${stableHash(normalizedAspect)}`,
      rank: 0,
      signalType: signalTypeValue,
      normalizedAspect,
      name: titleCase(normalizedAspect),
      summary: `${evidence} independent review${evidence === 1 ? '' : 's'} mention ${normalizedAspect}.`,
      validationStatus: evidence >= minimum ? 'validated' as const : 'insufficient_evidence' as const,
      evidence: {
        signalIds: [...groupedSignals].sort((a, b) => a.id.localeCompare(b.id)).map((signal) => signal.id),
        reviewIds: [...new Set(groupedSignals.map((signal) => signal.reviewId))].sort(),
        independentReviewIds: [...new Set(independentSignals.map((signal) => signal.reviewId))].sort(),
        representativeQuotes: quoteCandidates,
      },
      repeatedPhrases,
      metrics: {
        signalCount: groupedSignals.length,
        independentReviewCount: evidence,
        prevalence: universe === 0 ? 0 : evidence / universe,
        averageRating: ratings.length === 0 ? null : ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length,
        averageSignalConfidence,
        contradictionCount,
        contradictionRatio,
        sentimentBreakdown: sortedBreakdown(independentSignals.map((signal) => signal.sentiment)),
        ratingBreakdown: sortedBreakdown(ratings.map(String)),
        entityBreakdown: sortedBreakdown(evidenceReviews.map((review) => review.entity)),
        languageBreakdown: sortedBreakdown(evidenceReviews.map((review) => review.language)),
        timeBreakdown: sortedBreakdown(evidenceReviews.map((review) => review.month)),
        confidenceScore: score,
        confidenceLabel: label,
        rootCauseRatio,
        ...(semanticDiagnostic ? {
          semanticMeanSimilarity: Number(semanticDiagnostic.meanSimilarity || 0),
          semanticMinimumMemberSimilarity: Number(semanticDiagnostic.minimumMemberSimilarity || 0),
          semanticAmbiguousMemberCount: Number(semanticDiagnostic.ambiguousMemberCount || 0),
          semanticNeedsAdjudication: semanticDiagnostic.needsAdjudication === true,
        } : {}),
      },
    } satisfies Theme
  })

  themes.sort((a, b) =>
    Number(b.validationStatus === 'validated') - Number(a.validationStatus === 'validated') ||
    b.metrics.rootCauseRatio - a.metrics.rootCauseRatio ||
    b.metrics.independentReviewCount - a.metrics.independentReviewCount ||
    b.metrics.confidenceScore - a.metrics.confidenceScore ||
    a.signalType.localeCompare(b.signalType) ||
    a.normalizedAspect.localeCompare(b.normalizedAspect))
  return themes.map((theme, index) => ({ ...theme, rank: index + 1 }))
}

function reviewCount(themes: readonly Theme[]) {
  return new Set(themes.flatMap((theme) => theme.evidence.independentReviewIds)).size
}

function insightFromTheme(theme: Theme, lead: string): VoiceMapInsight {
  return {
    title: theme.name,
    narrative: `${lead} ${theme.summary}`,
    supportingThemeIds: [theme.id],
    evidenceReviewCount: theme.metrics.independentReviewCount,
    confidence: theme.metrics.confidenceLabel,
  }
}

function firstValidated(themes: readonly Theme[], types: readonly SignalType[]) {
  return themes.find((theme) => theme.validationStatus === 'validated' && types.includes(theme.signalType))
}

export function synthesizeVoiceMap(themes: readonly Theme[], reviewUniverse: number | readonly unknown[]): VoiceMap {
  const universe = typeof reviewUniverse === 'number' ? reviewUniverse : reviewUniverse.length
  if (!Number.isFinite(universe) || universe < 0) throw new Error('reviewUniverse must be a non-negative number or array')
  const validated = themes.filter((theme) => theme.validationStatus === 'validated')
  const pain = firstValidated(validated, ['pain_point', 'service_issue'])
  const outcome = firstValidated(validated, ['desired_outcome', 'praise'])
  const objection = firstValidated(validated, ['objection'])
  const emotion = firstValidated(validated, ['emotion', 'purchase_trigger'])
  const executiveThemes = [pain, outcome].filter((theme): theme is Theme => Boolean(theme))
  const executiveConclusion: VoiceMapInsight = executiveThemes.length === 0
    ? {
        title: 'Insufficient evidence for an executive conclusion',
        narrative: `${universe} review${universe === 1 ? '' : 's'} were available, but no theme met the minimum independent-evidence threshold.`,
        supportingThemeIds: [],
        evidenceReviewCount: 0,
        confidence: 'Insufficient',
      }
    : {
        title: pain && outcome ? `${pain.name} shapes the need for ${outcome.name}.` : executiveThemes[0].name,
        narrative: `This conclusion is limited to ${reviewCount(executiveThemes)} reviews supporting the linked validated theme${executiveThemes.length === 1 ? '' : 's'}.`,
        supportingThemeIds: executiveThemes.map((theme) => theme.id),
        evidenceReviewCount: reviewCount(executiveThemes),
        confidence: executiveThemes.every((theme) => theme.metrics.confidenceLabel === 'High') ? 'High' : executiveThemes[0].metrics.confidenceLabel,
      }

  const journeyDefinitions: Array<[VoiceMapJourneyStage['stage'], SignalType[], string]> = [
    ['Pain', ['pain_point', 'service_issue'], 'Customer pain'],
    ['Doubt', ['objection'], 'Customer doubt'],
    ['Trigger', ['purchase_trigger', 'emotion'], 'Reason to act'],
    ['Experience', ['praise', 'product_aspect'], 'Experienced value'],
    ['Outcome', ['desired_outcome'], 'Desired outcome'],
  ]
  const journeyStages = journeyDefinitions.flatMap(([stage, types, prefix]) => {
    const theme = firstValidated(validated, types)
    return theme ? [{
      stage,
      label: `${prefix}: ${theme.name}`,
      supportingThemeIds: [theme.id],
      evidenceReviewCount: theme.metrics.independentReviewCount,
    }] : []
  })

  const customerPhrases = validated
    .flatMap((theme) => theme.evidence.representativeQuotes)
    .sort((a, b) => b.confidence - a.confidence || a.signalId.localeCompare(b.signalId))
    .filter((quote, index, all) => all.findIndex((candidate) => candidate.signalId === quote.signalId) === index)
    .slice(0, 8)

  const moves: Array<{ types: SignalType[]; function: VoiceMapMove['function']; verb: string }> = [
    { types: ['pain_point', 'service_issue'], function: 'Operations', verb: 'Address' },
    { types: ['desired_outcome', 'praise'], function: 'Messaging', verb: 'Lead with' },
    { types: ['objection'], function: 'Sales', verb: 'Resolve' },
    { types: ['feature_request'], function: 'Product', verb: 'Evaluate' },
  ]
  const recommendedMoves = moves.flatMap(({ types, function: owner, verb }) => {
    const theme = firstValidated(validated, types)
    return theme ? [{
      function: owner,
      recommendation: `${verb} ${theme.normalizedAspect}.`,
      supportingThemeIds: [theme.id],
      evidenceReviewCount: theme.metrics.independentReviewCount,
    }] : []
  })

  return {
    engineVersion: THEME_ENGINE_VERSION,
    executiveConclusion,
    primaryPain: pain ? insightFromTheme(pain, 'The strongest validated pain is') : null,
    desiredOutcome: outcome ? insightFromTheme(outcome, 'The strongest validated outcome is') : null,
    mainObjection: objection ? insightFromTheme(objection, 'The strongest validated objection is') : null,
    emotionalDriver: emotion ? insightFromTheme(emotion, 'The strongest validated emotional driver is') : null,
    journeyStages,
    customerPhrases,
    recommendedMoves,
  }
}
