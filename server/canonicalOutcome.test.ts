import { describe, expect, it } from 'vitest'
import {
  CANONICAL_CATEGORIES,
  CANONICAL_SIGNAL_TYPES,
  SIGNAL_TAXONOMY_VERSION,
  canonicalOutcome,
} from './canonicalOutcome'

const base = {
  label: 'Fast issue resolution',
  topic: 'support resolution speed',
  confidence: 0.8,
  proposedTypeLabel: null,
  evidence: { reviewId: 'review-1', quoteText: 'support resolved my issue quickly' },
}

describe('canonical semantic taxonomy', () => {
  it('exposes only four primary semantic categories plus other', () => {
    expect(CANONICAL_SIGNAL_TYPES).toEqual(['pain', 'desired_outcome', 'objection', 'emotion', 'other'])
    expect(CANONICAL_CATEGORIES).toEqual(['pain', 'desired_outcome', 'objection', 'emotion', 'other'])
    expect(SIGNAL_TAXONOMY_VERSION).toBe('voice-signal-taxonomy-v2')
  })

  it('keeps sentiment orthogonal to a concrete achieved desired outcome', () => {
    expect(canonicalOutcome({
      ...base,
      signalTaxonomyVersion: 'voice-signal-taxonomy-v2',
      primaryCategory: 'desired_outcome',
      primarySignalType: 'desired_outcome',
      signalTypes: ['desired_outcome'],
      sentiment: 'positive',
    })).toMatchObject({ primaryCategory: 'desired_outcome', primarySignalType: 'desired_outcome', sentiment: 'positive' })
  })

  it('rejects a taxonomy-v2 outcome that omits sentiment', () => {
    expect(canonicalOutcome({
      ...base,
      signalTaxonomyVersion: 'voice-signal-taxonomy-v2',
      primaryCategory: 'emotion',
      primarySignalType: 'emotion',
      signalTypes: ['emotion'],
    })).toBeNull()
  })

  it('reads legacy removed types through the four-category projection without rewriting provenance', () => {
    expect(canonicalOutcome({
      ...base,
      signalTaxonomyVersion: 'voice-signal-taxonomy-v1',
      primaryCategory: 'feature_request',
      primarySignalType: 'feature_request',
      signalTypes: ['feature_request'],
    })).toMatchObject({
      signalTaxonomyVersion: 'voice-signal-taxonomy-v1',
      primaryCategory: 'desired_outcome',
      primarySignalType: 'desired_outcome',
      sentiment: 'neutral',
    })
  })
})
