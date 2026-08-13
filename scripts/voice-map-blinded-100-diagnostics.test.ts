// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { classifyMissedPairs, type DiagnosticPairInput } from './voice-map-blinded-100-diagnostics'

const pair = (overrides: Partial<DiagnosticPairInput>): DiagnosticPairInput => ({
  leftId: 'blind-001', rightId: 'blind-021', expectedRelation: 'same_topic', topicGroup: 'invoice_tax_clarity', category: 'pain',
  leftCategory: 'pain', rightCategory: 'pain', similarity: 0.91, selected: true,
  adjudication: true, adjudicationHash: 'hash', projectedTogether: false,
  leftSourceHash: 'left-hash', rightSourceHash: 'right-hash', ...overrides,
})

describe('blinded 100-comment pair diagnostics', () => {
  it('classifies each missed pair at its first proven blocking stage', () => {
    const result = classifyMissedPairs([
      pair({ leftId: 'a', rightId: 'b', similarity: 0.83, selected: false, adjudication: null }),
      pair({ leftId: 'c', rightId: 'd', similarity: 0.90, selected: false, adjudication: null }),
      pair({ leftId: 'e', rightId: 'f', adjudication: false }),
      pair({ leftId: 'g', rightId: 'h', adjudication: true }),
      pair({ leftId: 'i', rightId: 'j', adjudication: null }),
    ])
    expect(result.counts).toEqual({
      candidate_not_generated: 1,
      candidate_generated_not_selected_or_bounded: 1,
      pair_adjudicated_false: 1,
      complete_link_blocked_by_rejected_or_missing_cross_pair: 2,
    })
    expect(result.pairs.map((item) => item.stage)).toEqual([
      'candidate_not_generated',
      'candidate_generated_not_selected_or_bounded',
      'pair_adjudicated_false',
      'complete_link_blocked_by_rejected_or_missing_cross_pair',
      'complete_link_blocked_by_rejected_or_missing_cross_pair',
    ])
  })

  it('treats a category mismatch as deterministic candidate ineligibility', () => {
    const result = classifyMissedPairs([pair({ leftCategory: 'pain', rightCategory: 'other', selected: false, adjudication: null })])
    expect(result.pairs[0]).toMatchObject({ stage: 'candidate_not_generated', reason: 'category_mismatch' })
  })

  it('rejects a diagnostic ledger that does not exclusively account for every miss', () => {
    expect(() => classifyMissedPairs([pair({ projectedTogether: true })])).toThrow(/not a missed pair/i)
  })
})
