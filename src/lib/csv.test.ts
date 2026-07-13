import { describe, expect, it } from 'vitest'
import { detectMapping, parseCsv, sampleCsv, summarizeImport } from './csv'

describe('CSV import utilities', () => {
  it('parses quoted values and detects canonical columns', () => {
    const parsed = parseCsv(sampleCsv)
    const mapping = detectMapping(parsed.headers)
    expect(parsed.rows).toHaveLength(7)
    expect(parsed.rows[0].review_text).toContain('setup took days')
    expect(mapping.review_text).toBe('review_text')
    expect(mapping.rating).toBe('rating')
  })

  it('reports written, rating-only, duplicate, and invalid rows', () => {
    const parsed = parseCsv(sampleCsv)
    const summary = summarizeImport(parsed.rows, detectMapping(parsed.headers))
    expect(summary).toMatchObject({ total: 7, usable: 5, written: 4, ratingOnly: 1, duplicates: 1, invalid: 1 })
  })

  it('validates rating against its scale, rejects malformed dates, and deduplicates exact text across IDs', () => {
    const parsed = parseCsv(`review_id,rating,rating_scale,review_text,review_date
a,7,5,"The exact same sufficiently long customer comment.",2026-07-01
b,2,5,"The exact same sufficiently long customer comment.",2026-07-01
c,2,5,"The exact same sufficiently long customer comment.",2026-07-01
c,3,5,"Different text but a duplicate external identifier.",2026-07-02
d,4,5,"A valid but malformed-date record.",not-a-date
e,4,5,"A fully valid customer review row.",2026-07-03`)
    expect(summarizeImport(parsed.rows, detectMapping(parsed.headers))).toMatchObject({
      total: 6, usable: 2, written: 2, ratingOnly: 0, duplicates: 2, invalid: 2,
    })
  })
})
