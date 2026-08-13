// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/lib/csv'
import { balancedCategoryDemoRunIds, balancedCategoryFixture, controlledDemoRunIds, controlledFixture, malformedInputExpectations, praiseRubricCases, validateBalancedCategoryCoverage, validateControlledCoverage, validatePraiseRubricCoverage } from './voice-map-controlled-oracle'

const validCoverage = () => controlledFixture.map((item) => ({
  reviewId: `internal-${item.id}`,
  originalText: item.text,
  disposition: item.group ? 'recurring' : 'emerging',
  reason: 'Controlled result.',
  themeIds: item.group ? [`theme:${item.group}`] : [],
  signals: [{
    label: `${item.group || item.id} signal`, signalType: item.categories[0], signalTypes: [item.categories[0]], categories: item.categories,
    category: item.categories[0], confidence: .72, quote: item.quote, interpretedBy: 'analysis_engine',
  }],
}))

describe('controlled Voice Map QA oracle', () => {
  it('defines 30 unique consent-safe rows and rejects generic or missing engine categories', async () => {
    const parsed = parseCsv(await readFile(new URL('../server/fixtures/voice-map-controlled-30.csv', import.meta.url), 'utf8'))
    expect(parsed.rows).toHaveLength(30)
    expect(new Set(parsed.rows.map((row) => row.review_id)).size).toBe(30)
    expect(controlledFixture).toHaveLength(30)
    expect(parsed.rows.map((row) => row.review_text)).toEqual(controlledFixture.map((item) => item.text))
    expect(controlledFixture[0].text).toBe(controlledFixture[1].text)
    expect(malformedInputExpectations).toHaveLength(2)
    expect(controlledDemoRunIds.map((run) => run.length)).toEqual([10, 10, 10])
    expect(new Set(controlledDemoRunIds.flat()).size).toBe(30)
    expect(new Set(controlledFixture.flatMap((item) => item.categories))).toEqual(new Set([
      'pain', 'desired_outcome', 'objection', 'emotion',
    ]))
    expect(controlledFixture.every((item) => item.categories.length === 1)).toBe(true)
    expect(controlledFixture.some((item) => 'requiredSignalType' in item)).toBe(false)
    for (const group of new Set(controlledFixture.flatMap((item) => item.group ? [item.group] : []))) {
      const runIndexes = controlledFixture
        .filter((item) => item.group === group)
        .map((item) => controlledDemoRunIds.findIndex((run) => run.some((id) => id === item.id)))
      expect(new Set(runIndexes).size, `${group} must not be split across demo runs`).toBe(1)
    }

    const coverage = validCoverage()
    expect(validateControlledCoverage(coverage)).toEqual({ covered: 30, exactQuotes: 30, categoryMatches: 30 })

    coverage[0].signals[0].label = 'Insufficient validated evidence'
    expect(() => validateControlledCoverage(coverage)).toThrow(/generic label/i)
  })

  it('fails broken expected merges and unrelated same-category topic merges', () => {
    const brokenMerge = validCoverage()
    brokenMerge[0].themeIds = ['theme:orphaned-export']
    expect(() => validateControlledCoverage(brokenMerge)).toThrow(/expected merge group export_stall/i)

    const unrelatedMerge = validCoverage()
    for (const item of unrelatedMerge.slice(14, 16)) item.themeIds = ['theme:export_stall']
    expect(() => validateControlledCoverage(unrelatedMerge)).toThrow(/expected separate topic groups export_stall and billing_clarity/i)
  })

  it('fails category guesses and quotes that are not exact source spans', () => {
    const wrongCategory = validCoverage()
    wrongCategory[8].signals[0].signalType = 'desired_outcome'
    wrongCategory[8].signals[0].category = 'desired_outcome'
    wrongCategory[8].signals[0].categories = ['desired_outcome']
    expect(() => validateControlledCoverage(wrongCategory)).toThrow(/controlled-09 expected objection, received desired_outcome/i)

    const inventedQuote = validCoverage()
    inventedQuote[18].signals[0].quote = 'The password reset was painfully slow.'
    expect(() => validateControlledCoverage(inventedQuote)).toThrow(/engine-categorized exact source quote for controlled-19/i)
  })

  it('accepts a different exact source span without coupling the model to fixture prose', () => {
    const coverage = validCoverage()
    coverage[24].signals[0].quote = 'the answer did not explain'
    expect(validateControlledCoverage(coverage).exactQuotes).toBe(30)
  })

  it('requires every one of the 30 source records exactly once, including true duplicates', () => {
    const silentDrop = validCoverage()
    silentDrop[29] = structuredClone(silentDrop[2])
    expect(() => validateControlledCoverage(silentDrop)).toThrow(/too many copies/i)
  })

  it('requires all four categories with exact supporting IDs and counts in the balanced matrix', () => {
    expect(balancedCategoryFixture.map((item) => item.id)).toEqual([
      'controlled-15', 'controlled-16',
      'controlled-05', 'controlled-06',
      'controlled-09', 'controlled-10',
      'controlled-12', 'controlled-13',
    ])
    expect(balancedCategoryDemoRunIds).toHaveLength(8)
    const balancedIds = new Set<string>(balancedCategoryDemoRunIds)
    const coverage = validCoverage().filter((item) => balancedIds.has(
      controlledFixture.find((fixture) => fixture.text === item.originalText)!.id,
    ))
    expect(validateBalancedCategoryCoverage(coverage)).toEqual({
      covered: 8,
      categoryCounts: { pain: 2, desired_outcome: 2, objection: 2, emotion: 2 },
    })
  })

  it('rejects a category substitution even when evidence and total coverage remain valid', () => {
    const balancedIds = new Set<string>(balancedCategoryDemoRunIds)
    const coverage = validCoverage().filter((item) => balancedIds.has(
      controlledFixture.find((fixture) => fixture.text === item.originalText)!.id,
    ))
    const pain = coverage.find((item) => item.originalText === controlledFixture.find((item) => item.id === 'controlled-15')!.text)!
    pain.signals[0].category = 'desired_outcome'
    pain.signals[0].signalType = 'desired_outcome'
    pain.signals[0].categories = ['desired_outcome']
    expect(() => validateBalancedCategoryCoverage(coverage)).toThrow(/controlled-15 expected pain, received desired_outcome/i)
  })

  it('rejects legacy public category aliases instead of accepting parallel vocabularies', () => {
    const coverage = validCoverage()
    coverage[0].signals[0].category = 'primary_pain' as never
    expect(() => validateControlledCoverage(coverage)).toThrow(/controlled-01 expected pain, received primary_pain/i)
  })

  it('maps feature-shaped feedback to desired outcomes without a feature-request category', () => {
    const coverage = validCoverage()
    const feature = coverage.find((item) => item.originalText === controlledFixture.find((item) => item.id === 'controlled-17')!.text)!
    feature.signals[0].category = 'feature_request' as never
    expect(() => validateControlledCoverage(coverage)).toThrow(/controlled-17 expected desired_outcome, received feature_request/i)

    feature.signals[0].category = 'desired_outcome'
    feature.signals[0].signalType = 'desired_outcome'
    feature.signals[0].signalTypes = ['desired_outcome']
    expect(validateControlledCoverage(coverage).categoryMatches).toBe(30)
  })

  it('distinguishes achieved-value praise from generic affective praise', () => {
    const coverage = praiseRubricCases.map((item) => ({
      originalText: item.text,
      signals: [{
        category: item.expectedCategory,
        signalType: item.expectedSignalType,
        signalTypes: [item.expectedSignalType],
        sentiment: item.expectedSentiment,
        quote: item.quote,
        interpretedBy: 'analysis_engine',
      }],
    }))
    expect(validatePraiseRubricCoverage(coverage)).toEqual({ covered: 2, positive: 2 })

    coverage[0].signals[0].category = 'emotion'
    expect(() => validatePraiseRubricCoverage(coverage)).toThrow(/achieved-value-praise expected desired_outcome/i)

    coverage[0].signals[0].category = 'desired_outcome'
    coverage[0].signals[0].sentiment = 'negative' as never
    expect(() => validatePraiseRubricCoverage(coverage)).toThrow(/achieved-value-praise expected positive/i)
  })
})
