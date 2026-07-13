export type PreprocessingReason =
  | 'included'
  | 'rating_only'
  | 'empty_text'
  | 'too_short'
  | 'duplicate'
  | 'unsupported_language'
  | 'outside_date_range'
  | 'suspected_spam'
  | 'user_excluded'

export type PreprocessingReview = {
  id: string
  bodyOriginal?: string | null
  /** Compatibility alias for canonical records that still expose `body`. */
  body?: string | null
  ratingValue?: number | null
  language?: string | null
  sourceCreatedAt?: string | Date | null
  entityId?: string | null
  entityName?: string | null
  canonicalHash?: string | null
  isRatingOnly?: boolean
  isSuspectedSpam?: boolean
  userExcluded?: boolean
}

export type PreprocessingConfig = {
  /** Immutable run objective is carried for reproducibility; deterministic cleaning is objective-agnostic. */
  objective?: string
  writtenOnly: boolean
  minTextLength: number
  languages?: string[]
  dateFrom?: string
  dateTo?: string
  entityIds?: string[]
  entityNames?: string[]
  ratings?: number[]
  /** Jaccard similarity used for deterministic near-duplicate detection. Defaults to 0.92. */
  duplicateSimilarityThreshold?: number
}

export type PreprocessedReview = {
  reviewId: string
  originalText: string
  normalizedText: string
  status: 'included' | 'excluded'
  reason: PreprocessingReason
  duplicateOfReviewId: string | null
  textLength: number
}

export type DuplicateGroup = {
  canonicalReviewId: string
  duplicateReviewIds: string[]
}

export type QualityConfidence = 'high' | 'moderate' | 'emerging' | 'weak' | 'insufficient'

export type PreprocessingQualityReport = {
  preprocessingVersion: string
  found: number
  included: number
  excluded: number
  exclusionReasons: Record<Exclude<PreprocessingReason, 'included'>, number>
  written: number
  ratingOnly: number
  languageDistribution: Record<string, number>
  averageTextLength: number
  medianTextLength: number
  duplicateGroupCount: number
  duplicateGroups: DuplicateGroup[]
  confidence: QualityConfidence
}

export const PREPROCESSING_VERSION = 'deterministic-preprocessing-v1'

export type PreprocessingResult = {
  reviews: PreprocessedReview[]
  qualityReport: PreprocessingQualityReport
}

const exclusionReasons: Array<Exclude<PreprocessingReason, 'included'>> = [
  'rating_only',
  'empty_text',
  'too_short',
  'duplicate',
  'unsupported_language',
  'outside_date_range',
  'suspected_spam',
  'user_excluded',
]

/** Normalize only the derived analysis text; callers retain `originalText` unchanged. */
export function normalizeReviewText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function normalizedLanguage(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace('_', '-') || 'unknown'
}

function isRatingOnly(review: PreprocessingReview, normalizedText: string) {
  return review.isRatingOnly ?? normalizedText.length === 0
}

function inDateRange(value: string | Date | null | undefined, from?: string, to?: string) {
  if (!from && !to) return true
  if (!value) return false
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value)
  if (Number.isNaN(timestamp)) return false
  if (from && timestamp < Date.parse(from)) return false
  if (to) {
    const inclusiveEnd = /^\d{4}-\d{2}-\d{2}$/.test(to)
      ? Date.parse(`${to}T23:59:59.999Z`)
      : Date.parse(to)
    if (Number.isNaN(inclusiveEnd) || timestamp > inclusiveEnd) return false
  }
  return true
}

function looksLikeSpam(text: string) {
  if (!text) return false
  const urls = text.match(/https?:\/\/|www\./giu)?.length ?? 0
  const promotional = /\b(buy now|promo code|discount code|click here|limited offer|earn money|crypto investment)\b/iu.test(text)
  const repeatedCharacter = /(.)\1{11,}/u.test(text)
  const tokens = text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const repeatedToken = tokens.length >= 8 && new Set(tokens).size === 1
  return repeatedCharacter || repeatedToken || (urls >= 3 && promotional)
}

function tokenSet(text: string) {
  return new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection += 1
  return intersection / (left.size + right.size - intersection)
}

function confidenceFor(includedWritten: number, averageLength: number): QualityConfidence {
  if (includedWritten >= 150 && averageLength >= 40) return 'high'
  if (includedWritten >= 50 && averageLength >= 25) return 'moderate'
  if (includedWritten >= 20 && averageLength >= 15) return 'emerging'
  if (includedWritten >= 5 && averageLength >= 8) return 'weak'
  return 'insufficient'
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function initialReason(review: PreprocessingReview, normalizedText: string, config: PreprocessingConfig): PreprocessingReason {
  const excludedBySelection = review.userExcluded === true
    || (config.entityIds !== undefined && config.entityIds.length > 0 && (!review.entityId || !config.entityIds.includes(review.entityId)))
    || (config.entityNames !== undefined && config.entityNames.length > 0 && (!review.entityName || !config.entityNames.includes(review.entityName)))
    || (config.ratings !== undefined && config.ratings.length > 0 && (review.ratingValue == null || !config.ratings.includes(review.ratingValue)))
  if (excludedBySelection) return 'user_excluded'
  if (!inDateRange(review.sourceCreatedAt, config.dateFrom, config.dateTo)) return 'outside_date_range'
  const ratingOnly = isRatingOnly(review, normalizedText)
  if (ratingOnly) return config.writtenOnly ? 'rating_only' : 'included'
  if (!normalizedText) return 'empty_text'
  if (normalizedText.length < config.minTextLength) return 'too_short'
  const language = normalizedLanguage(review.language)
  const selectedLanguages = config.languages?.map(normalizedLanguage)
  if (selectedLanguages?.length && language !== 'unknown' && !selectedLanguages.includes(language)) return 'user_excluded'
  if (review.isSuspectedSpam || looksLikeSpam(normalizedText)) return 'suspected_spam'
  return 'included'
}

export function preprocessReviews(reviews: PreprocessingReview[], config: PreprocessingConfig): PreprocessingResult {
  if (!Number.isInteger(config.minTextLength) || config.minTextLength < 0) {
    throw new Error('minTextLength must be a non-negative integer')
  }
  const threshold = config.duplicateSimilarityThreshold ?? 0.92
  if (threshold < 0 || threshold > 1) throw new Error('duplicateSimilarityThreshold must be between 0 and 1')

  const prepared = reviews.map((review) => {
    const originalText = review.bodyOriginal ?? review.body ?? ''
    const normalizedText = normalizeReviewText(originalText)
    const output: PreprocessedReview = {
      reviewId: review.id,
      originalText,
      normalizedText,
      status: 'included',
      reason: initialReason(review, normalizedText, config),
      duplicateOfReviewId: null,
      textLength: normalizedText.length,
    }
    return {
      source: review,
      output,
    }
  })

  const canonical: typeof prepared = []
  const groups = new Map<string, string[]>()
  for (const current of prepared) {
    if (current.output.reason !== 'included' || current.output.normalizedText.length === 0) continue
    const match = canonical.find((candidate) => {
      const sameRating = candidate.source.ratingValue === current.source.ratingValue
      if (!sameRating) return false
      if (candidate.source.canonicalHash && current.source.canonicalHash &&
        candidate.source.canonicalHash === current.source.canonicalHash) return true
      if (candidate.output.normalizedText === current.output.normalizedText) return true
      if (Math.min(candidate.output.normalizedText.length, current.output.normalizedText.length) < 20) return false
      return jaccard(tokenSet(candidate.output.normalizedText), tokenSet(current.output.normalizedText)) >= threshold
    })
    if (!match) {
      canonical.push(current)
      continue
    }
    current.output.reason = 'duplicate'
    current.output.duplicateOfReviewId = match.output.reviewId
    groups.set(match.output.reviewId, [...(groups.get(match.output.reviewId) ?? []), current.output.reviewId])
  }

  for (const item of prepared) item.output.status = item.output.reason === 'included' ? 'included' : 'excluded'
  const outputs = prepared.map(({ output }) => output)
  const counts = Object.fromEntries(exclusionReasons.map((reason) => [reason, 0])) as PreprocessingQualityReport['exclusionReasons']
  for (const output of outputs) if (output.reason !== 'included') counts[output.reason] += 1

  const includedWrittenLengths = outputs
    .filter((output) => output.status === 'included' && output.normalizedText.length > 0)
    .map((output) => output.textLength)
  const languageDistribution: Record<string, number> = {}
  for (const { source, output } of prepared) {
    if (output.status !== 'included') continue
    const language = normalizedLanguage(source.language)
    languageDistribution[language] = (languageDistribution[language] ?? 0) + 1
  }
  const averageTextLength = includedWrittenLengths.length
    ? includedWrittenLengths.reduce((sum, length) => sum + length, 0) / includedWrittenLengths.length
    : 0
  const includedAverage = includedWrittenLengths.length
    ? includedWrittenLengths.reduce((sum, length) => sum + length, 0) / includedWrittenLengths.length
    : 0
  const duplicateGroups = [...groups.entries()].map(([canonicalReviewId, duplicateReviewIds]) => ({ canonicalReviewId, duplicateReviewIds }))

  return {
    reviews: outputs,
    qualityReport: {
      preprocessingVersion: PREPROCESSING_VERSION,
      found: outputs.length,
      included: outputs.filter((output) => output.status === 'included').length,
      excluded: outputs.filter((output) => output.status === 'excluded').length,
      exclusionReasons: counts,
      written: includedWrittenLengths.length,
      ratingOnly: outputs.filter((output) => output.status === 'included').length - includedWrittenLengths.length,
      languageDistribution,
      averageTextLength,
      medianTextLength: median(includedWrittenLengths),
      duplicateGroupCount: duplicateGroups.length,
      duplicateGroups,
      confidence: confidenceFor(includedWrittenLengths.length, includedAverage),
    },
  }
}
