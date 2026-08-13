import { describe, expect, it } from 'vitest'
import { blinded100Input } from './voice-map-blinded-100-input'
import { blinded100Rubric } from './voice-map-blinded-100-rubric'
import { independentHoldoutInput } from './voice-map-independent-10-input'
import { evaluateIndependentHoldout, independentHoldoutRubric } from './voice-map-independent-10-rubric'

const normalizedTokens = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
const shingles = (text: string) => {
  const tokens = normalizedTokens(text)
  return new Set(tokens.slice(0, -3).map((_, index) => tokens.slice(index, index + 4).join(' ')))
}

describe('independent realistic holdout', () => {
  it('accounts for ten blind inputs and two examples in each category', () => {
    expect(independentHoldoutInput).toHaveLength(10)
    expect(new Set(independentHoldoutInput.map((item) => item.id)).size).toBe(10)
    expect(new Set(independentHoldoutInput.map((item) => item.text)).size).toBe(10)
    expect(independentHoldoutRubric.map((item) => item.id).sort()).toEqual(independentHoldoutInput.map((item) => item.id).sort())
    for (const category of ['pain', 'desired_outcome', 'objection', 'emotion', 'other']) {
      expect(independentHoldoutRubric.filter((item) => item.category === category)).toHaveLength(2)
    }
    expect([...new Set(independentHoldoutRubric.map((item) => item.topicGroup))]).toHaveLength(5)
  })

  it('keeps gold labels outside model inputs', () => {
    for (const item of independentHoldoutInput) {
      expect(Object.keys(item).sort()).toEqual(['id', 'sourceUrl', 'text'])
      expect(item.text).not.toMatch(/pain|desired.?outcome|objection|emotion|other|merge.?group/i)
    }
  })

  it('is topic- and paraphrase-disjoint from blinded-100', () => {
    const blindedTopics = new Set(blinded100Rubric.map((item) => item.topicGroup))
    for (const item of independentHoldoutRubric) expect(blindedTopics).not.toContain(item.topicGroup)

    const blindedTexts = new Set(blinded100Input.map((item) => item.text.toLowerCase()))
    const blindedShingles = new Set(blinded100Input.flatMap((item) => [...shingles(item.text)]))
    for (const item of independentHoldoutInput) {
      expect(blindedTexts).not.toContain(item.text.toLowerCase())
      expect([...shingles(item.text)].filter((value) => blindedShingles.has(value))).toEqual([])
    }
  })

  it('reports category and grouping quality without turning the rubric into a runtime veto', () => {
    const coverage = independentHoldoutInput.map((item, index) => ({
      reviewId: `review-${index + 1}`,
      originalText: item.text,
      disposition: 'recurring',
      themeIds: [`theme-${Math.floor(index / 2) + 1}`],
      signals: [{ category: independentHoldoutRubric[index].category, quote: item.text, interpretedBy: 'analysis_engine' }],
    }))
    expect(evaluateIndependentHoldout(coverage)).toEqual({
      total: 10,
      covered: 10,
      categoryCorrect: 10,
      expectedMergePairs: 5,
      mergedExpectedPairs: 5,
      falseMergePairs: 0,
    })
  })
})
