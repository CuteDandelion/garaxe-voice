// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadLlmEvaluationFixture } from './evaluation/llmCandidateEvaluator.js'
import {
  HYBRID_CANDIDATE_LIMITS,
  HYBRID_CANDIDATE_SCHEMA_VERSION,
  validateHybridCandidates,
  type HybridCandidateContext,
} from './hybridCandidateValidation.js'

const fixturePath = fileURLToPath(new URL('./fixtures/llm-analysis-gold-50.json', import.meta.url))
const organizationId = 'org-garaxe'
const projectId = 'project-voice-map'
const analysisRunId = 'run-50-review-fixture'

async function fixtureContext(): Promise<HybridCandidateContext> {
  const fixture = await loadLlmEvaluationFixture(fixturePath)
  return {
    organizationId,
    projectId,
    analysisRunId,
    reviews: fixture.reviews.map((review) => ({
      id: review.id,
      organizationId,
      projectId,
      analysisRunId,
      originalText: review.text,
    })),
  }
}

function envelope(signals: unknown[]) {
  return { schemaVersion: HYBRID_CANDIDATE_SCHEMA_VERSION, organizationId, projectId, analysisRunId, signals }
}

describe('hybrid candidate validation', () => {
  it('accepts all 50 governed exact-span fixture candidates without changing the trusted context', async () => {
    const fixture = await loadLlmEvaluationFixture(fixturePath)
    const context = await fixtureContext()
    const before = structuredClone(context)
    const signals = fixture.reviews.flatMap((review) => review.expectedSignals.map((signal) => ({ reviewId: review.id, ...signal })))

    const result = validateHybridCandidates(context, envelope(signals))

    expect(result.envelopeAccepted).toBe(true)
    expect(result.rejected).toEqual([])
    expect(result.accepted).toHaveLength(50)
    expect(result.accepted.every((candidate) => context.reviews.find((review) => review.id === candidate.reviewId)?.originalText.slice(candidate.quoteStart, candidate.quoteEnd) === candidate.quoteText)).toBe(true)
    expect(context).toEqual(before)
  })

  it('recovers a unique exact quote when provider offsets are wrong', async () => {
    const fixture = await loadLlmEvaluationFixture(fixturePath)
    const context = await fixtureContext()
    const gold = fixture.reviews[0].expectedSignals[0]

    const result = validateHybridCandidates(context, envelope([{ reviewId: 'gold-01', ...gold, quoteStart: 999, quoteEnd: 1_020, confidence: 0.84 }]))

    expect(result.rejected).toEqual([])
    expect(result.accepted[0]).toMatchObject({ quoteStart: gold.quoteStart, quoteEnd: gold.quoteEnd, offsetsRecovered: true, confidence: 0.84 })
  })

  it('rejects missing and ambiguous quotes while accepting correct offsets that disambiguate repetition', () => {
    const context: HybridCandidateContext = {
      organizationId, projectId, analysisRunId,
      reviews: [{ id: 'repeated', organizationId, projectId, analysisRunId, originalText: 'slow service then slow service' }],
    }
    const base = { reviewId: 'repeated', signalType: 'pain_point', label: 'slow_service', quoteText: 'slow service' }

    const result = validateHybridCandidates(context, envelope([
      { ...base, quoteStart: -1, quoteEnd: 11 },
      { ...base, quoteText: 'service was terrible', quoteStart: 0, quoteEnd: 20 },
      { ...base, quoteStart: 18, quoteEnd: 30 },
    ]))

    expect(result.rejected.map((item) => item.code)).toEqual(['quote_ambiguous', 'quote_missing'])
    expect(result.accepted).toHaveLength(1)
    expect(result.accepted[0]).toMatchObject({ quoteStart: 18, quoteEnd: 30, offsetsRecovered: false })
  })

  it('rejects cross-tenant envelopes, unknown run reviews, and mismatched trusted review ownership', async () => {
    const fixture = await loadLlmEvaluationFixture(fixturePath)
    const context = await fixtureContext()
    const signal = { reviewId: 'gold-01', ...fixture.reviews[0].expectedSignals[0] }

    expect(validateHybridCandidates(context, { ...envelope([signal]), organizationId: 'other-org' })).toMatchObject({
      envelopeAccepted: false, rejected: [{ code: 'ownership_mismatch' }],
    })
    expect(validateHybridCandidates(context, envelope([{ ...signal, reviewId: 'not-in-run' }])).rejected[0].code).toBe('unknown_review')

    const poisonedContext = structuredClone(context)
    poisonedContext.reviews[0].organizationId = 'other-org'
    expect(validateHybridCandidates(poisonedContext, envelope([signal])).rejected[0].code).toBe('unknown_review')
  })

  it('enforces type-specific labels, confidence bounds, and deduplicates accepted proposals', async () => {
    const fixture = await loadLlmEvaluationFixture(fixturePath)
    const context = await fixtureContext()
    const signal = { reviewId: 'gold-01', ...fixture.reviews[0].expectedSignals[0] }

    const result = validateHybridCandidates(context, envelope([
      { ...signal, signalType: 'emotion' },
      { ...signal, signalType: 'unsupported' },
      { ...signal, confidence: 2 },
      signal,
      signal,
    ]))

    expect(result.accepted).toHaveLength(1)
    expect(result.rejected.map((item) => item.code)).toEqual([
      'taxonomy_rejected', 'taxonomy_rejected', 'invalid_candidate', 'duplicate_candidate',
    ])
  })

  it('enforces envelope, signal-count, identifier, and quote size limits before enrichment', async () => {
    const context = await fixtureContext()
    const tooMany = Array.from({ length: HYBRID_CANDIDATE_LIMITS.maxSignals + 1 }, () => ({}))
    expect(validateHybridCandidates(context, envelope(tooMany)).rejected[0].code).toBe('too_many_signals')

    const oversized = envelope([{ reviewId: 'gold-01', signalType: 'pain_point', label: 'setup_complexity', quoteText: 'x'.repeat(HYBRID_CANDIDATE_LIMITS.maxEnvelopeBytes), quoteStart: 0, quoteEnd: 1 }])
    expect(validateHybridCandidates(context, oversized).rejected[0].code).toBe('payload_too_large')

    const invalidId = envelope([{ reviewId: 'x'.repeat(HYBRID_CANDIDATE_LIMITS.maxIdentifierLength + 1), signalType: 'pain_point', label: 'setup_complexity', quoteText: 'Setup', quoteStart: 0, quoteEnd: 5 }])
    expect(validateHybridCandidates(context, invalidId).rejected[0].code).toBe('invalid_candidate')
  })
})
