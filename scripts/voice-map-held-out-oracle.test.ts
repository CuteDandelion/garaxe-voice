// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  assertHeldOutQuality,
  assertHeldOutReplayCategoryRepeatability,
  evaluateHeldOutCoverage,
  heldOutDemoRunIds,
  heldOutFixture,
  type HeldOutCoverageItem,
} from './voice-map-held-out-oracle'

const validCoverage = (): HeldOutCoverageItem[] => heldOutFixture.map((item) => ({
  reviewId: `review-${item.id}`,
  originalText: item.text,
  disposition: item.group ? 'recurring' : 'emerging',
  themeIds: item.group ? [`theme:${item.group}`] : [],
  signals: [{
    label: `${item.topicCues[0]} feedback`,
    aspect: item.topicCues.join(' '),
    category: item.expectedCategory,
    categories: [item.expectedCategory],
    signalType: item.expectedCategory,
    signalTypes: [item.expectedCategory],
    quote: item.quote,
    interpretedBy: 'analysis_engine',
  }],
}))

describe('held-out real-life Voice Map QA oracle', () => {
  it('defines a diversified public-anonymized corpus with a human-authored two-run rubric', () => {
    expect(heldOutFixture).toHaveLength(20)
    expect(new Set(heldOutFixture.map((item) => item.id)).size).toBe(20)
    expect(new Set(heldOutFixture.map((item) => item.sourceUrl).filter(Boolean)).size).toBeGreaterThanOrEqual(6)
    expect(new Set(heldOutFixture.map((item) => item.expectedCategory))).toEqual(new Set([
      'pain', 'desired_outcome', 'objection', 'emotion',
    ]))
    expect(heldOutFixture.some((item) => 'requiredSignalType' in item)).toBe(false)
    expect(heldOutDemoRunIds.map((run) => run.length)).toEqual([10, 10])
    expect(new Set(heldOutDemoRunIds.flat()).size).toBe(20)
    for (const group of new Set(heldOutFixture.flatMap((item) => item.group ? [item.group] : []))) {
      const runs = heldOutFixture.filter((item) => item.group === group)
        .map((item) => heldOutDemoRunIds.findIndex((run) => run.includes(item.id)))
      expect(new Set(runs).size, `${group} must remain inside one demo run`).toBe(1)
    }
  })

  it('keeps the explicit-feeling and concrete-concern rubric decisions stable', () => {
    expect(heldOutFixture.find((item) => item.id === 'heldout-07')).toMatchObject({
      expectedCategory: 'emotion',
      topic: 'command freeze frustration',
      topicCues: ['freeze', 'command', 'response'],
    })
    expect(heldOutFixture.find((item) => item.id === 'heldout-17')).toMatchObject({
      expectedCategory: 'emotion',
      topic: 'automatic compaction fear',
      topicCues: ['compact', 'context', 'instruction'],
    })
  })

  it('measures category, topic, grouping, grounding, and exact-once coverage without exact label prose', () => {
    const result = evaluateHeldOutCoverage(validCoverage())
    expect(result).toMatchObject({
      total: 20,
      covered: 20,
      exactQuotes: 20,
      categoryCorrect: 20,
      topicCorrect: 20,
      falseMergePairs: 0,
      missedMergePairs: 0,
      topicCoherence: 1,
    })
    expect(() => assertHeldOutQuality(result)).not.toThrow()
  })

  it('reports a semantic category error even when the quote remains exact', () => {
    const coverage = validCoverage()
    coverage[0].signals[0].category = 'desired_outcome'
    coverage[0].signals[0].categories = ['desired_outcome']
    const result = evaluateHeldOutCoverage(coverage)
    expect(result.categoryCorrect).toBe(19)
    expect(result.failures).toContain('heldout-01 category expected pain, received desired_outcome')
    expect(() => assertHeldOutQuality(result)).toThrow(/category expected pain/i)
  })

  it('reports a legacy category alias as an error', () => {
    const coverage = validCoverage()
    coverage[0].signals[0].category = 'primary_pain'
    expect(evaluateHeldOutCoverage(coverage).failures).toContain('heldout-01 category expected pain, received primary_pain')
  })

  it('maps feature-shaped feedback to desired outcomes without feature-request metadata', () => {
    const coverage = validCoverage()
    const feature = coverage[2].signals[0]
    expect(feature.category).toBe('desired_outcome')
    expect(feature.categories).toEqual(['desired_outcome'])
    expect(evaluateHeldOutCoverage(coverage).categoryCorrect).toBe(20)

    expect(feature.signalType).toBe('desired_outcome')
    expect(feature.signalTypes).toEqual(['desired_outcome'])
    expect(evaluateHeldOutCoverage(coverage).failures).toEqual([])
  })

  it('reports false merges, missed merges, and incoherent topics independently', () => {
    const coverage = validCoverage()
    coverage[0].themeIds = ['theme:wrong-merge']
    coverage[4].themeIds = ['theme:wrong-merge']
    coverage[9].signals[0].label = 'unrelated response'
    coverage[9].signals[0].aspect = 'unrelated response'
    const result = evaluateHeldOutCoverage(coverage)
    expect(result.missedMergePairs).toBeGreaterThan(0)
    expect(result.falseMergePairs).toBeGreaterThan(0)
    expect(result.topicCorrect).toBe(19)
    expect(result.topicCoherence).toBeLessThan(1)
  })

  it('uses the canonical topic field before the legacy aspect compatibility field', () => {
    const coverage = validCoverage()
    const signal = coverage[16].signals[0] as HeldOutCoverageItem['signals'][number] & { topic?: string }
    signal.label = 'unrelated wording'
    signal.aspect = 'unrelated wording'
    signal.topic = 'automatic compaction instructions'

    expect(evaluateHeldOutCoverage(coverage).topicCorrect).toBe(20)
  })

  it('reports a silent drop separately from model wording', () => {
    const coverage = validCoverage().slice(0, -1)
    const result = evaluateHeldOutCoverage(coverage)
    expect(result.covered).toBe(19)
    expect(result.failures).toContain('heldout-20 is missing from coverage')
  })

  it('requires every exact replay to satisfy category accuracy without averaging', () => {
    const first = validCoverage()
    const second = validCoverage()
    second[0].signals[0].category = 'desired_outcome'
    second[0].signals[0].categories = ['desired_outcome']
    expect(() => assertHeldOutReplayCategoryRepeatability([first, second])).toThrow(/replay 2.*19\/20/i)
    expect(assertHeldOutReplayCategoryRepeatability([first, validCoverage()])).toEqual({ replays: 2, categoryCorrectPerReplay: [20, 20] })
  })
})
