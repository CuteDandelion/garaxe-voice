import { blinded100Input } from './voice-map-blinded-100-input'
import { blinded100PairRubric, blinded100Rubric, type Blinded100Category } from './voice-map-blinded-100-rubric'

export type BlindedCoverageItem = {
  originalText?: string
  themeIds?: string[]
  signals: Array<{ category?: string; topic?: string | null; aspect?: string; label?: string; quote?: string; interpretedBy?: string }>
}

type Metric = { successes: number; total: number; rate: number | null; ci95Wilson: [number, number] | null }
const categories: Blinded100Category[] = ['pain', 'desired_outcome', 'objection', 'emotion', 'other']

const metric = (successes: number, total: number): Metric => {
  if (total === 0) return { successes, total, rate: null, ci95Wilson: null }
  const rate = successes / total
  const z = 1.959963984540054
  const denominator = 1 + (z * z) / total
  const centre = (rate + (z * z) / (2 * total)) / denominator
  const margin = z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * total)) / total) / denominator
  return { successes, total, rate, ci95Wilson: [Math.max(0, centre - margin), Math.min(1, centre + margin)] }
}

const sharesTheme = (left?: string[], right?: string[]) =>
  Boolean(left?.some((themeId) => right?.includes(themeId)))

export function evaluateBlinded100(coverage: BlindedCoverageItem[]) {
  const inputByText = new Map(blinded100Input.map((item) => [item.text, item]))
  const goldById = new Map(blinded100Rubric.map((item) => [item.id, item]))
  const pairGoldById = new Map(blinded100PairRubric.map((pair) => [pair.pairId, pair]))
  const coverageById = new Map<string, BlindedCoverageItem[]>()
  for (const item of coverage) {
    const input = inputByText.get(item.originalText || '')
    if (!input) continue
    coverageById.set(input.id, [...(coverageById.get(input.id) || []), item])
  }

  const categoryConfusion = Object.fromEntries(categories.map((category) => [category, {} as Record<string, number>])) as Record<Blinded100Category, Record<string, number>>
  const perCategorySuccess = Object.fromEntries(categories.map((category) => [category, 0])) as Record<Blinded100Category, number>
  let exactOnce = 0
  let exactQuotes = 0
  let categorySuccesses = 0
  let topicSuccesses = 0

  for (const input of blinded100Input) {
    const gold = goldById.get(input.id)!
    const rows = coverageById.get(input.id) || []
    const engineSignals = rows.length === 1
      ? rows[0].signals.filter((signal) => signal.interpretedBy === 'analysis_engine') : []
    if (rows.length === 1 && engineSignals.length === 1) exactOnce += 1
    const signal = engineSignals.length === 1 ? engineSignals[0] : undefined
    const received = signal?.category || '<missing>'
    categoryConfusion[gold.category][received] = (categoryConfusion[gold.category][received] || 0) + 1
    if (received === gold.category) {
      categorySuccesses += 1
      perCategorySuccess[gold.category] += 1
    }
    if (signal?.quote && input.text.includes(signal.quote)) exactQuotes += 1
    const topicText = `${signal?.label || ''} ${signal?.topic || signal?.aspect || ''}`.toLowerCase()
    if (gold.topicCues.some((cue) => topicText.includes(cue))) topicSuccesses += 1
  }

  let positivePairs = 0
  let negativePairs = 0
  let truePositivePairs = 0
  let predictedPositivePairs = 0
  const falseMergePairs: string[] = []
  const missedMergePairs: string[] = []
  for (let leftIndex = 0; leftIndex < blinded100Rubric.length; leftIndex += 1) {
    const left = blinded100Rubric[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < blinded100Rubric.length; rightIndex += 1) {
      const right = blinded100Rubric[rightIndex]
      const expectedMerge = pairGoldById.get([left.id, right.id].sort().join('::'))?.expectedMerge === true
      const leftRows = coverageById.get(left.id) || []
      const rightRows = coverageById.get(right.id) || []
      const predictedMerge = leftRows.length === 1 && rightRows.length === 1
        && sharesTheme(leftRows[0].themeIds, rightRows[0].themeIds)
      if (expectedMerge) positivePairs += 1
      else negativePairs += 1
      if (predictedMerge) predictedPositivePairs += 1
      if (expectedMerge && predictedMerge) truePositivePairs += 1
      else if (!expectedMerge && predictedMerge) falseMergePairs.push(`${left.id}::${right.id}`)
      else if (expectedMerge) missedMergePairs.push(`${left.id}::${right.id}`)
    }
  }

  const perCategoryAccuracy = Object.fromEntries(categories.map((category) => [category, metric(
    perCategorySuccess[category], blinded100Rubric.filter((item) => item.category === category).length,
  )])) as Record<Blinded100Category, Metric>
  return {
    sample: { comments: blinded100Input.length, reviewedPairs: blinded100PairRubric.length, positivePairs, negativePairs },
    exactOnceCoverage: metric(exactOnce, blinded100Input.length),
    exactQuoteRate: metric(exactQuotes, blinded100Input.length),
    categoryAccuracy: metric(categorySuccesses, blinded100Input.length),
    perCategoryAccuracy,
    topicCoherence: metric(topicSuccesses, blinded100Input.length),
    mergePrecision: metric(truePositivePairs, predictedPositivePairs),
    mergeRecall: metric(truePositivePairs, positivePairs),
    categoryConfusion,
    falseMergePairs,
    missedMergePairs,
    limitations: [
      'The corpus is near-balanced, English-only, consent-safe synthetic public-style feedback; it is not prevalence-weighted customer data.',
      'Twenty topic families and 26 reviewed merge groups, not 100 comments, are the closer effective independent sample because paraphrases within a group are related.',
      'Pairwise merge observations are correlated; Wilson intervals on pair metrics are descriptive sensitivity ranges, not independent-pair inference.',
      'Topic coherence is lexical alignment with externally authored cue families, not an independent human semantic rating.',
      'This report measures a single frozen-engine run and cannot establish provider repeatability or multilingual performance.',
    ],
  }
}
