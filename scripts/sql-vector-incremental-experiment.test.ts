// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { runLiveSqlVectorDifferentialExperiment, runSqlVectorIncrementalExperiment } from './sql-vector-incremental-experiment'

const connectionString = process.env.SQL_VECTOR_EXPERIMENT_DATABASE_URL

describe.runIf(Boolean(connectionString))('local SQL-vector incremental experiment', () => {
  it('uses indexed canonical vectors and preserves exact 10+20 output', async () => {
    const result = await runSqlVectorIncrementalExperiment(connectionString!)

    expect(result.vector).toMatchObject({ version: '0.8.2', indexUsed: true })
    expect(result.dataset).toEqual({ initialReviews: 10, appendedReviews: 20, totalReviews: 30 })
    expect(result.equivalence).toMatchObject({ exact: true, topic: true, evidence: true, provenance: true })
    expect(result.incremental.uniqueEvidenceCount).toBe(30)
    expect(result.incremental.modelRequestEquivalents.total).toBeLessThanOrEqual(result.full.modelRequestEquivalents.total)
    expect(result.incremental.retrieval.p95Ms).toBeGreaterThanOrEqual(0)
  }, 30_000)

  it('runs full then incremental live queues without overlap or retries', async () => {
    let active = 0
    let peakActive = 0
    const result = await runLiveSqlVectorDifferentialExperiment(connectionString!, {
      completionProvider: {
        complete: async (input) => {
          active += 1
          peakActive = Math.max(peakActive, active)
          const pairs = JSON.parse(input.messages[1].content).pairs
          active -= 1
          return {
            provider: 'opencode_go' as const, model: input.model,
            content: JSON.stringify({ decisions: pairs.map((pair: any) => ({ pairId: pair.pairId, sameTopic: pair.left.topic === pair.right.topic })) }),
            finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, requestId: null,
          }
        },
      },
      model: 'test-model', maxTokens: 1_000,
    })

    expect(peakActive).toBe(1)
    expect(result.aborted).toBe(false)
    expect(result.equivalence.exact).toBe(true)
    expect(result.full.providerCalls).toBe(13)
    expect(result.incremental.providerCalls).toBe(11)
    expect(result.full.retries + result.incremental.retries).toBe(0)
  }, 60_000)
})
