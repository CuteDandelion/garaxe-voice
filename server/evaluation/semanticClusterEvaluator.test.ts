import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { scoreSemanticAssignments, validateSemanticFixture } from './semanticClusterEvaluator'

describe('semantic diversity evaluation', () => {
  it('loads a multi-industry fixture with three paraphrases per topic', () => {
    const fixture = validateSemanticFixture(JSON.parse(readFileSync(resolve('server/fixtures/semantic-diversity-gold.json'), 'utf8')))
    expect(fixture.cases).toHaveLength(24)
    expect(new Set(fixture.cases.map((item) => item.topic)).size).toBe(8)
  })

  it('scores cohesion, recall, coverage, and cross-topic merges independently', () => {
    const cases = [
      { id: 'a1', topic: 'a', text: 'one' }, { id: 'a2', topic: 'a', text: 'two' },
      { id: 'b1', topic: 'b', text: 'three' }, { id: 'b2', topic: 'b', text: 'four' },
    ]
    expect(scoreSemanticAssignments(cases, [0, 0, 1, -1])).toEqual({
      purity: 1,
      pairRecall: .5,
      coverage: .75,
      crossTopicMergeRate: 0,
      assigned: 3,
      total: 4,
      clusterCount: 2,
    })
    expect(scoreSemanticAssignments(cases, [0, 0, 0, 0]).crossTopicMergeRate).toBe(1)
  })
})
