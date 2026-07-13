import { useCallback, useEffect, useRef, useState } from 'react'
import {
  VoiceMapWorkspace,
  type SynthesizedVoiceMap,
  type VoiceMapConfidence,
  type VoiceMapInsight,
  type VoiceMapMode,
  type VoiceMapSignalType,
  type VoiceMapTheme,
} from './VoiceMapWorkspace'
import { getCurationProjection, getVoiceMapArtifact, listAnalysisRuns, type CurationProjection, type VoiceMapArtifactResponse } from '../lib/api'

type Props = {
  projectId: string | null
  refreshKey?: number
  onOpenReview: (reviewId: string) => void
  onRunSummary?: (summary: { confidence: string | null; createdAt: string | null; dateFrom?: string; dateTo?: string }) => void
}

function confidence(value: string): VoiceMapConfidence {
  const normalized = value.toLowerCase()
  return ['high', 'moderate', 'emerging', 'weak', 'insufficient'].includes(normalized) ? normalized as VoiceMapConfidence : 'insufficient'
}

function insight(source: { title: string; narrative: string; supportingThemeIds: string[]; evidenceReviewCount: number; confidence: string } | null, type: VoiceMapInsight['type']): VoiceMapInsight {
  return source ? { id: type, type, title: source.title, narrative: source.narrative, confidence: confidence(source.confidence), reviewCount: source.evidenceReviewCount, supportingThemeIds: source.supportingThemeIds }
    : { id: type, type, title: 'Insufficient validated evidence', narrative: 'No theme met the configured independent-evidence threshold for this signal.', confidence: 'insufficient', reviewCount: 0, supportingThemeIds: [] }
}

function topBucketBubbles(themes: VoiceMapTheme[]): SynthesizedVoiceMap['phrases'] {
  const candidates = themes.filter((theme) => theme.metrics.reviewCount > 0)
  const ranked = (items: VoiceMapTheme[], rootCausesFirst: boolean) => items.sort((left, right) =>
    (rootCausesFirst ? (right.metrics.rootCauseRatio || 0) - (left.metrics.rootCauseRatio || 0) : 0)
    || right.metrics.reviewCount - left.metrics.reviewCount
    || left.name.localeCompare(right.name))
  const positive = ranked(candidates.filter((theme) => theme.type === 'praise'), false).slice(0, 4)
  const problems = ranked(candidates.filter((theme) => theme.type !== 'praise'), true).slice(0, 4)
  const selected = [...problems, ...positive]
  if (selected.length < 8) selected.push(...ranked(candidates.filter((theme) => !selected.includes(theme)), true).slice(0, 8 - selected.length))
  return selected.map((theme) => ({ text: theme.name, count: theme.metrics.reviewCount, themeId: theme.id, themeName: theme.name, category: theme.type }))
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
    const interpretedType = interpretation?.evaluation === 'praise' ? 'praise'
      : interpretation?.evaluation === 'pain' ? 'pain_point' : theme.type
    const sentence = (prefix: string, value: string | null) => value
      ? `${prefix}: ${value.trim().replace(/[.!?]+$/, '')}.`
      : null
    const interpretedSummary = interpretation
      ? [sentence('Root cause', interpretation.rootCause),
        sentence('Consequence', interpretation.consequence)]
        .filter(Boolean).join(' ')
      : theme.summary
    const fallbackSignalType: VoiceMapSignalType = interpretedType === 'praise' ? 'praise'
      : interpretedType === 'desired_outcome' ? 'desired_outcome'
        : interpretedType === 'purchase_driver' ? 'purchase_trigger'
          : interpretedType === 'operational_failure' || interpretedType === 'service_issue' ? 'operational_issue'
            : interpretedType === 'objection' ? 'objection'
              : interpretedType === 'emotion' || interpretedType === 'emotional_trigger' ? 'emotion' : 'pain'
    return {
    id: theme.id,
    rank: theme.rank,
    name: interpretation?.label || theme.name,
    type: interpretedType,
    signalTypes: interpretation?.signalTypes || [fallbackSignalType],
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
    ? { title: 'Insufficient validated evidence', narrative: 'No LLM-interpreted theme passed the publication gate for an executive conclusion.' }
    : {
        title: conclusionSignals.length > 1
          ? `${conclusionSignals[0].title} shapes the need for ${conclusionSignals[1].title}.`
          : conclusionSignals[0].title,
        narrative: `This conclusion is limited to ${conclusionReviews} independent review${conclusionReviews === 1 ? '' : 's'} supporting LLM-interpreted, publication-approved themes.`,
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
  signalType: NonNullable<VoiceMapArtifactResponse['themes'][number]['validation']['interpretationCandidate']>['signalTypes'][number],
  themes: VoiceMapTheme[],
  sourceThemes: VoiceMapArtifactResponse['themes'],
) {
  const base = insight(source, type)
  const supportedTheme = base.supportingThemeIds
    .map((themeId) => themes.find((theme) => theme.id === themeId))
    .find((theme) => theme?.summary.startsWith('Root cause:'))
  const classifiedTheme = sourceThemes
    .filter((theme) => theme.validation.interpretationCandidate?.signalTypes?.includes(signalType))
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

export function applyCuratedProjection(themes: VoiceMapTheme[], projection: CurationProjection) {
  if (!projection.readiness.isReady) return themes
  const source = new Map(themes.map((theme) => [theme.id, theme]))
  return projection.effectiveThemes.filter((theme) => theme.publishable).map((theme) => {
    const base = source.get(theme.machineThemeId || theme.originThemeIds[0])
    const evidenceById = new Map(base?.evidence.map((item) => [item.id, item]) || [])
    const evidence = theme.evidence.filter((item) => !item.excluded).map((item) => ({
      ...(evidenceById.get(item.signalId) || { id: item.signalId, reviewId: item.reviewId, quote: item.quote, quoteStart: item.quoteStart, quoteEnd: item.quoteEnd, originalText: item.quote, rating: null, provider: 'upload', entity: null, language: null, sourceCreatedAt: null, sourceUrl: null, strength: item.confidence }),
      id: item.signalId, reviewId: item.reviewId, quote: item.quote,
    }))
    return {
      ...(base || { id: theme.id, rank: theme.rank, type: theme.type, signalTypes: [], confidence: confidence(theme.confidence), representativeQuote: null, metrics: { reviewCount: 0, signalCount: 0, prevalence: 0, averageRating: null, trend: null, contradictionRate: 0, rootCauseRatio: 0 }, topPhrases: [], entityBreakdown: [], languageBreakdown: [], evidence: [] }),
      id: theme.id, rank: theme.rank, name: theme.name, summary: theme.summary,
      representativeQuote: evidence.find((item) => theme.evidence.find((curated) => curated.signalId === item.id)?.pinned)?.quote || evidence[0]?.quote || null,
      evidence,
      metrics: { ...(base?.metrics || { reviewCount: 0, signalCount: 0, prevalence: 0, averageRating: null, trend: null, contradictionRate: 0, rootCauseRatio: 0 }), reviewCount: new Set(evidence.map((item) => item.reviewId)).size, signalCount: evidence.length },
    }
  })
}

function applyCuratedVoiceMap(voiceMap: SynthesizedVoiceMap, projection: CurationProjection): SynthesizedVoiceMap {
  if (!projection.readiness.isReady) return voiceMap
  const publishable = projection.effectiveThemes.filter((theme) => theme.publishable)
  const themeFor = (ids: string[], types: string[]) => publishable.find((theme) => theme.originThemeIds.some((id) => ids.includes(id)) || ids.includes(theme.machineThemeId || '')) || publishable.find((theme) => types.includes(theme.type))
  const projectInsight = (current: SynthesizedVoiceMap['signals']['primaryPain'], types: string[]) => {
    const theme = themeFor(current.supportingThemeIds, types)
    if (!theme) return { ...current, title: 'Insufficient approved evidence', narrative: 'No human-approved theme supports this signal in the published version.', reviewCount: 0, supportingThemeIds: [] }
    return { ...current, title: theme.name, narrative: theme.summary, confidence: confidence(theme.confidence), reviewCount: new Set(theme.evidence.filter((item) => !item.excluded).map((item) => item.reviewId)).size, supportingThemeIds: [theme.id] }
  }
  const signals = {
    primaryPain: projectInsight(voiceMap.signals.primaryPain, ['pain_point', 'service_issue', 'operational_failure']),
    desiredOutcome: projectInsight(voiceMap.signals.desiredOutcome, ['desired_outcome', 'praise', 'purchase_driver']),
    mainObjection: projectInsight(voiceMap.signals.mainObjection, ['objection']),
    emotionalDriver: projectInsight(voiceMap.signals.emotionalDriver, ['emotion', 'emotional_trigger']),
  }
  const phrases = publishable.map((theme) => ({
    text: theme.name,
    count: new Set(theme.evidence.filter((item) => !item.excluded).map((item) => item.reviewId)).size,
    themeId: theme.id,
    themeName: theme.name,
    category: theme.type,
  })).filter((theme) => theme.count > 0).sort((left, right) => right.count - left.count || left.text.localeCompare(right.text)).slice(0, 8)
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

export function VoiceMapWorkspaceContainer({ projectId, refreshKey = 0, onOpenReview, onRunSummary }: Props) {
  const [mode, setMode] = useState<VoiceMapMode>('read')
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [run, setRun] = useState<VoiceMapArtifactResponse['run'] | null>(null)
  const [voiceMap, setVoiceMap] = useState<SynthesizedVoiceMap | null>(null)
  const [themes, setThemes] = useState<VoiceMapTheme[]>([])
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadVersion = useRef(0)

  const load = useCallback(async () => {
    if (!projectId) return
    const version = ++loadVersion.current
    setStatus('loading'); setError(null)
    try {
      const runs = await listAnalysisRuns(projectId)
      if (version !== loadVersion.current) return
      const latest = runs.find((candidate) => candidate.status === 'completed')
      if (!latest) { onRunSummary?.({ confidence: null, createdAt: null }); setStatus('empty'); return }
      const [artifact, curation] = await Promise.all([getVoiceMapArtifact(latest.id), getCurationProjection(latest.id)])
      if (version !== loadVersion.current) return
      const adapted = adaptArtifact(artifact)
      setRun(artifact.run); setVoiceMap(applyCuratedVoiceMap(adapted.voiceMap, curation)); setThemes(applyCuratedProjection(adapted.themes, curation));
      onRunSummary?.({ confidence: confidence(artifact.run.qualityReport?.confidence || 'Insufficient'), createdAt: artifact.run.createdAt, dateFrom: artifact.run.configuration.dateFrom, dateTo: artifact.run.configuration.dateTo }); setStatus('ready')
    } catch (reason) {
      if (version !== loadVersion.current) return
      setError(reason instanceof Error ? reason.message : 'Voice Map unavailable.'); setStatus('error')
    }
  }, [onRunSummary, projectId, refreshKey])

  useEffect(() => { void load(); return () => { loadVersion.current += 1 } }, [load])

  return <VoiceMapWorkspace
    mode={mode} status={status}
    run={run ? { id: run.id, createdAt: run.createdAt, reviewCount: Number(run.counts?.included || 0), themeCount: themes.length, confidence: confidence(run.qualityReport?.confidence || 'Insufficient'), pipelineVersion: run.pipelineVersion } : null}
    voiceMap={voiceMap} themes={themes} selectedThemeId={selectedThemeId} error={error}
    onModeChange={setMode} onThemeSelect={setSelectedThemeId} onThemeClose={() => setSelectedThemeId(null)} onOpenReview={onOpenReview}
  />
}
