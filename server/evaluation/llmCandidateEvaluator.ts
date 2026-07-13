import { readFile } from 'node:fs/promises'

export const LLM_EVALUATION_FIXTURE_VERSION = 'garaxe-llm-eval-fixture-v1'
export const LLM_CANDIDATE_SCHEMA_VERSION = 'garaxe-llm-candidate-v1'

const allowedSignalTypes = new Set(['pain_point', 'desired_outcome', 'objection', 'emotion'])

export type GoldSignal = {
  signalType: string
  label: string
  quoteText: string
  quoteStart: number
  quoteEnd: number
}

export type GoldReview = {
  id: string
  provider: string
  entity: string
  rating: number
  language: string
  createdAt: string
  text: string
  expectedSignals: GoldSignal[]
}

export type LlmEvaluationFixture = {
  schemaVersion: string
  description: string
  taxonomy: {
    signalTypes: string[]
    matchingRule: string
  }
  reviews: GoldReview[]
}

export type CandidateSignal = {
  reviewId: string
  signalType: string
  label: string
  quoteText: string
  quoteStart: number
  quoteEnd: number
}

export type LlmCandidateEnvelope = {
  schemaVersion: string
  model?: string
  signals: CandidateSignal[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  latencyMs?: number
}

export type LlmCandidateScore = {
  fixtureVersion: string
  candidateSchemaVersion: string | null
  schema: {
    valid: boolean
    errors: string[]
  }
  evidence: {
    exactSpanCount: number
    candidateSignalCount: number
    exactSpanFidelity: number
  }
  taxonomy: {
    truePositive: number
    falsePositive: number
    falseNegative: number
    precision: number
    recall: number
    f1: number
  }
  performance: {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    latencyMs: number | null
    outputTokensPerSecond: number | null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validateFixture(value: unknown): asserts value is LlmEvaluationFixture {
  if (!isRecord(value) || value.schemaVersion !== LLM_EVALUATION_FIXTURE_VERSION || !Array.isArray(value.reviews)) {
    throw new Error(`Fixture must conform to ${LLM_EVALUATION_FIXTURE_VERSION}`)
  }

  const ids = new Set<string>()
  for (const [reviewIndex, review] of value.reviews.entries()) {
    if (!isRecord(review) || typeof review.id !== 'string' || typeof review.text !== 'string' || !Array.isArray(review.expectedSignals)) {
      throw new Error(`Fixture review ${reviewIndex} is invalid`)
    }
    if (ids.has(review.id)) throw new Error(`Fixture contains duplicate review ID ${review.id}`)
    ids.add(review.id)

    for (const [signalIndex, signal] of review.expectedSignals.entries()) {
      if (!isRecord(signal)
        || typeof signal.signalType !== 'string'
        || typeof signal.label !== 'string'
        || typeof signal.quoteText !== 'string'
        || typeof signal.quoteStart !== 'number'
        || typeof signal.quoteEnd !== 'number'
        || !Number.isInteger(signal.quoteStart)
        || !Number.isInteger(signal.quoteEnd)
        || signal.quoteStart < 0
        || signal.quoteEnd <= signal.quoteStart
        || review.text.slice(signal.quoteStart, signal.quoteEnd) !== signal.quoteText) {
        throw new Error(`Fixture signal ${review.id}[${signalIndex}] does not contain a valid exact source span`)
      }
    }
  }
}

export async function loadLlmEvaluationFixture(path: string): Promise<LlmEvaluationFixture> {
  const fixture: unknown = JSON.parse(await readFile(path, 'utf8'))
  validateFixture(fixture)
  return fixture
}

function parseCandidate(value: unknown): { candidate: LlmCandidateEnvelope | null; signals: CandidateSignal[]; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(value)) return { candidate: null, signals: [], errors: ['candidate must be a JSON object'] }

  if (value.schemaVersion !== LLM_CANDIDATE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must equal ${LLM_CANDIDATE_SCHEMA_VERSION}`)
  }
  if (!Array.isArray(value.signals)) errors.push('signals must be an array')

  const signals: CandidateSignal[] = []
  if (Array.isArray(value.signals)) {
    for (const [index, signal] of value.signals.entries()) {
      const path = `signals[${index}]`
      if (!isRecord(signal)) {
        errors.push(`${path} must be an object`)
        continue
      }

      const fields = ['reviewId', 'signalType', 'label', 'quoteText'] as const
      for (const field of fields) {
        if (typeof signal[field] !== 'string' || signal[field].length === 0) errors.push(`${path}.${field} must be a non-empty string`)
      }
      if (!Number.isInteger(signal.quoteStart) || (signal.quoteStart as number) < 0) errors.push(`${path}.quoteStart must be a non-negative integer`)
      if (!Number.isInteger(signal.quoteEnd) || (signal.quoteEnd as number) <= 0) errors.push(`${path}.quoteEnd must be a positive integer`)
      if (typeof signal.signalType === 'string' && !allowedSignalTypes.has(signal.signalType)) {
        errors.push(`${path}.signalType is outside the governed taxonomy`)
      }

      if (typeof signal.reviewId === 'string'
        && typeof signal.signalType === 'string'
        && typeof signal.label === 'string'
        && typeof signal.quoteText === 'string'
        && Number.isInteger(signal.quoteStart)
        && Number.isInteger(signal.quoteEnd)) {
        signals.push({
          reviewId: signal.reviewId,
          signalType: signal.signalType,
          label: signal.label,
          quoteText: signal.quoteText,
          quoteStart: signal.quoteStart as number,
          quoteEnd: signal.quoteEnd as number,
        })
      }
    }
  }

  if (value.usage !== undefined) {
    if (!isRecord(value.usage)) errors.push('usage must be an object when provided')
    else {
      for (const field of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
        if (value.usage[field] !== undefined && !isFiniteNonNegativeNumber(value.usage[field])) {
          errors.push(`usage.${field} must be a non-negative finite number when provided`)
        }
      }
    }
  }
  if (value.latencyMs !== undefined && !isFiniteNonNegativeNumber(value.latencyMs)) {
    errors.push('latencyMs must be a non-negative finite number when provided')
  }

  return { candidate: value as LlmCandidateEnvelope, signals, errors }
}

function taxonomyKey(signal: Pick<CandidateSignal, 'reviewId' | 'signalType' | 'label'>): string {
  return `${signal.reviewId}\u0000${signal.signalType}\u0000${signal.label}`
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function round(value: number): number {
  return Number(value.toFixed(6))
}

export function scoreLlmCandidate(fixture: LlmEvaluationFixture, value: unknown): LlmCandidateScore {
  validateFixture(fixture)
  const { candidate, signals, errors } = parseCandidate(value)
  const reviews = new Map(fixture.reviews.map((review) => [review.id, review]))
  const exactSpanCount = signals.filter((signal) => {
    const review = reviews.get(signal.reviewId)
    return review !== undefined
      && signal.quoteEnd > signal.quoteStart
      && review.text.slice(signal.quoteStart, signal.quoteEnd) === signal.quoteText
  }).length

  const expectedKeys = new Set(fixture.reviews.flatMap((review) => review.expectedSignals.map((signal) => taxonomyKey({ reviewId: review.id, ...signal }))))
  const candidateKeys = new Set(signals.map(taxonomyKey))
  const truePositive = [...candidateKeys].filter((key) => expectedKeys.has(key)).length
  const falsePositive = candidateKeys.size - truePositive
  const falseNegative = expectedKeys.size - truePositive
  const precision = ratio(truePositive, truePositive + falsePositive)
  const recall = ratio(truePositive, truePositive + falseNegative)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  const inputTokens = isFiniteNonNegativeNumber(candidate?.usage?.inputTokens) ? candidate.usage.inputTokens : null
  const outputTokens = isFiniteNonNegativeNumber(candidate?.usage?.outputTokens) ? candidate.usage.outputTokens : null
  const reportedTotal = isFiniteNonNegativeNumber(candidate?.usage?.totalTokens) ? candidate.usage.totalTokens : null
  const totalTokens = reportedTotal ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null)
  const latencyMs = isFiniteNonNegativeNumber(candidate?.latencyMs) ? candidate.latencyMs : null
  const outputTokensPerSecond = outputTokens !== null && latencyMs !== null && latencyMs > 0
    ? round(outputTokens / (latencyMs / 1_000))
    : null

  return {
    fixtureVersion: fixture.schemaVersion,
    candidateSchemaVersion: typeof candidate?.schemaVersion === 'string' ? candidate.schemaVersion : null,
    schema: { valid: errors.length === 0, errors },
    evidence: {
      exactSpanCount,
      candidateSignalCount: signals.length,
      exactSpanFidelity: round(ratio(exactSpanCount, signals.length)),
    },
    taxonomy: {
      truePositive,
      falsePositive,
      falseNegative,
      precision: round(precision),
      recall: round(recall),
      f1: round(f1),
    },
    performance: { inputTokens, outputTokens, totalTokens, latencyMs, outputTokensPerSecond },
  }
}
