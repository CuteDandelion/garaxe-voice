import { useCallback, useEffect, useRef, useState } from 'react'
import {
  VoiceMapWorkspace,
  type SynthesizedVoiceMap,
  type VoiceMapConfidence,
  type VoiceMapInsight,
  type VoiceMapMode,
  type VoiceMapSentiment,
  type VoiceMapSignalType,
  type VoiceMapTheme,
} from './VoiceMapWorkspace'
import { getAnalysisCoverage, getCurationProjection, getOverviewBrief, getVoiceMapArtifact, listAnalysisRuns, type AnalysisCoverageItem, type CurationProjection, type OverviewBriefResult, type VoiceMapArtifactResponse } from '../lib/api'
import { CoverageSummary, customerCoverageReason } from './CoverageSummary'

type Props = {
  projectId: string | null
  section?: 'overview' | 'voice-map'
  initialMode?: Exclude<VoiceMapMode, 'overview'>
  refreshKey?: number
  onOpenReview: (reviewId: string) => void
  onOpenCuration: () => void
  onOpenVoiceMap?: (mode: Exclude<VoiceMapMode, 'overview'>) => void
  onRunSummary?: (summary: { confidence: string | null; createdAt: string | null; dateFrom?: string; dateTo?: string }) => void
}

function confidence(value: string): VoiceMapConfidence {
  const normalized = value.toLowerCase()
  return ['high', 'moderate', 'emerging', 'weak', 'insufficient'].includes(normalized) ? normalized as VoiceMapConfidence : 'insufficient'
}

const emptySignalTitles: Record<VoiceMapInsight['type'], string> = {
  primary_pain: 'No primary pain signal identified',
  desired_outcome: 'No desired outcome signal identified',
  main_objection: 'No main objection signal identified',
  emotional_driver: 'No emotional driver signal identified',
  opportunity: 'No opportunity signal identified',
}

export function emptyVoiceMapInsight(type: VoiceMapInsight['type']): VoiceMapInsight {
  return { id: type, type, title: emptySignalTitles[type], narrative: 'No retained feedback was categorized here in this run.', confidence: 'insufficient', reviewCount: 0, supportingThemeIds: [] }
}

function insight(source: { title: string; narrative: string; supportingThemeIds: string[]; evidenceReviewCount: number; confidence: string } | null, type: VoiceMapInsight['type']): VoiceMapInsight {
  return source ? { id: type, type, title: source.title, narrative: source.narrative, confidence: confidence(source.confidence), reviewCount: source.evidenceReviewCount, supportingThemeIds: source.supportingThemeIds }
    : emptyVoiceMapInsight(type)
}

function topBucketBubbles(themes: VoiceMapTheme[]): SynthesizedVoiceMap['phrases'] {
  return themes.filter((theme) => theme.metrics.reviewCount > 0)
    .map((theme) => ({ text: theme.name, count: theme.metrics.reviewCount, themeId: theme.id, themeName: theme.name, category: theme.type }))
}

export function publicSignalType(value: string | null | undefined): VoiceMapSignalType {
  if (['pain', 'pain_point', 'operational_issue', 'operational_failure', 'service_issue', 'primary_pain'].includes(value || '')) return 'pain'
  if (['desired_outcome', 'feature_request', 'purchase_trigger', 'purchase_driver'].includes(value || '')) return 'desired_outcome'
  if (value === 'objection' || value === 'main_objection') return 'objection'
  if (['emotion', 'emotional_trigger', 'emotional_driver', 'praise'].includes(value || '')) return 'emotion'
  return 'other'
}

export function publicSentiment(value: string | null | undefined, evaluation?: string): VoiceMapSentiment {
  if (evaluation === 'praise') return 'positive'
  if (evaluation === 'pain') return 'negative'
  if (value === 'positive' || value === 'negative' || value === 'neutral') return value
  return 'neutral'
}

export function emergingThemesFromCoverage(items: AnalysisCoverageItem[]): VoiceMapTheme[] {
  return items.flatMap((item, index) => {
    const signal = item.disposition === 'emerging'
      ? item.signals.find((candidate) => candidate.interpretedBy === 'analysis_engine')
      : undefined
    if (!signal) return []
    const quoteStart = item.originalText.indexOf(signal.quote)
    const id = `emerging:${item.reviewId}`
    const signalType = publicSignalType(signal.category)
    return [{
      id, rank: index + 1, name: signal.label, topic: signal.topic || signal.label, type: signalType, signalTypes: [signalType],
      sentiment: publicSentiment(signal.sentiment),
      summary: customerCoverageReason(item), confidence: 'emerging' as const, representativeQuote: signal.quote,
      metrics: { reviewCount: 1, signalCount: 1, prevalence: items.length ? 1 / items.length : 0, averageRating: null, trend: null, contradictionRate: 0, rootCauseRatio: 0 },
      topPhrases: [], entityBreakdown: [], languageBreakdown: [],
      evidence: [{ id: `${id}:evidence`, reviewId: item.reviewId, quote: signal.quote, quoteStart, quoteEnd: quoteStart < 0 ? -1 : quoteStart + signal.quote.length, originalText: item.originalText, rating: null, provider: 'Voice Map intelligence', entity: null, language: null, sourceCreatedAt: null, sourceUrl: null, strength: signal.confidence }],
    }]
  })
}

export function categorizeVisibleSignals(signals: SynthesizedVoiceMap['signals'], themes: VoiceMapTheme[]): SynthesizedVoiceMap['signals'] {
  const definitions: Array<[keyof SynthesizedVoiceMap['signals'], string[]]> = [
    ['primaryPain', ['pain']],
    ['desiredOutcome', ['desired_outcome']],
    ['mainObjection', ['objection']],
    ['emotionalDriver', ['emotion']],
  ]
  return Object.fromEntries(definitions.map(([key, kinds]) => {
    const theme = themes.filter((candidate) => candidate.confidence !== 'insufficient' && kinds.includes(candidate.type))
      .sort((left, right) => right.metrics.reviewCount - left.metrics.reviewCount || left.id.localeCompare(right.id))[0]
    return [key, theme ? {
      ...signals[key], title: theme.name,
      narrative: theme.summary,
      confidence: theme.confidence, reviewCount: theme.metrics.reviewCount, supportingThemeIds: [theme.id],
    } : signals[key].reviewCount > 0 ? signals[key] : emptyVoiceMapInsight(signals[key].type)]
  })) as SynthesizedVoiceMap['signals']
}

function emergingBubbles(themes: VoiceMapTheme[]): SynthesizedVoiceMap['phrases'] {
  return themes.map((theme) => ({ text: theme.name, count: 1, themeId: theme.id, themeName: theme.name, category: theme.type, state: 'emerging' }))
}

function evidenceOverlap(left: VoiceMapTheme, right: VoiceMapTheme) {
  const leftReviews = new Set(left.evidence.map((item) => item.reviewId))
  const rightReviews = new Set(right.evidence.map((item) => item.reviewId))
  if (leftReviews.size === 0 || rightReviews.size === 0) return 0
  const shared = [...leftReviews].filter((reviewId) => rightReviews.has(reviewId)).length
  return shared / new Set([...leftReviews, ...rightReviews]).size
}

const representativeStopWords = new Set([
  'about', 'after', 'before', 'because', 'could', 'from', 'have', 'immediately',
  'into', 'player', 'players', 'that', 'their', 'there', 'they', 'this', 'when',
  'with', 'without', 'would',
])

function evidenceTerms(value: string) {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu)
    ?.filter((term) => term.length >= 4 && !representativeStopWords.has(term)) || [])
}

function representativeEvidence(
  theme: VoiceMapArtifactResponse['themes'][number],
  interpretation: VoiceMapArtifactResponse['themes'][number]['validation']['interpretationCandidate'],
) {
  const fallback = theme.evidence.find((item) => item.isRepresentative) || theme.evidence[0]
  if (!interpretation) return fallback
  const interpretationTerms = evidenceTerms([
    interpretation.label, interpretation.aspect, interpretation.rootCause, interpretation.consequence,
  ].filter(Boolean).join(' '))
  const ranked = theme.evidence.map((item) => {
    const sourceTerms = evidenceTerms(`${item.quote} ${item.originalText || ''}`)
    return {
      item,
      score: [...interpretationTerms].filter((term) => sourceTerms.has(term)).length,
    }
  }).sort((left, right) => right.score - left.score
    || Number(right.item.isRepresentative) - Number(left.item.isRepresentative)
    || right.item.strength - left.item.strength
    || left.item.id.localeCompare(right.item.id))
  return ranked[0]?.score > 0 ? ranked[0].item : fallback
}

export function deduplicatePublishedThemes(themes: VoiceMapTheme[]) {
  const retained: VoiceMapTheme[] = []
  for (const theme of [...themes].sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))) {
    const duplicate = retained.some((candidate) =>
      candidate.signalTypes.some((signalType) => theme.signalTypes.includes(signalType))
      && evidenceOverlap(candidate, theme) >= 0.8)
    if (!duplicate) retained.push(theme)
  }
  return retained
}

export function adaptArtifact(data: VoiceMapArtifactResponse) {
  const engine = data.artifact.voiceMap
  const eligibleSourceThemes = data.themes.filter((theme) => {
    const candidate = theme.validation.interpretationCandidate
    return candidate?.publicationAction === 'publish' && candidate.groupingAction !== 'split'
  })
  const interpretedThemes: VoiceMapTheme[] = eligibleSourceThemes.map((theme) => {
    const interpretation = theme.validation.interpretationCandidate
    const representative = representativeEvidence(theme, interpretation)
    const interpretedType = publicSignalType(interpretation?.primarySignalType || interpretation?.signalTypes?.[0] || theme.type)
    const sentence = (prefix: string, value: string | null) => value
      ? `${prefix}: ${value.trim().replace(/[.!?]+$/, '')}.`
      : null
    const interpretedSummary = interpretation
      ? [sentence('Root cause', interpretation.rootCause),
        sentence('Consequence', interpretation.consequence)]
        .filter(Boolean).join(' ')
      : theme.summary
    return {
    id: theme.id,
    rank: theme.rank,
    name: interpretation?.label || theme.name,
    topic: interpretation?.topic || interpretation?.aspect || theme.name,
    type: interpretedType,
    signalTypes: [interpretedType],
    sentiment: publicSentiment(theme.sentiment, interpretation?.evaluation),
    summary: interpretedSummary || theme.summary,
    confidence: confidence(theme.confidence),
    representativeQuote: representative?.quote || null,
    metrics: {
      reviewCount: theme.metrics.independentReviewCount,
      signalCount: theme.metrics.signalCount,
      prevalence: theme.metrics.prevalence,
      averageRating: theme.metrics.averageRating,
      trend: null,
      contradictionRate: theme.metrics.contradictionRatio,
      rootCauseRatio: theme.metrics.rootCauseRatio || 0,
    },
    topPhrases: theme.validation.repeatedPhrases || [],
    entityBreakdown: (theme.metrics.entityBreakdown || []).map(({ value, count }) => ({ label: value, count })),
    languageBreakdown: (theme.metrics.languageBreakdown || []).map(({ value, count }) => ({ label: value, count })),
    evidence: theme.evidence.map((item) => ({
      id: item.id, reviewId: item.reviewId, quote: item.quote,
      quoteStart: typeof item.quoteStart === 'number' && Number.isInteger(item.quoteStart) ? item.quoteStart : 0,
      quoteEnd: typeof item.quoteEnd === 'number' && Number.isInteger(item.quoteEnd) ? item.quoteEnd : item.quote.length,
      originalText: item.originalText || item.quote,
      rating: item.rating, provider: item.provider || 'unknown_source', entity: item.entity,
      language: item.language, sourceCreatedAt: item.sourceCreatedAt, sourceUrl: item.sourceUrl || null, strength: item.strength,
    })),
    }
  })
  const themes = deduplicatePublishedThemes(interpretedThemes)
  const publishedSourceThemes = eligibleSourceThemes.filter((theme) => themes.some((candidate) => candidate.id === theme.id))
  const signals = {
      primaryPain: interpretedSignal(engine.primaryPain, 'primary_pain', 'pain', themes, publishedSourceThemes),
      desiredOutcome: interpretedSignal(engine.desiredOutcome, 'desired_outcome', 'desired_outcome', themes, publishedSourceThemes),
      mainObjection: interpretedSignal(engine.mainObjection, 'main_objection', 'objection', themes, publishedSourceThemes),
      emotionalDriver: interpretedSignal(engine.emotionalDriver, 'emotional_driver', 'emotion', themes, publishedSourceThemes),
  }
  const conclusionSignals = [signals.primaryPain, signals.desiredOutcome].filter((signal) => signal.reviewCount > 0)
  const conclusionReviews = new Set(themes.flatMap((theme) => theme.evidence.map((item) => item.reviewId))).size
  const conclusion = conclusionSignals.length === 0
    ? { title: 'No categorized feedback available', narrative: 'This run contains no supported feedback topic to summarize.' }
    : {
        title: conclusionSignals.length > 1
          ? `${conclusionSignals[0].title} shapes the need for ${conclusionSignals[1].title}.`
          : conclusionSignals[0].title,
        narrative: `This brief uses exact evidence from ${conclusionReviews} independent review${conclusionReviews === 1 ? '' : 's'} in this saved run.`,
      }
  const moveDefinitions: Array<{
    owner: SynthesizedVoiceMap['recommendedMoves'][number]['owner']
    verb: string
    signal: VoiceMapInsight
  }> = [
    { owner: 'Operations', verb: 'Address', signal: signals.primaryPain },
    { owner: 'Messaging', verb: 'Lead with', signal: signals.desiredOutcome },
    { owner: 'Sales', verb: 'Resolve', signal: signals.mainObjection },
  ]
  const voiceMap: SynthesizedVoiceMap = {
    conclusion,
    signals,
    phrases: topBucketBubbles(themes),
    recommendedMoves: moveDefinitions.flatMap(({ owner, verb, signal }, index) => signal.reviewCount > 0
      ? [{ id: `move-${index + 1}`, owner, action: `${verb} ${signal.title.toLowerCase()} using the linked customer evidence.`, supportingThemeIds: signal.supportingThemeIds }]
      : []),
  }
  return { themes, voiceMap }
}

function interpretedSignal(
  source: Parameters<typeof insight>[0],
  type: VoiceMapInsight['type'],
  signalType: VoiceMapSignalType,
  themes: VoiceMapTheme[],
  sourceThemes: VoiceMapArtifactResponse['themes'],
) {
  const base = insight(source, type)
  const supportedTheme = base.supportingThemeIds
    .map((themeId) => themes.find((theme) => theme.id === themeId))
    .find((theme) => theme?.summary.startsWith('Root cause:'))
  const classifiedTheme = sourceThemes
    .filter((theme) => publicSignalType(theme.validation.interpretationCandidate?.primarySignalType
      || theme.validation.interpretationCandidate?.signalTypes?.[0] || theme.type) === signalType)
    .map((theme) => themes.find((candidate) => candidate.id === theme.id))
    .find((theme): theme is VoiceMapTheme => Boolean(theme))
  const interpretedTheme = supportedTheme || classifiedTheme
  if (!interpretedTheme) {
    const sourceWasDiscarded = source
      ? source.supportingThemeIds.length > 0 && !source.supportingThemeIds.some((themeId) => themes.some((theme) => theme.id === themeId))
      : false
    return sourceWasDiscarded ? insight(null, type) : base
  }
  return {
    ...base,
    title: interpretedTheme.name,
    narrative: interpretedTheme.summary,
    confidence: interpretedTheme.confidence,
    reviewCount: interpretedTheme.metrics.reviewCount,
    supportingThemeIds: [interpretedTheme.id],
  }
}

export function applyCuratedProjection(themes: VoiceMapTheme[], projection: CurationProjection, preview = false) {
  if (!projection.readiness.isReady && !preview) return themes
  const source = new Map(themes.map((theme) => [theme.id, theme]))
  const candidates = projection.readiness.isReady
    ? projection.effectiveThemes.filter((theme) => theme.publishable)
    : projection.effectiveThemes.filter((theme) => !['consumed', 'rejected', 'not_reviewable'].includes(theme.status)
      && (theme.origin === 'user_curated' || source.has(theme.machineThemeId || theme.originThemeIds[0])))
  const projected: VoiceMapTheme[] = candidates.map((theme): VoiceMapTheme => {
    const base = source.get(theme.machineThemeId || theme.originThemeIds[0])
    const evidenceById = new Map(base?.evidence.map((item) => [item.id, item]) || [])
    const evidence = theme.evidence.filter((item) => !item.excluded).map((item) => ({
      ...(evidenceById.get(item.signalId) || { id: item.signalId, reviewId: item.reviewId, quote: item.quote, quoteStart: item.quoteStart, quoteEnd: item.quoteEnd, originalText: item.originalText, rating: item.rating, provider: item.provider, entity: item.entity, language: null, sourceCreatedAt: item.sourceCreatedAt, sourceUrl: null, strength: item.confidence }),
      id: item.signalId, reviewId: item.reviewId, quote: item.quote,
    }))
    const signalType = publicSignalType(theme.primarySignalType || theme.categories?.[0] || theme.type)
    return {
      ...(base || { id: theme.id, rank: theme.rank, type: theme.type, signalTypes: (theme.signalTypes || []) as VoiceMapSignalType[], confidence: confidence(theme.confidence), representativeQuote: null, metrics: { reviewCount: 0, signalCount: 0, prevalence: 0, averageRating: null, trend: null, contradictionRate: 0, rootCauseRatio: 0 }, topPhrases: [], entityBreakdown: [], languageBreakdown: [], evidence: [] }),
      id: theme.id, rank: theme.rank, name: theme.name, topic: theme.topic || theme.name,
      type: signalType, signalTypes: [signalType], sentiment: publicSentiment(theme.sentiment), summary: theme.summary,
      representativeQuote: evidence.find((item) => theme.evidence.find((curated) => curated.signalId === item.id)?.pinned)?.quote || evidence[0]?.quote || null,
      evidence,
      metrics: { ...(base?.metrics || { reviewCount: 0, signalCount: 0, prevalence: 0, averageRating: null, trend: null, contradictionRate: 0, rootCauseRatio: 0 }), reviewCount: new Set(evidence.map((item) => item.reviewId)).size, signalCount: evidence.length },
    }
  })
  if (projection.readiness.isReady) return projected
  const replaced = new Set(candidates.flatMap((theme) => [theme.machineThemeId, ...theme.originThemeIds]).filter(Boolean))
  return [...themes.filter((theme) => !replaced.has(theme.id)), ...projected]
}

function applyCuratedVoiceMap(voiceMap: SynthesizedVoiceMap, projection: CurationProjection): SynthesizedVoiceMap {
  if (!projection.readiness.isReady) return voiceMap
  const publishable = projection.effectiveThemes.filter((theme) => theme.publishable)
  const themeFor = (ids: string[], types: string[]) => publishable.find((theme) => theme.originThemeIds.some((id) => ids.includes(id)) || ids.includes(theme.machineThemeId || '')) || publishable.find((theme) => types.includes(theme.type))
  const projectInsight = (current: SynthesizedVoiceMap['signals']['primaryPain'], types: string[]) => {
    const theme = themeFor(current.supportingThemeIds, types)
    if (!theme) return emptyVoiceMapInsight(current.type)
    return { ...current, title: theme.name, narrative: theme.summary, confidence: confidence(theme.confidence), reviewCount: new Set(theme.evidence.filter((item) => !item.excluded).map((item) => item.reviewId)).size, supportingThemeIds: [theme.id] }
  }
  const signals = {
    primaryPain: projectInsight(voiceMap.signals.primaryPain, ['pain']),
    desiredOutcome: projectInsight(voiceMap.signals.desiredOutcome, ['desired_outcome']),
    mainObjection: projectInsight(voiceMap.signals.mainObjection, ['objection']),
    emotionalDriver: projectInsight(voiceMap.signals.emotionalDriver, ['emotion']),
  }
  const phrases: SynthesizedVoiceMap['phrases'] = publishable.map((theme) => ({
    text: theme.name,
    count: new Set(theme.evidence.filter((item) => !item.excluded).map((item) => item.reviewId)).size,
    themeId: theme.id,
    themeName: theme.name,
    category: publicSignalType(theme.primarySignalType || theme.categories?.[0] || theme.type),
    state: theme.origin === 'user_curated' ? 'curated' as const : 'confirmed' as const,
  })).filter((theme) => theme.count > 0)
  const recommendedMoves = voiceMap.recommendedMoves.flatMap((move) => {
    const theme = themeFor(move.supportingThemeIds, [])
    return theme ? [{ ...move, action: `Act on ${theme.name.toLowerCase()} using the approved evidence.`, supportingThemeIds: [theme.id] }] : []
  })
  const approvedReviews = new Set(publishable.flatMap((theme) => theme.evidence.filter((item) => !item.excluded).map((item) => item.reviewId))).size
  return {
    conclusion: { title: `${signals.primaryPain.title} shapes the need for ${signals.desiredOutcome.title}.`, narrative: `This human-approved conclusion is supported by ${approvedReviews} independent reviews in the curated evidence set.` },
    signals, phrases, recommendedMoves,
  }
}

export function VoiceMapWorkspaceContainer({ projectId, section = 'voice-map', initialMode = 'read', refreshKey = 0, onOpenReview, onOpenCuration, onOpenVoiceMap, onRunSummary }: Props) {
  const [mode, setMode] = useState<VoiceMapMode>(initialMode)
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [run, setRun] = useState<VoiceMapArtifactResponse['run'] | null>(null)
  const [voiceMap, setVoiceMap] = useState<SynthesizedVoiceMap | null>(null)
  const [themes, setThemes] = useState<VoiceMapTheme[]>([])
  const [coverage, setCoverage] = useState<AnalysisCoverageItem[]>([])
  const [overviewBrief, setOverviewBrief] = useState<OverviewBriefResult | null>(null)
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadVersion = useRef(0)
  const onRunSummaryRef = useRef(onRunSummary)
  onRunSummaryRef.current = onRunSummary

  const load = useCallback(async () => {
    if (!projectId) return
    const version = ++loadVersion.current
    setStatus('loading'); setError(null)
    try {
      const runs = await listAnalysisRuns(projectId)
      if (version !== loadVersion.current) return
      const latest = runs.find((candidate) => candidate.status === 'completed')
      if (!latest) { onRunSummaryRef.current?.({ confidence: null, createdAt: null }); setStatus('empty'); return }
      setOverviewBrief(null)
      const [artifact, curation, runCoverage] = await Promise.all([getVoiceMapArtifact(latest.id), getCurationProjection(latest.id), getAnalysisCoverage(latest.id)])
      if (version !== loadVersion.current) return
      const adapted = adaptArtifact(artifact)
      const recurringThemeIds = new Set((runCoverage || []).filter((item) => item.disposition === 'recurring').flatMap((item) => item.themeIds))
      const curatedIds = new Set(curation.effectiveThemes.filter((theme) => theme.origin === 'user_curated').map((theme) => theme.id))
      const projectedThemes = applyCuratedProjection(adapted.themes, curation, true)
      const confirmedThemes = projectedThemes
        .filter((theme) => recurringThemeIds.has(theme.id) || curatedIds.has(theme.id))
      const emergingThemes = emergingThemesFromCoverage(runCoverage || [])
      const curatedVoiceMap = applyCuratedVoiceMap(adapted.voiceMap, curation)
      const visibleThemes = section === 'overview' ? projectedThemes : [...confirmedThemes, ...emergingThemes]
      const categorizedSignals = categorizeVisibleSignals(curatedVoiceMap.signals, visibleThemes.filter((theme) => !curatedIds.has(theme.id)))
      const hasConfirmedSignal = Object.values(curatedVoiceMap.signals).some((signal) => signal.reviewCount > 0)
      const categorizedReviews = new Set(visibleThemes.flatMap((theme) => theme.evidence.map((item) => item.reviewId))).size
      setRun(artifact.run); setVoiceMap({ ...curatedVoiceMap,
        conclusion: !hasConfirmedSignal && categorizedReviews > 0 ? { title: 'Actionable signals are emerging from retained feedback.', narrative: `${categorizedReviews} comments have grounded category homes below. Recurrence and executive conclusions remain unconfirmed.` } : curatedVoiceMap.conclusion,
        signals: categorizedSignals,
        phrases: [...curatedVoiceMap.phrases.filter((phrase) => !curatedIds.has(phrase.themeId)), ...confirmedThemes.filter((theme) => curatedIds.has(theme.id)).map((theme) => ({ text: theme.name, count: theme.metrics.reviewCount, themeId: theme.id, themeName: theme.name, category: theme.type, state: 'curated' as const })), ...emergingBubbles(emergingThemes)],
      }); setThemes(visibleThemes); setCoverage(runCoverage || [])
      onRunSummaryRef.current?.({ confidence: confidence(artifact.run.qualityReport?.confidence || 'Insufficient'), createdAt: artifact.run.createdAt, dateFrom: artifact.run.configuration.dateFrom, dateTo: artifact.run.configuration.dateTo }); setStatus('ready')
      if (section === 'overview') void getOverviewBrief(latest.id).then((brief) => {
        if (version === loadVersion.current) setOverviewBrief(brief)
      }).catch(() => undefined)
    } catch (reason) {
      if (version !== loadVersion.current) return
      setError(reason instanceof Error ? reason.message : 'Voice Map unavailable.'); setStatus('error')
    }
  }, [projectId, refreshKey, section])

  useEffect(() => { void load(); return () => { loadVersion.current += 1 } }, [load])
  useEffect(() => { if (section === 'voice-map') setMode(initialMode) }, [initialMode, section])

  return <><VoiceMapWorkspace
    section={section} mode={section === 'overview' ? 'overview' : mode} status={status}
    run={run ? { id: run.id, createdAt: run.createdAt, reviewCount: Number(run.counts?.included || 0), themeCount: themes.length, confidence: confidence(run.qualityReport?.confidence || 'Insufficient'), pipelineVersion: run.pipelineVersion } : null}
    voiceMap={voiceMap} themes={themes} overviewBrief={overviewBrief} selectedThemeId={selectedThemeId} error={error}
    onModeChange={setMode} onThemeSelect={setSelectedThemeId} onThemeClose={() => setSelectedThemeId(null)} onOpenReview={onOpenReview} onOpenCuration={onOpenCuration} onOpenVoiceMap={onOpenVoiceMap}
  />{section === 'voice-map' && status === 'ready' ? <CoverageSummary items={coverage} onThemeSelect={setSelectedThemeId} /> : null}</>
}
