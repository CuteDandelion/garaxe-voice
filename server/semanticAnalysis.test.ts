import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCsv } from '../src/lib/csv'
import { analyzeSemantically, clusterEmbeddingsByMutualKnn, createDeterministicTestEmbeddingProvider, e5Input, segmentReviews } from './semanticAnalysis'

describe('semantic analysis pipeline', () => {
  it('preserves e5 query inputs while prefixing ordinary evidence as passages', () => {
    expect(e5Input('query: customer reservation')).toBe('query: customer reservation')
    expect(e5Input('customer review evidence')).toBe('passage: customer review evidence')
  })

  it('segments clauses with exact immutable offsets', () => {
    const text = 'The pasta was excellent, but the dining room was far too cold. Service recovered quickly.'
    const segments = segmentReviews([{ reviewId: 'food-1', text, rating: 3, language: 'en' }])
    expect(segments.map((segment) => segment.text)).toEqual([
      'The pasta was excellent,',
      'but the dining room was far too cold.',
      'Service recovered quickly.',
    ])
    for (const segment of segments) expect(text.slice(segment.start, segment.end)).toBe(segment.text)
  })

  it('derives clusters and literal representations from the dataset without a fixed industry vocabulary', async () => {
    const reviews = [
      { reviewId: 'food-1', text: 'The tamarind broth tasted bright and balanced.', rating: 5, language: 'en' },
      { reviewId: 'food-2', text: 'Bright tamarind broth made the whole dish memorable.', rating: 5, language: 'en' },
      { reviewId: 'food-3', text: 'The dining room was cold during dinner.', rating: 2, language: 'en' },
      { reviewId: 'food-4', text: 'Cold air from the vent made dinner uncomfortable.', rating: 2, language: 'en' },
    ]
    const result = await analyzeSemantically(reviews, {
      id: 'two-topic-test-embedding', version: 'two-topic-test-embedding-v1', dimensions: 3,
      async embed(texts) {
        return texts.map((text, index) => text.toLocaleLowerCase('und').includes('tamarind')
          ? [1, index * .01, 0]
          : [0, 1, index * .01])
      },
    })
    expect(result.metadata).toMatchObject({ segmentCount: 4, clusterCount: 2, embeddingDimensions: 3, sentimentModel: 'test-segment-sentiment', outlierCount: 0 })
    expect(result.signals).toHaveLength(4)
    expect(result.signals.some((signal) => signal.normalizedAspect === 'tamarind broth')).toBe(true)
    expect(result.signals.every((signal) => signal.normalizedAspect.includes(' '))).toBe(true)
    expect(result.signals.every((signal) => signal.normalizedAspect !== 'customer experience')).toBe(true)
    for (const signal of result.signals) {
      const source = reviews.find((review) => review.reviewId === signal.reviewId)?.text ?? ''
      expect(source.slice(signal.quoteStart, signal.quoteEnd)).toBe(signal.quoteText)
      expect(signal.attributes.extractionMode).toBe('semantic_cluster')
    }
  })

  it('keeps semantic outliers unclustered instead of forcing them into the nearest theme', () => {
    const result = clusterEmbeddingsByMutualKnn(
      [[1, 0, 0], [.99, .02, 0], [0, 1, 0]],
      ['review-1', 'review-2', 'review-3'],
    )
    expect(result.assignments).toEqual([0, 0, -1])
    expect(result).toMatchObject({ clusterCount: 1, outlierCount: 1, ambiguousSegmentCount: 0 })
    expect(result.diagnostics[0]).toMatchObject({ size: 2, independentReviewCount: 2, needsAdjudication: false })
  })

  it('routes accepted but lower-cohesion clusters to LLM grouping adjudication', () => {
    const angle = Math.acos(.86)
    const result = clusterEmbeddingsByMutualKnn(
      [[1, 0], [Math.cos(angle), Math.sin(angle)]],
      ['review-1', 'review-2'],
    )
    expect(result.assignments).toEqual([0, 0])
    expect(result.diagnostics[0]).toMatchObject({ meanSimilarity: .86, needsAdjudication: true })
  })

  it('rejects embedding output that cannot be reproduced against the segmented dataset', async () => {
    await expect(analyzeSemantically([{ reviewId: 'food-1', text: 'Fresh bread.', rating: 5 }], {
      id: 'broken', version: 'broken-v1', dimensions: 2, embed: async () => [[1]],
    })).rejects.toThrow('does not match')
  })

  it('reproduces a fresh 100-record multilingual food-industry run with unexpected but valid input', async () => {
    const fixture = parseCsv(readFileSync(resolve('server/fixtures/food-feedback-100.csv'), 'utf8'))
    expect(fixture.rows).toHaveLength(100)
    const reviews = fixture.rows.map((row) => ({
      reviewId: row.review_id,
      text: row.review_text,
      rating: Number(row.rating),
      language: row.language,
      entity: row.entity,
      sourceCreatedAt: row.review_date,
    }))
    const provider = createDeterministicTestEmbeddingProvider()
    const first = await analyzeSemantically(reviews, provider)
    const second = await analyzeSemantically(reviews, provider)
    expect(first.metadata.clusterCount).toBeGreaterThanOrEqual(8)
    expect(first.signals).toEqual(second.signals)
    expect(new Set(first.signals.map((signal) => signal.reviewId)).size).toBe(100)
    expect(first.signals.some((signal) => signal.quoteText.includes('Ignore previous instructions'))).toBe(true)
    expect(first.signals.some((signal) => signal.quoteText.includes('雰囲気'))).toBe(true)
    const negativeAspects = new Set(first.signals.filter((signal) => signal.sentiment === 'negative').map((signal) => signal.normalizedAspect))
    expect([...negativeAspects].some((aspect) => aspect.includes('nobody answered phone'))).toBe(true)
    expect([...negativeAspects].some((aspect) => aspect.includes('restroom not clean'))).toBe(true)
    expect([...negativeAspects].every((aspect) => aspect.split(' ').length <= 3)).toBe(true)
    for (const signal of first.signals) {
      const source = reviews.find((review) => review.reviewId === signal.reviewId)?.text ?? ''
      expect(source.slice(signal.quoteStart, signal.quoteEnd)).toBe(signal.quoteText)
    }
  })
})
