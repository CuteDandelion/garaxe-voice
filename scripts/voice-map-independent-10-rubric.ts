import { independentHoldoutInput } from './voice-map-independent-10-input'

export type IndependentHoldoutGold = { id: string; category: 'pain' | 'desired_outcome' | 'objection' | 'emotion' | 'other'; topicGroup: string }

export const independentHoldoutRubric: IndependentHoldoutGold[] = [
  { id: 'independent-01', category: 'pain', topicGroup: 'allergen_substitution_safeguard' },
  { id: 'independent-02', category: 'pain', topicGroup: 'allergen_substitution_safeguard' },
  { id: 'independent-03', category: 'desired_outcome', topicGroup: 'bike_dock_reservation' },
  { id: 'independent-04', category: 'desired_outcome', topicGroup: 'bike_dock_reservation' },
  { id: 'independent-05', category: 'objection', topicGroup: 'rental_energy_monitor_permission' },
  { id: 'independent-06', category: 'objection', topicGroup: 'rental_energy_monitor_permission' },
  { id: 'independent-07', category: 'emotion', topicGroup: 'ticket_transfer_confirmation' },
  { id: 'independent-08', category: 'emotion', topicGroup: 'ticket_transfer_confirmation' },
  { id: 'independent-09', category: 'other', topicGroup: 'museum_audio_language_scope' },
  { id: 'independent-10', category: 'other', topicGroup: 'museum_audio_language_scope' },
]

type IndependentCoverage = {
  originalText: string
  disposition: string
  themeIds: string[]
  signals: Array<{ category?: string; quote: string; interpretedBy: string }>
}

export function evaluateIndependentHoldout(coverage: IndependentCoverage[]) {
  const inputById = new Map(independentHoldoutInput.map((item) => [item.id, item]))
  const observed = new Map(coverage.map((item) => [item.originalText, item]))
  const resolved = independentHoldoutRubric.map((gold) => ({ gold, item: observed.get(inputById.get(gold.id)!.text) }))
  const sharesTheme = (left?: IndependentCoverage, right?: IndependentCoverage) => Boolean(left && right && left.themeIds.some((id) => right.themeIds.includes(id)))
  let expectedMergePairs = 0
  let mergedExpectedPairs = 0
  let falseMergePairs = 0
  for (let left = 0; left < resolved.length; left += 1) for (let right = left + 1; right < resolved.length; right += 1) {
    const expected = resolved[left].gold.topicGroup === resolved[right].gold.topicGroup
    const merged = sharesTheme(resolved[left].item, resolved[right].item)
    if (expected) { expectedMergePairs += 1; if (merged) mergedExpectedPairs += 1 }
    else if (merged) falseMergePairs += 1
  }
  return {
    total: independentHoldoutRubric.length,
    covered: resolved.filter(({ item }) => item && ['recurring', 'emerging', 'user_curated'].includes(item.disposition)).length,
    categoryCorrect: resolved.filter(({ gold, item }) => item?.signals.some((signal) => signal.interpretedBy === 'analysis_engine' && signal.category === gold.category && item.originalText.includes(signal.quote))).length,
    expectedMergePairs,
    mergedExpectedPairs,
    falseMergePairs,
  }
}
