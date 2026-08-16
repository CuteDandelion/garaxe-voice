import { describe, expect, it } from 'vitest'
import { prepareImportFile, rowsToCsv } from './importFiles'
import { parseCsv } from './csv'

describe('feedback import formats', () => {
  it('serializes tabular rows without losing commas, quotes, or dates', () => {
    const csv = rowsToCsv([['review_text', 'review_date'], ['Helpful, "fast" team', new Date('2026-06-01T00:00:00Z')]])
    expect(parseCsv(csv).rows[0]).toEqual({ review_text: 'Helpful, "fast" team', review_date: '2026-06-01' })
  })

  it('accepts CSV only and retains the exact selected source', async () => {
    const csv = 'review_id,source,review_text\na-1,Support,Helpful team'
    await expect(prepareImportFile(new File([csv], 'reviews.csv', { type: 'text/csv' }))).resolves.toMatchObject({
      rawCsv: csv,
      originalSource: { encoding: 'utf8', content: csv, mediaType: 'text/csv' },
    })
    await expect(prepareImportFile(new File(['{}'], 'reviews.json', { type: 'application/json' }))).rejects.toThrow(/CSV files only/i)
    await expect(prepareImportFile(new File(['feedback'], 'reviews.txt', { type: 'text/plain' }))).rejects.toThrow(/CSV files only/i)
  })
})
