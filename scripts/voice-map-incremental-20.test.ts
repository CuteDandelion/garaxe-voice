import { describe, expect, it } from 'vitest'
import { blinded100Input } from './voice-map-blinded-100-input'
import { heldOutFixture } from './voice-map-held-out-oracle'
import { independentHoldoutInput } from './voice-map-independent-10-input'
import { incrementalFeedbackBatches } from './voice-map-incremental-20-input'

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const words = (value: string) => new Set(normalized(value).split(' '))
const overlap = (left: string, right: string) => {
  const a = words(left); const b = words(right)
  return [...a].filter((word) => b.has(word)).length / Math.max(1, Math.min(a.size, b.size))
}

describe('incremental ingestion realistic corpus', () => {
  it('has two explicit ten-comment sources with unique IDs and no prior-corpus paraphrases', () => {
    expect(incrementalFeedbackBatches.map((batch) => batch.comments.length)).toEqual([10, 10])
    expect(new Set(incrementalFeedbackBatches.map((batch) => batch.source)).size).toBe(2)
    const comments = incrementalFeedbackBatches.flatMap((batch) => batch.comments)
    expect(new Set(comments.map((comment) => comment.id)).size).toBe(20)

    const prior = [...blinded100Input, ...heldOutFixture, ...independentHoldoutInput]
    for (const comment of comments) {
      expect(prior.some((item) => normalized(item.text) === normalized(comment.text))).toBe(false)
      expect(Math.max(...prior.map((item) => overlap(item.text, comment.text)))).toBeLessThan(0.6)
    }
  })
})
