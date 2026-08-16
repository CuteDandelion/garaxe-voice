export const SIGNAL_TAXONOMY_VERSION = 'voice-signal-taxonomy-v2'
export const CANONICAL_SIGNAL_TYPES = [
  'pain', 'desired_outcome', 'objection', 'emotion', 'other',
] as const
export type CanonicalSignalType = typeof CANONICAL_SIGNAL_TYPES[number]
export const CANONICAL_CATEGORIES = [
  'pain', 'desired_outcome', 'objection', 'emotion', 'other',
] as const
export type CanonicalCategory = typeof CANONICAL_CATEGORIES[number]
export type CanonicalSentiment = 'positive' | 'neutral' | 'negative'

export type CanonicalOutcome = {
  label: string
  topic: string
  primaryCategory: CanonicalCategory
  signalTaxonomyVersion: string
  primarySignalType: CanonicalSignalType
  proposedTypeLabel: string | null
  signalTypes: string[]
  sentiment: CanonicalSentiment
  confidence: number
  evidence: { reviewId: string; quoteText: string; quoteStart?: number; quoteEnd?: number }
}

const categories = new Set<CanonicalCategory>(CANONICAL_CATEGORIES)
const sentiments = new Set<CanonicalSentiment>(['positive', 'neutral', 'negative'])

const legacySignalType = (value: unknown): CanonicalSignalType => {
  if (value === 'operational_issue') return 'pain'
  if (value === 'feature_request' || value === 'purchase_trigger' || value === 'praise') return 'desired_outcome'
  return CANONICAL_SIGNAL_TYPES.includes(value as CanonicalSignalType) ? value as CanonicalSignalType : 'other'
}

const categoryForSignalType = (value: CanonicalSignalType): CanonicalCategory => value

const legacySentiment = (item: Record<string, unknown>): CanonicalSentiment => item.primarySignalType === 'praise'
  ? 'positive' : item.primarySignalType === 'pain' || item.primarySignalType === 'operational_issue' ? 'negative' : 'neutral'

export function canonicalOutcome(value: unknown): CanonicalOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const evidence = item.evidence
  const taxonomyVersion = typeof (item.signalTaxonomyVersion ?? item.categoryTaxonomyVersion) === 'string'
    ? String(item.signalTaxonomyVersion ?? item.categoryTaxonomyVersion) : 'legacy-unversioned'
  const versionTwo = taxonomyVersion === SIGNAL_TAXONOMY_VERSION
  const primarySignalType = versionTwo
    ? (CANONICAL_SIGNAL_TYPES.includes(item.primarySignalType as CanonicalSignalType) ? item.primarySignalType as CanonicalSignalType : null)
    : legacySignalType(item.primarySignalType ?? (Array.isArray(item.signalTypes) ? item.signalTypes[0] : null))
  const primaryCategory = versionTwo ? item.primaryCategory : categoryForSignalType(primarySignalType || 'other')
  const sentiment = sentiments.has(item.sentiment as CanonicalSentiment)
    ? item.sentiment as CanonicalSentiment : versionTwo ? null : legacySentiment(item)
  if (typeof item.label !== 'string' || !item.label.trim()
    || typeof (item.topic ?? item.aspect) !== 'string' || !String(item.topic ?? item.aspect).trim()
    || typeof primaryCategory !== 'string' || !categories.has(primaryCategory as CanonicalCategory)
    || primarySignalType === null || sentiment === null
    || !Array.isArray(item.signalTypes) || item.signalTypes.some((type) => typeof type !== 'string')
    || typeof item.confidence !== 'number'
    || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null
  const reference = evidence as Record<string, unknown>
  if (typeof reference.reviewId !== 'string' || typeof reference.quoteText !== 'string' || !reference.quoteText) return null
  return {
    label: item.label.trim(), topic: String(item.topic ?? item.aspect).trim(),
    primaryCategory: primaryCategory as CanonicalCategory,
    signalTaxonomyVersion: taxonomyVersion,
    primarySignalType,
    proposedTypeLabel: typeof item.proposedTypeLabel === 'string' ? item.proposedTypeLabel.trim() : null,
    signalTypes: [primarySignalType], sentiment, confidence: item.confidence,
    evidence: {
      reviewId: reference.reviewId, quoteText: reference.quoteText,
      ...(Number.isInteger(reference.quoteStart) ? { quoteStart: Number(reference.quoteStart) } : {}),
      ...(Number.isInteger(reference.quoteEnd) ? { quoteEnd: Number(reference.quoteEnd) } : {}),
    },
  }
}

export function categoryThemeType(category: CanonicalCategory) {
  return category === 'pain' ? 'pain_point' : category
}

export function signalTypeThemeType(signalType: CanonicalSignalType) {
  if (signalType === 'pain') return 'pain_point'
  return signalType
}

export function themeTypeSignalType(themeType: string): CanonicalSignalType {
  if (themeType === 'pain_point' || themeType === 'service_issue') return 'pain'
  if (themeType === 'operational_failure') return 'pain'
  if (themeType === 'purchase_driver' || themeType === 'feature_request' || themeType === 'praise') return 'desired_outcome'
  return CANONICAL_SIGNAL_TYPES.includes(themeType as CanonicalSignalType) ? themeType as CanonicalSignalType : 'other'
}
