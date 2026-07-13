// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LLM_CANDIDATE_SCHEMA_VERSION,
  loadLlmEvaluationFixture,
  scoreLlmCandidate,
  type LlmEvaluationFixture,
} from './llmCandidateEvaluator.js'

const fixturePath = fileURLToPath(new URL('../fixtures/llm-analysis-gold-50.json', import.meta.url))

function perfectCandidate(fixture: LlmEvaluationFixture) {
  return {
    schemaVersion: LLM_CANDIDATE_SCHEMA_VERSION,
    model: 'fixture-perfect-v1',
    signals: fixture.reviews.flatMap((review) => review.expectedSignals.map((signal) => ({
      reviewId: review.id,
      ...signal,
    }))),
    usage: { inputTokens: 2_000, outputTokens: 500, totalTokens: 2_500 },
    latencyMs: 2_000,
  }
}

describe('LLM candidate evaluation fixture', () => {
  it('contains 50 exact-span reviews balanced across the governed taxonomy', async () => {
    const fixture = await loadLlmEvaluationFixture(fixturePath)

    expect(fixture.reviews).toHaveLength(50)
    const counts = fixture.reviews.reduce<Record<string, number>>((result, review) => {
      for (const signal of review.expectedSignals) {
        expect(review.text.slice(signal.quoteStart, signal.quoteEnd)).toBe(signal.quoteText)
        result[signal.signalType] = (result[signal.signalType] ?? 0) + 1
      }
      return result
    }, {})
    expect(counts).toEqual({ pain_point: 13, desired_outcome: 13, objection: 12, emotion: 12 })
    expect(new Set(fixture.reviews.map((review) => review.rating))).toEqual(new Set([1, 2, 3, 4, 5]))
  })

  it('scores a schema-valid exact candidate and reports usage and latency', async () => {
    const fixture = await loadLlmEvaluationFixture(fixturePath)
    const score = scoreLlmCandidate(fixture, perfectCandidate(fixture))

    expect(score.schema).toEqual({ valid: true, errors: [] })
    expect(score.evidence).toEqual({ exactSpanCount: 50, candidateSignalCount: 50, exactSpanFidelity: 1 })
    expect(score.taxonomy).toEqual({
      truePositive: 50,
      falsePositive: 0,
      falseNegative: 0,
      precision: 1,
      recall: 1,
      f1: 1,
    })
    expect(score.performance).toEqual({
      inputTokens: 2_000,
      outputTokens: 500,
      totalTokens: 2_500,
      latencyMs: 2_000,
      outputTokensPerSecond: 250,
    })
  })

  it('separates schema, exact-span, and taxonomy failures', async () => {
    const fixture = await loadLlmEvaluationFixture(fixturePath)
    const expected = fixture.reviews[0].expectedSignals[0]
    const score = scoreLlmCandidate(fixture, {
      schemaVersion: 'wrong-version',
      signals: [
        {
          reviewId: fixture.reviews[0].id,
          ...expected,
          quoteText: 'paraphrased evidence',
        },
        {
          reviewId: fixture.reviews[1].id,
          ...fixture.reviews[1].expectedSignals[0],
          label: 'invented_label',
        },
      ],
      usage: { inputTokens: -1 },
      latencyMs: 'slow',
    })

    expect(score.schema.valid).toBe(false)
    expect(score.schema.errors).toEqual(expect.arrayContaining([
      `schemaVersion must equal ${LLM_CANDIDATE_SCHEMA_VERSION}`,
      'usage.inputTokens must be a non-negative finite number when provided',
      'latencyMs must be a non-negative finite number when provided',
    ]))
    expect(score.evidence).toEqual({ exactSpanCount: 1, candidateSignalCount: 2, exactSpanFidelity: 0.5 })
    expect(score.taxonomy).toMatchObject({ truePositive: 1, falsePositive: 1, falseNegative: 49 })
  })

  it('rejects fixture gold labels whose offsets do not reproduce the quote', async () => {
    const fixture = await loadLlmEvaluationFixture(fixturePath)
    const corrupted = structuredClone(fixture)
    corrupted.reviews[0].expectedSignals[0].quoteEnd += 1

    expect(() => scoreLlmCandidate(corrupted, perfectCandidate(fixture))).toThrow(/exact source span/)
  })
})
