import { describe, expect, it } from 'vitest'
import { detectMapping, parseCsv, preflightCsv, sampleCsv, summarizeImport, validateImportRow } from './csv'

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
    expect(summary).toMatchObject({ total: 7, usable: 7, written: 7, ratingOnly: 0, duplicates: 0, invalid: 0 })
  })

  it('validates rows, retains identical text across distinct IDs, and deduplicates repeated IDs', () => {
    const parsed = parseCsv(`review_id,source,rating,rating_scale,review_text,review_date
a,Support,7,5,"The exact same sufficiently long customer comment.",2026-07-01
b,Support,2,5,"The exact same sufficiently long customer comment.",2026-07-01
c,Support,2,5,"The exact same sufficiently long customer comment.",2026-07-01
c,Support,3,5,"Different text but a duplicate external identifier.",2026-07-02
d,Support,4,5,"A valid but malformed-date record.",not-a-date
e,Support,4,5,"A fully valid customer review row.",2026-07-03`)
    expect(summarizeImport(parsed.rows, detectMapping(parsed.headers))).toMatchObject({
      total: 6, usable: 3, written: 3, ratingOnly: 0, duplicates: 1, invalid: 2,
    })
  })

  it('rejects unsafe source URLs and overlong feedback while allowing HTTPS and explicit loopback development URLs', () => {
    const mapping = { review_id: 'review_id', source: 'source', review_text: 'review_text', source_url: 'source_url' } as const
    const row = { review_id: 'a-1', source: 'Support', review_text: 'A useful customer comment.', source_url: 'https://example.com/review/1' }
    expect(validateImportRow(row, mapping).valid).toBe(true)
    expect(validateImportRow({ ...row, source_url: 'javascript:alert(1)' }, mapping)).toMatchObject({ valid: false, reason: 'invalid_source_url' })
    expect(validateImportRow({ ...row, source_url: 'http://example.com/review/1' }, mapping)).toMatchObject({ valid: false, reason: 'invalid_source_url' })
    expect(validateImportRow({ ...row, source_url: 'http://127.0.0.1:54321/review/1' }, mapping, { allowLoopbackHttp: true }).valid).toBe(true)
    expect(validateImportRow({ ...row, review_text: 'x'.repeat(10_001), source_url: '' }, mapping)).toMatchObject({ valid: false, reason: 'feedback_too_long' })
  })

  it('bounds CSV rows, columns, records, and cells before materializing an import', () => {
    expect(() => parseCsv(`${Array.from({ length: 101 }, (_, index) => `h${index}`).join(',')}\n${Array.from({ length: 101 }, () => 'x').join(',')}`)).toThrow(/100 columns/i)
    expect(() => parseCsv(`review_text\n${Array.from({ length: 101 }, () => 'x').join(',')}`)).toThrow(/100 columns/i)
    expect(() => parseCsv(`review_text\n${Array.from({ length: 10_001 }, () => 'short').join('\n')}`)).toThrow(/10,000 rows/i)
    expect(() => parseCsv(`review_text\n"${'x'.repeat(10_001)}"`)).toThrow(/10,000 characters/i)
  })

  it('requires stable ID, source, and comment mappings before import', () => {
    const parsed = parseCsv('comment,platform\nA useful comment,Support')
    expect(preflightCsv(parsed, detectMapping(parsed.headers))).toMatchObject({
      valid: false,
      columnErrors: [{ code: 'missing_required_column', field: 'review_id' }],
    })
  })

  it('requires unknown and duplicate columns to be resolved explicitly', () => {
    const parsed = parseCsv('id,source,comment,body,internal_flag\na-1,Support,Useful feedback,Duplicate text,secret')
    const mapping = detectMapping(parsed.headers)
    const result = preflightCsv(parsed, mapping)
    expect(result.valid).toBe(false)
    expect(result.columnErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate_mapping', field: 'review_text' }),
      expect.objectContaining({ code: 'unresolved_column', column: 'internal_flag' }),
    ]))
    expect(preflightCsv(parsed, { ...mapping, body: 'excluded', internal_flag: 'excluded' }).valid).toBe(true)
  })

  it('reports actionable row and column errors without silently accepting partial CSV rows', () => {
    const parsed = parseCsv('review_id,source,review_text,review_date,rating,rating_scale\na-1,Support,,not-a-date,7,5')
    const result = preflightCsv(parsed, detectMapping(parsed.headers))
    expect(result.valid).toBe(false)
    expect(result.rowErrors).toEqual(expect.arrayContaining([
      { row: 2, column: 'review_text', code: 'required_value_missing', message: 'Comment text is required.' },
      { row: 2, column: 'review_date', code: 'invalid_date', message: 'Use an ISO 8601 date such as 2026-08-13.' },
      { row: 2, column: 'rating', code: 'invalid_rating', message: 'Rating must be between 0 and the rating scale.' },
    ]))
    expect(() => parseCsv('review_id,source,review_text\na-1,Support')).toThrow(/row 2.*3 columns/i)
  })
})
