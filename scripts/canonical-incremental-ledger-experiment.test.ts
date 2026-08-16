// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LlmProviderError } from '../server/llmProvider'
import {
  runCanonicalIncrementalLedgerExperiment, runCanonicalLedgerScaleExperiment, runLiveCanonicalLedgerExperiment,
  runProviderFreeFairnessExperiment,
} from './canonical-incremental-ledger-experiment'

describe('provider-free canonical incremental decision ledger', () => {
  it('aborts three-user fairness before allocation when its workspace guard is exceeded', async () => {
    const result = await runProviderFreeFairnessExperiment({ maxWorkspaces: 2 })

    expect(result).toMatchObject({
      aborted: true,
      abortReason: 'RESOURCE_GUARD',
      workspaces: 3,
      providerCalls: 0,
      allocationsStarted: false,
      ledgerEngineInstances: 0,
      cleanup: { ledgerEngine: 'not_created', openJobs: 0 },
    })
  })

  it('keeps three concurrently submitted workspaces fair, isolated, and exactly equivalent', async () => {
    const result = await runProviderFreeFairnessExperiment()

    expect(result).toMatchObject({
      aborted: false,
      abortReason: null,
      workspaces: 3,
      reviewsPerWorkspace: 50,
      providerCalls: 0,
      allocationsStarted: true,
      ledgerEngineInstances: 1,
      scheduler: {
        maxActive: 1,
        peakActive: 1,
        enqueueOrder: ['workspace-1', 'workspace-2', 'workspace-3'],
        startOrder: ['workspace-1', 'workspace-2', 'workspace-3'],
      },
      guard: {
        passed: true,
        maxQueueWaitMs: 30_000,
        maxRssDeltaBytes: 536_870_912,
        totalPairComparisonBudget: 7_350,
      },
      cleanup: { ledgerEngine: 'closed', openJobs: 0 },
    })
    expect(result.jobs).toHaveLength(3)
    for (const job of result.jobs) {
      expect(job).toMatchObject({
        starved: false,
        foreignWorkspaceRows: 0,
        serial: { comparisons: 1_225 },
        concurrent: { comparisons: 1_225 },
        equivalence: { exact: true, topic: true, evidence: true, provenance: true, candidateLedger: true },
      })
      expect(job.serial.candidateLedgerCount).toBeGreaterThan(0)
      expect(job.concurrent.candidateLedgerCount).toBe(job.serial.candidateLedgerCount)
      expect(job.progress.map((event) => event.value)).toEqual([0, 20, 70, 100])
      expect(job.progress.every((event, index) => index === 0 || event.value >= job.progress[index - 1].value)).toBe(true)
      expect(job.queueWaitMs).toBeLessThanOrEqual(result.guard.maxQueueWaitMs)
    }
    expect(result.metrics.queueWaitMs.p50).toBeLessThanOrEqual(result.metrics.queueWaitMs.p95)
    expect(result.metrics.completionMs.p50).toBeLessThanOrEqual(result.metrics.completionMs.p95)
    expect(result.observedPeakRssDeltaBytes).toBeLessThanOrEqual(result.guard.maxRssDeltaBytes)
  }, 120_000)

  it('aborts the 50-review scale lane before allocation when its strict guard is exceeded', async () => {
    const result = await runCanonicalLedgerScaleExperiment({ maxReviews: 49 })

    expect(result).toMatchObject({
      aborted: true,
      abortReason: 'RESOURCE_GUARD',
      dataset: { initialReviews: 10, appendedReviews: 40, totalReviews: 50 },
      providerCalls: 0,
      guard: { checkedBeforeAllocation: true, maxReviews: 49, actualReviews: 50 },
      allocationsStarted: false,
      cleanup: { fullProjection: 'not_created', incrementalProjection: 'not_created' },
    })
  })

  it('replays the exact canonical ledger for a 10 plus 40 review append', async () => {
    const result = await runCanonicalLedgerScaleExperiment()

    expect(result).toMatchObject({
      aborted: false,
      abortReason: null,
      dataset: { initialReviews: 10, appendedReviews: 40, totalReviews: 50 },
      providerCalls: 0,
      allocationsStarted: true,
      ledgerEngineInstances: 1,
      guard: { checkedBeforeAllocation: true, passed: true, maxReviews: 50, maxPairComparisons: 1_225 },
      full: { comparisons: 1_225 },
      incremental: { deltaComparisons: 1_180, totalComparisons: 1_225 },
      equivalence: { exact: true, topic: true, evidence: true, provenance: true, candidateLedger: true },
      cleanup: { fullProjection: 'closed', incrementalProjection: 'closed' },
    })
    expect(result.full.candidateLedgerCount).toBeGreaterThan(0)
    expect(result.incremental.candidateLedgerCount).toBe(result.full.candidateLedgerCount)
    expect(result.incremental.unseenAdjudications).toBe(
      result.full.candidateLedgerCount - result.incremental.initialLedgerCount,
    )
    expect(result.observedPeakRssDeltaBytes).toBeLessThanOrEqual(result.guard.maxRssDeltaBytes)
  }, 30_000)

  it('leaves no projection open when the strict pair guard aborts before allocation', async () => {
    const result = await runCanonicalLedgerScaleExperiment({ maxPairComparisons: 1_224 })

    expect(result).toMatchObject({
      aborted: true,
      abortReason: 'RESOURCE_GUARD',
      ledgerEngineInstances: 0,
      cleanup: { ledgerEngine: 'not_created' },
    })
    expect([result.cleanup.fullProjection, result.cleanup.incrementalProjection]).not.toContain('open')
  }, 30_000)

  it('guards the 100-review scale lane before allocating its 4,950 pairs', async () => {
    const result = await runCanonicalLedgerScaleExperiment({
      totalReviews: 100,
      maxReviews: 99,
      maxPairComparisons: 4_950,
    })

    expect(result).toMatchObject({
      aborted: true,
      abortReason: 'RESOURCE_GUARD',
      dataset: { initialReviews: 50, appendedReviews: 50, totalReviews: 100 },
      providerCalls: 0,
      ledgerEngineInstances: 0,
      allocationsStarted: false,
      guard: { actualReviews: 100, requiredPairComparisons: 4_950 },
      cleanup: { ledgerEngine: 'not_created', fullProjection: 'not_created', incrementalProjection: 'not_created' },
    })
  }, 30_000)

  it('replays the exact canonical ledger for a 50 plus 50 review append', async () => {
    const result = await runCanonicalLedgerScaleExperiment({ totalReviews: 100 })

    expect(result).toMatchObject({
      aborted: false,
      abortReason: null,
      dataset: { initialReviews: 50, appendedReviews: 50, totalReviews: 100 },
      providerCalls: 0,
      allocationsStarted: true,
      ledgerEngineInstances: 1,
      guard: { passed: true, maxReviews: 100, maxPairComparisons: 4_950 },
      full: { comparisons: 4_950 },
      incremental: { deltaComparisons: 3_725, totalComparisons: 4_950 },
      equivalence: { exact: true, topic: true, evidence: true, provenance: true, candidateLedger: true },
      cleanup: { ledgerEngine: 'closed', fullProjection: 'closed', incrementalProjection: 'closed' },
    })
    expect(result.full.candidateLedgerCount).toBeGreaterThan(0)
    expect(result.incremental.candidateLedgerCount).toBe(result.full.candidateLedgerCount)
    expect(result.incremental.unseenAdjudications).toBe(
      result.full.candidateLedgerCount - result.incremental.initialLedgerCount,
    )
    expect(result.observedPeakRssDeltaBytes).toBeLessThanOrEqual(result.guard.maxRssDeltaBytes)
  }, 120_000)

  it('replays one canonical decision per review pair across append partitions', async () => {
    const result = await runCanonicalIncrementalLedgerExperiment([[20], [10, 10], [5, 5, 10]])

    expect(result.dataset).toEqual({ initialReviews: 10, appendedReviews: 20, totalReviews: 30 })
    expect(result.full.candidateLedgerCount).toBeGreaterThan(0)
    expect(result.full.adjudicatedPairs).toBe(result.full.candidateLedgerCount)
    expect(result.full.requestEquivalents).toBe(Math.ceil(result.full.candidateLedgerCount / 5))
    expect(result.incrementalBaseline.unseenAdjudications).toBe(
      result.full.candidateLedgerCount - result.incrementalBaseline.initialLedgerCount,
    )
    expect(result.incrementalBaseline.coalescedRequestEquivalents).toBe(
      Math.ceil(result.incrementalBaseline.unseenAdjudications / 5),
    )
    expect(result.providerCalls).toBe(0)
    expect(result.partitions).toHaveLength(3)
    for (const partition of result.partitions) {
      expect(partition.candidateLedgerCount).toBe(result.full.candidateLedgerCount)
      expect(partition.unseenAdjudications).toBe(result.incrementalBaseline.unseenAdjudications)
      expect(partition.deltaComparisons).toBe(390)
      expect(partition.totalComparisons).toBe(435)
      expect(partition.maxAdjudicationsPerPair).toBe(1)
      expect(partition.representativeProxyPairCount).toBe(0)
      expect(partition.equivalence).toMatchObject({
        exact: true, topic: true, evidence: true, provenance: true, candidateLedger: true,
      })
    }
  }, 30_000)

  it('derives the live plan from the active embedding geometry instead of fixed candidate counts', async () => {
    const vectors = new Map<string, number[]>()
    let embedCalls = 0
    const result = await runLiveCanonicalLedgerExperiment({
      embeddingProvider: {
        id: 'test-one-hot',
        version: 'test-one-hot-v1',
        dimensions: 64,
        embed: async (texts) => texts.map((text) => {
          embedCalls += 1
          let vector = vectors.get(text)
          if (!vector) {
            vector = Array.from({ length: 64 }, (_, index) => index === vectors.size ? 1 : 0)
            vectors.set(text, vector)
          }
          return [...vector]
        }),
      },
      completionProvider: {
        complete: async (input) => {
          const pairs = JSON.parse(input.messages[1].content).pairs
          return {
            provider: 'opencode_go' as const,
            model: input.model,
            content: JSON.stringify({ decisions: pairs.map((pair: any) => ({
              pairId: pair.pairId, sameTopic: pair.left.topic === pair.right.topic,
            })) }),
            finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, requestId: null,
          }
        },
      },
      model: 'test-model',
      maxTokens: 1_000,
    })

    expect(embedCalls).toBeGreaterThan(0)
    expect(result).toMatchObject({
      aborted: false,
      equivalence: { exact: true, topic: true, evidence: true, provenance: true, candidateLedger: true },
    })
  }, 30_000)

  it('adjudicates unseen canonical pairs once and replays one immutable live ledger', async () => {
    let active = 0
    let peakActive = 0
    const result = await runLiveCanonicalLedgerExperiment({
      completionProvider: {
        complete: async (input) => {
          active += 1
          peakActive = Math.max(peakActive, active)
          const pairs = JSON.parse(input.messages[1].content).pairs
          active -= 1
          return {
            provider: 'opencode_go' as const,
            model: input.model,
            content: JSON.stringify({ decisions: pairs.map((pair: any) => ({
              pairId: pair.pairId, sameTopic: pair.left.topic === pair.right.topic,
            })) }),
            finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, requestId: null,
          }
        },
      },
      model: 'test-model',
      maxTokens: 1_000,
    })

    expect(peakActive).toBe(1)
    expect(result).toMatchObject({
      aborted: false,
      provider: { retries: 0 },
      equivalence: { exact: true, topic: true, evidence: true, provenance: true, candidateLedger: true },
    })
    expect(result.decisions.total).toBe(result.decisions.initialSaved + result.decisions.newlyAdjudicated)
    expect(result.provider.plannedCalls).toBe(Math.ceil(result.decisions.newlyAdjudicated / 5))
    expect(result.provider.calls).toBe(result.provider.plannedCalls)
  }, 30_000)

  it('preserves partial diagnostics and cleanup state when the provider fails', async () => {
    let attempted = 0
    const result = await runLiveCanonicalLedgerExperiment({
      completionProvider: {
        complete: async (input) => {
          attempted += 1
          if (attempted === 3) throw new LlmProviderError('PROVIDER_UNAVAILABLE', 'Unavailable.', null, 503)
          const pairs = JSON.parse(input.messages[1].content).pairs
          return {
            provider: 'opencode_go' as const,
            model: input.model,
            content: JSON.stringify({ decisions: pairs.map((pair: any) => ({ pairId: pair.pairId, sameTopic: false })) }),
            finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, requestId: null,
          }
        },
      },
      model: 'test-model',
      maxTokens: 1_000,
    })

    expect(result).toMatchObject({
      aborted: true,
      abortReason: 'PROVIDER_FAILED',
      provider: {
        callsAttempted: 3, callsCompleted: 2, retries: 0,
        terminal: { state: 'failed', code: 'PROVIDER_UNAVAILABLE', status: 503, retryAfterMs: null },
      },
      cleanup: { fullProjection: 'not_created', incrementalProjection: 'not_created' },
      equivalence: { evaluated: false },
    })
    expect(result.provider.plannedCalls).toBeGreaterThanOrEqual(result.provider.callsAttempted)
    expect(result.provider.perCall).toHaveLength(3)
    expect(result.provider.perCall.map((call) => call.status)).toEqual(['succeeded', 'succeeded', 'failed'])
    expect(result.provider.perCall.every((call) => call.modelDurationMs >= 0 && call.queueWaitMs >= 0)).toBe(true)
  }, 30_000)
})
