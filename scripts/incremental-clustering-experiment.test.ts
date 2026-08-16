// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { canonicalEmbeddings, runIncrementalClusteringExperiment, runLiveProviderDifferentialReplay, runPinnedDifferentialReplay } from './incremental-clustering-experiment'

describe('local incremental clustering experiment', () => {
  it('assigns only appended reviews while preserving full evidence and topic membership', async () => {
    const result = await runIncrementalClusteringExperiment()

    expect(result.dataset).toEqual({ initialReviews: 10, appendedReviews: 20, totalReviews: 30, sourceCount: 3, missingDateCount: 10 })
    expect(result.equivalence).toEqual({
      exact: true,
      evidenceCount: 30,
      uniqueEvidenceCount: 30,
      fullFingerprint: result.equivalence.incrementalFingerprint,
      incrementalFingerprint: result.equivalence.incrementalFingerprint,
      fullEvidenceFingerprint: result.equivalence.incrementalEvidenceFingerprint,
      incrementalEvidenceFingerprint: result.equivalence.incrementalEvidenceFingerprint,
      fullProvenanceFingerprint: result.equivalence.incrementalProvenanceFingerprint,
      incrementalProvenanceFingerprint: result.equivalence.incrementalProvenanceFingerprint,
    })
    expect(result.incremental.embeddedReviews).toBe(20)
    expect(result.incremental.candidateCount).toBeLessThan(result.full.candidateCount)
    expect(result.full.providerCalls).toBe(0)
    expect(result.incremental.providerCalls).toBe(0)
    expect(result.incremental.modelRequestEquivalents.total).toBeLessThan(result.full.modelRequestEquivalents.total)
    expect(result.full).not.toHaveProperty('value')
    expect(result.incremental).not.toHaveProperty('value')
    expect(result.persistence).toEqual({ embeddings: 30, representatives: 15, lineage: 30 })
    expect(result.equivalence.fullEvidenceFingerprint).toBe(result.equivalence.incrementalEvidenceFingerprint)
    expect(result.equivalence.fullProvenanceFingerprint).toBe(result.equivalence.incrementalProvenanceFingerprint)
    expect(result.persistenceTransactions).toEqual({ initial: 1, incremental: 1, total: 2 })
    expect(result.full.wallMs).toBeGreaterThanOrEqual(0)
    expect(result.incremental.wallMs).toBeGreaterThanOrEqual(0)
    expect(result.full.cpuMs).toBeGreaterThanOrEqual(0)
    expect(result.incremental.cpuMs).toBeGreaterThanOrEqual(0)
  }, 15_000)
})

describe('pinned embedding differential replay seam', () => {
  it('returns the same canonical vectors independent of input batch partition', async () => {
    const provider = {
      id: 'partition-sensitive', version: 'partition-sensitive-v1', dimensions: 2,
      embed: async (texts: string[]) => texts.map((text) => [text.length, texts.length]),
    }
    const together = await canonicalEmbeddings(provider, new Map(), ['  Same   review ', 'Second review'])
    const partitionedCache = new Map<string, number[]>()
    const partitioned = [
      ...(await canonicalEmbeddings(provider, partitionedCache, ['same review'])),
      ...(await canonicalEmbeddings(provider, partitionedCache, ['Second review'])),
    ]

    expect(together).toEqual(partitioned)
    expect(await canonicalEmbeddings(provider, partitionedCache, ['SAME REVIEW'])).toEqual([partitioned[0]])
  })

  it('uses saved decisions and equal batched persistence on both compared paths', async () => {
    const result = await runPinnedDifferentialReplay({
      id: 'test-real-shape', version: 'test-real-shape-v1', dimensions: 4,
      embed: async (texts) => texts.map((text) => [
        Number(/library|book pickup/.test(text)),
        Number(/market|vendor/.test(text)),
        Number(/locker/.test(text)),
        Number(!/library|book pickup|market|vendor|locker/.test(text)),
      ]),
    })

    expect(result.embedding).toEqual({ id: 'test-real-shape', version: 'test-real-shape-v1', dimensions: 4 })
    expect(result.canonicalization).toMatchObject({ cacheEntries: 30, embeddingInferenceCalls: 30 })
    expect(result.savedAdjudicationOutputs).toBe(435)
    expect(result.full.persistenceTransactions).toBe(1)
    expect(result.incremental.persistenceTransactions).toBe(1)
    expect(result.full.providerCalls).toBe(0)
    expect(result.incremental.providerCalls).toBe(0)
    expect(result.equivalence).toMatchObject({ exact: true, topic: true, evidence: true, provenance: true })
    expect(Array.isArray(result.equivalence.membershipDifference.onlyFull)).toBe(true)
    expect(Array.isArray(result.equivalence.membershipDifference.onlyIncremental)).toBe(true)
    expect(Array.isArray(result.equivalence.differingPairSimilarities)).toBe(true)
  }, 15_000)
})

describe('isolated live-provider differential seam', () => {
  it('runs the two paths sequentially with exact validated outputs and no retries', async () => {
    let active = 0
    let peakActive = 0
    const result = await runLiveProviderDifferentialReplay({
      embeddingProvider: {
        id: 'partition-safe', version: 'partition-safe-v1', dimensions: 4,
        embed: async (texts) => texts.map((text) => [
          Number(/library|book pickup/.test(text)), Number(/market|vendor/.test(text)),
          Number(/locker/.test(text)), Number(!/library|book pickup|market|vendor|locker/.test(text)),
        ]),
      },
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
    expect(result.equivalence).toMatchObject({ exact: true, topic: true, evidence: true, provenance: true })
    expect(result.full.retries).toBe(0)
    expect(result.incremental.retries).toBe(0)
    expect(result.full.completedAt).toBeLessThanOrEqual(result.incremental.startedAt)
  }, 20_000)
})
