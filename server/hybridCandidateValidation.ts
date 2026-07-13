import type { SignalType } from './signalExtraction.js'

export const HYBRID_CANDIDATE_SCHEMA_VERSION = 'garaxe-hybrid-candidate-v1'
export const HYBRID_CANDIDATE_VALIDATOR_VERSION = 'hybrid-candidate-validator-v1'

export const HYBRID_CANDIDATE_LIMITS = Object.freeze({
  maxEnvelopeBytes: 256_000,
  maxSignals: 100,
  maxQuoteLength: 1_000,
  maxLabelLength: 80,
  maxIdentifierLength: 200,
})

const allowedLabelsByType = {
  pain_point: new Set([
    'booking_friction', 'cleanliness', 'data_reliability', 'delivery_delay', 'price_value', 'reliability',
    'setup_complexity', 'slow_service', 'staff_friendliness', 'support_delay', 'unclear_documentation',
    'usability', 'waiting_time',
  ]),
  desired_outcome: new Set([
    'clear_documentation', 'dependable_service', 'easy_setup', 'effective_support', 'location_consistency',
    'on_time_delivery', 'peace_of_mind', 'quick_support', 'reliable_tool', 'team_adoption',
    'transparent_pricing', 'wait_time_visibility', 'welcoming_experience',
  ]),
  objection: new Set([
    'cancellation_friction', 'contract_commitment', 'data_security', 'integration_fit', 'learning_curve',
    'migration_risk', 'multi_location_proof', 'niche_fit', 'plan_clarity', 'price_too_high', 'social_proof',
    'vendor_capacity',
  ]),
  emotion: new Set([
    'comfort', 'confidence', 'disappointment', 'doubt', 'exhaustion', 'feeling_ignored', 'frustration',
    'hope', 'overwhelm', 'reassurance', 'relief', 'restored_trust',
  ]),
} as const

type HybridSignalType = keyof typeof allowedLabelsByType

export type UntrustedHybridCandidate = {
  reviewId?: unknown
  signalType?: unknown
  label?: unknown
  quoteText?: unknown
  quoteStart?: unknown
  quoteEnd?: unknown
  confidence?: unknown
}

export type UntrustedHybridCandidateEnvelope = {
  schemaVersion?: unknown
  organizationId?: unknown
  projectId?: unknown
  analysisRunId?: unknown
  signals?: unknown
}

export type HybridCandidateReview = {
  id: string
  organizationId: string
  projectId: string
  analysisRunId: string
  originalText: string
}

export type HybridCandidateContext = {
  organizationId: string
  projectId: string
  analysisRunId: string
  reviews: readonly HybridCandidateReview[]
}

export type ValidatedHybridCandidate = {
  reviewId: string
  signalType: Extract<SignalType, HybridSignalType>
  label: string
  quoteText: string
  quoteStart: number
  quoteEnd: number
  confidence: number | null
  offsetsRecovered: boolean
  attributes: {
    source: 'llm_candidate'
    validatorVersion: typeof HYBRID_CANDIDATE_VALIDATOR_VERSION
    schemaVersion: typeof HYBRID_CANDIDATE_SCHEMA_VERSION
  }
}

export type HybridCandidateRejectionCode =
  | 'invalid_envelope'
  | 'schema_mismatch'
  | 'ownership_mismatch'
  | 'payload_too_large'
  | 'too_many_signals'
  | 'invalid_candidate'
  | 'unknown_review'
  | 'taxonomy_rejected'
  | 'quote_too_large'
  | 'quote_missing'
  | 'quote_ambiguous'
  | 'duplicate_candidate'

export type HybridCandidateRejection = {
  index: number | null
  code: HybridCandidateRejectionCode
  message: string
}

export type HybridCandidateValidationResult = {
  accepted: ValidatedHybridCandidate[]
  rejected: HybridCandidateRejection[]
  envelopeAccepted: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= HYBRID_CANDIDATE_LIMITS.maxIdentifierLength
}

function utf8Bytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function exactOccurrences(text: string, quote: string): number[] {
  const occurrences: number[] = []
  let cursor = 0
  while (cursor <= text.length - quote.length) {
    const found = text.indexOf(quote, cursor)
    if (found === -1) break
    occurrences.push(found)
    cursor = found + 1
  }
  return occurrences
}

function validConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function rejectEnvelope(code: HybridCandidateRejectionCode, message: string): HybridCandidateValidationResult {
  return { accepted: [], rejected: [{ index: null, code, message }], envelopeAccepted: false }
}

/**
 * Validates untrusted model proposals against trusted, immutable run membership.
 * The returned candidates are new proposal objects; deterministic signals and the
 * supplied ownership context are never modified.
 */
export function validateHybridCandidates(
  context: HybridCandidateContext,
  value: unknown,
): HybridCandidateValidationResult {
  if (utf8Bytes(value) > HYBRID_CANDIDATE_LIMITS.maxEnvelopeBytes) {
    return rejectEnvelope('payload_too_large', 'Candidate envelope exceeds the configured byte limit.')
  }
  if (!isRecord(value)) return rejectEnvelope('invalid_envelope', 'Candidate envelope must be a JSON object.')
  if (value.schemaVersion !== HYBRID_CANDIDATE_SCHEMA_VERSION) {
    return rejectEnvelope('schema_mismatch', `schemaVersion must equal ${HYBRID_CANDIDATE_SCHEMA_VERSION}.`)
  }
  if (value.organizationId !== context.organizationId
    || value.projectId !== context.projectId
    || value.analysisRunId !== context.analysisRunId) {
    return rejectEnvelope('ownership_mismatch', 'Candidate envelope does not belong to the trusted organization, project, and analysis run.')
  }
  if (!Array.isArray(value.signals)) return rejectEnvelope('invalid_envelope', 'signals must be an array.')
  if (value.signals.length > HYBRID_CANDIDATE_LIMITS.maxSignals) {
    return rejectEnvelope('too_many_signals', 'Candidate envelope contains too many signals.')
  }

  const reviews = new Map<string, HybridCandidateReview>()
  for (const review of context.reviews) {
    if (review.organizationId !== context.organizationId
      || review.projectId !== context.projectId
      || review.analysisRunId !== context.analysisRunId) continue
    reviews.set(review.id, review)
  }

  const accepted: ValidatedHybridCandidate[] = []
  const rejected: HybridCandidateRejection[] = []
  const seen = new Set<string>()

  value.signals.forEach((candidate, index) => {
    if (!isRecord(candidate)
      || !boundedIdentifier(candidate.reviewId)
      || typeof candidate.signalType !== 'string'
      || typeof candidate.label !== 'string'
      || typeof candidate.quoteText !== 'string'
      || candidate.quoteText.length === 0
      || candidate.label.length === 0
      || candidate.label.length > HYBRID_CANDIDATE_LIMITS.maxLabelLength
      || (candidate.confidence !== undefined && !validConfidence(candidate.confidence))) {
      rejected.push({ index, code: 'invalid_candidate', message: 'Candidate fields are missing, malformed, or outside configured bounds.' })
      return
    }

    const review = reviews.get(candidate.reviewId)
    if (!review) {
      rejected.push({ index, code: 'unknown_review', message: 'Candidate review is not a trusted member of this analysis run.' })
      return
    }

    if (!(candidate.signalType in allowedLabelsByType)) {
      rejected.push({ index, code: 'taxonomy_rejected', message: 'Candidate signal type is outside the governed taxonomy.' })
      return
    }
    const signalType = candidate.signalType as HybridSignalType
    if (!allowedLabelsByType[signalType].has(candidate.label)) {
      rejected.push({ index, code: 'taxonomy_rejected', message: 'Candidate label is not allowed for this signal type.' })
      return
    }
    if (candidate.quoteText.length > HYBRID_CANDIDATE_LIMITS.maxQuoteLength) {
      rejected.push({ index, code: 'quote_too_large', message: 'Candidate quote exceeds the configured length limit.' })
      return
    }

    const suppliedOffsetsAreExact = Number.isInteger(candidate.quoteStart)
      && Number.isInteger(candidate.quoteEnd)
      && (candidate.quoteStart as number) >= 0
      && (candidate.quoteEnd as number) > (candidate.quoteStart as number)
      && review.originalText.slice(candidate.quoteStart as number, candidate.quoteEnd as number) === candidate.quoteText

    let quoteStart: number
    let quoteEnd: number
    let offsetsRecovered = false
    if (suppliedOffsetsAreExact) {
      quoteStart = candidate.quoteStart as number
      quoteEnd = candidate.quoteEnd as number
    } else {
      const occurrences = exactOccurrences(review.originalText, candidate.quoteText)
      if (occurrences.length === 0) {
        rejected.push({ index, code: 'quote_missing', message: 'Candidate quote is not an exact substring of the original review.' })
        return
      }
      if (occurrences.length > 1) {
        rejected.push({ index, code: 'quote_ambiguous', message: 'Candidate quote occurs more than once and supplied offsets do not disambiguate it.' })
        return
      }
      quoteStart = occurrences[0]
      quoteEnd = quoteStart + candidate.quoteText.length
      offsetsRecovered = true
    }

    const duplicateKey = `${review.id}\u0000${signalType}\u0000${candidate.label}\u0000${quoteStart}\u0000${quoteEnd}`
    if (seen.has(duplicateKey)) {
      rejected.push({ index, code: 'duplicate_candidate', message: 'Candidate duplicates an already accepted proposal.' })
      return
    }
    seen.add(duplicateKey)

    accepted.push({
      reviewId: review.id,
      signalType,
      label: candidate.label,
      quoteText: candidate.quoteText,
      quoteStart,
      quoteEnd,
      confidence: validConfidence(candidate.confidence) ? candidate.confidence : null,
      offsetsRecovered,
      attributes: {
        source: 'llm_candidate',
        validatorVersion: HYBRID_CANDIDATE_VALIDATOR_VERSION,
        schemaVersion: HYBRID_CANDIDATE_SCHEMA_VERSION,
      },
    })
  })

  return { accepted, rejected, envelopeAccepted: true }
}
