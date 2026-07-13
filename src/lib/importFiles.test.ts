import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileToCsv, jsonToCsv, pastedFeedbackToCsv, prepareImportFile, rowsToCsv } from './importFiles'
import { parseCsv } from './csv'

describe('feedback import formats', () => {
  it('serializes tabular rows without losing commas, quotes, or dates', () => {
    const csv = rowsToCsv([['review_text', 'review_date'], ['Helpful, "fast" team', new Date('2026-06-01T00:00:00Z')]])
    expect(parseCsv(csv).rows[0]).toEqual({ review_text: 'Helpful, "fast" team', review_date: '2026-06-01' })
  })

  it('normalizes JSON arrays and wrapped review arrays', () => {
    expect(parseCsv(jsonToCsv('[{"rating":5,"review_text":"Excellent"}]')).rows[0]).toMatchObject({ rating: '5', review_text: 'Excellent' })
    expect(parseCsv(jsonToCsv('{"reviews":[{"review_text":"Slow setup","metadata":{"plan":"pro"}}]}')).rows[0]).toMatchObject({ review_text: 'Slow setup', metadata: '{"plan":"pro"}' })
  })

  it('turns pasted lines into independent feedback records', () => {
    const parsed = parseCsv(pastedFeedbackToCsv('Friendly staff\nSetup took days'))
    expect(parsed.headers).toEqual(['review_text'])
    expect(parsed.rows).toHaveLength(2)
  })

  it('reads a real XLSX workbook into the canonical mapping path', async () => {
    const bytes = await readFile(resolve(process.cwd(), 'src/test/fixtures/reviews.xlsx'))
    const file = new File([bytes], 'reviews.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    if (!file.arrayBuffer) Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
    const parsed = parseCsv(await fileToCsv(file))
    expect(parsed.headers).toEqual(['review_id', 'source', 'rating', 'review_text', 'review_date'])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({ review_id: 'xlsx-1', rating: '5', review_date: '2026-06-01' })
    const prepared = await prepareImportFile(file)
    expect(prepared.originalSource).toMatchObject({ encoding: 'base64', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    expect(Buffer.from(prepared.originalSource.content, 'base64')).toEqual(bytes)
  })
})
