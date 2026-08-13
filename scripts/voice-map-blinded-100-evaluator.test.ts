// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { blinded100Input } from './voice-map-blinded-100-input'
import { blinded100PairRubric, blinded100Rubric } from './voice-map-blinded-100-rubric'
import { evaluateBlinded100, type BlindedCoverageItem } from './voice-map-blinded-100-evaluator'

const perfectCoverage = (): BlindedCoverageItem[] => blinded100Input.map((input) => {
  const gold = blinded100Rubric.find((item) => item.id === input.id)!
  return {
    originalText: input.text,
    themeIds: [`theme:${gold.mergeGroup}`],
    signals: [{
      category: gold.category,
      topic: gold.topicCues[0],
      label: `${gold.topicCues[0]} feedback`,
      quote: input.text.slice(0, 24),
      interpretedBy: 'analysis_engine',
    }],
  }
})

describe('blinded 100-comment Voice Map evaluation', () => {
  it('keeps per-comment gold and every reviewed pair outside the model-input fixture', () => {
    expect(blinded100Input).toHaveLength(100)
    expect(blinded100Rubric).toHaveLength(100)
    expect(new Set(blinded100Input.map((item) => item.id)).size).toBe(100)
    expect(new Set(blinded100Input.map((item) => item.text)).size).toBe(100)
    expect(blinded100Input.some((item) => 'category' in item || 'topicGroup' in item || 'topicCues' in item)).toBe(false)
    expect(Object.fromEntries(['pain', 'desired_outcome', 'objection', 'emotion', 'other'].map((category) => [
      category, blinded100Rubric.filter((item) => item.category === category).length,
    ]))).toEqual({ pain: 21, desired_outcome: 19, objection: 20, emotion: 20, other: 20 })
    expect(new Set(blinded100Rubric.map((item) => item.topicGroup)).size).toBe(20)
    expect(blinded100PairRubric).toHaveLength(200)
    expect(new Set(blinded100PairRubric.map((pair) => pair.pairId)).size).toBe(200)
    expect(blinded100PairRubric.filter((pair) => pair.expectedMerge)).toHaveLength(175)
    expect(blinded100PairRubric.filter((pair) => !pair.expectedMerge)).toHaveLength(25)
    expect(blinded100PairRubric.every((pair) => pair.rationale.length > 20
      && blinded100Rubric.some((item) => item.id === pair.leftId)
      && blinded100Rubric.some((item) => item.id === pair.rightId))).toBe(true)
    expect(blinded100PairRubric.find((pair) => pair.pairId === 'blind-007::blind-047')).toMatchObject({ expectedMerge: false })
    expect(blinded100PairRubric.find((pair) => pair.pairId === 'blind-004::blind-044')).toMatchObject({ expectedMerge: true })
    expect(blinded100PairRubric.find((pair) => pair.pairId === 'blind-004::blind-064')).toMatchObject({ expectedMerge: false })
    expect(blinded100PairRubric.find((pair) => pair.pairId === 'blind-017::blind-077')).toMatchObject({ expectedMerge: true })
    expect(blinded100PairRubric.find((pair) => pair.pairId === 'blind-017::blind-057')).toMatchObject({ expectedMerge: false })
    expect(blinded100PairRubric.find((pair) => pair.pairId === 'blind-020::blind-080')).toMatchObject({ expectedMerge: true })
    expect(blinded100PairRubric.find((pair) => pair.pairId === 'blind-020::blind-100')).toMatchObject({ expectedMerge: false })
  })

  it('reports independent perfect metrics and pair counts without a composite score', () => {
    const result = evaluateBlinded100(perfectCoverage())
    expect(result.sample).toEqual({ comments: 100, reviewedPairs: 200, positivePairs: 175, negativePairs: 4775 })
    expect(result.categoryAccuracy).toMatchObject({ successes: 100, total: 100, rate: 1 })
    expect(Object.fromEntries(Object.entries(result.perCategoryAccuracy).map(([category, value]) => [category, value.total])))
      .toEqual({ pain: 21, desired_outcome: 19, objection: 20, emotion: 20, other: 20 })
    expect(result.topicCoherence).toMatchObject({ successes: 100, total: 100, rate: 1 })
    expect(result.mergePrecision).toMatchObject({ successes: 175, total: 175, rate: 1 })
    expect(result.mergeRecall).toMatchObject({ successes: 175, total: 175, rate: 1 })
    expect(result.exactOnceCoverage).toMatchObject({ successes: 100, total: 100, rate: 1 })
    expect(result).not.toHaveProperty('overall')
    expect(result.limitations).toEqual(expect.arrayContaining([
      expect.stringMatching(/English/i), expect.stringMatching(/pairwise/i), expect.stringMatching(/single frozen-engine run/i),
    ]))
  })

  it('separates category, topic, false-merge, missed-merge, and coverage failures', () => {
    const coverage = perfectCoverage()
    coverage[0].signals[0].category = 'emotion'
    coverage[5].signals[0].topic = 'unrelated topic'
    coverage[5].signals[0].label = 'unrelated label'
    coverage[10].themeIds = ['theme:false-merge']
    coverage[15].themeIds = ['theme:false-merge']
    coverage[1].themeIds = ['theme:miss-a']
    coverage[21].themeIds = ['theme:miss-b']
    coverage.pop()

    const result = evaluateBlinded100(coverage)
    expect(result.categoryAccuracy.successes).toBe(98)
    expect(result.topicCoherence.successes).toBe(98)
    expect(result.mergePrecision.rate).toBeLessThan(1)
    expect(result.mergeRecall.rate).toBeLessThan(1)
    expect(result.exactOnceCoverage.successes).toBe(99)
    expect(result.falseMergePairs.length).toBeGreaterThan(0)
    expect(result.missedMergePairs.length).toBeGreaterThan(0)
    expect(result.categoryConfusion.pain.emotion).toBe(1)
  })
})
