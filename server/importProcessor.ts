import { createHash, randomUUID } from 'node:crypto'
import type { Database } from './database'
import { normalizeImportText, parseCsv, summarizeImport, validateImportRow, type CanonicalField, type ColumnMapping, type CsvRow } from '../src/lib/csv'

type ImportRequest = {
  projectId: string
  fileName: string
  rawCsv: string
  mapping: ColumnMapping
  originalSource: { encoding: 'utf8' | 'base64'; content: string; mediaType: string }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function mappedValue(row: CsvRow, mapping: ColumnMapping, field: CanonicalField) {
  const column = Object.keys(mapping).find((header) => mapping[header] === field)
  return column ? row[column]?.trim() || null : null
}

export async function createImportJob(database: Database, request: ImportRequest) {
  const parsed = parseCsv(request.rawCsv)
  const jobId = randomUUID()
  const sourceBytes = Buffer.from(request.originalSource.content, request.originalSource.encoding === 'base64' ? 'base64' : 'utf8')
  await database.query(
    `INSERT INTO import_jobs
      (id, project_id, file_name, status, total_rows, source_media_type, source_encoding, source_content, source_hash)
     VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $8)`,
    [jobId, request.projectId, request.fileName, parsed.rows.length, request.originalSource.mediaType, request.originalSource.encoding, sourceBytes, createHash('sha256').update(sourceBytes).digest('hex')],
  )
  return { jobId, rows: parsed.rows }
}

export async function processImportJob(
  database: Database,
  jobId: string,
  request: ImportRequest,
  rows: CsvRow[],
) {
  await database.query(`UPDATE import_jobs SET status = 'processing' WHERE id = $1`, [jobId])
  const summary = summarizeImport(rows, request.mapping)
  const mappedColumns = new Set(Object.keys(request.mapping).filter((header) => request.mapping[header] !== 'unmapped'))
  const seenExternalIds = new Set<string>()

  try {
    await database.transaction(async (transaction) => {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        const rawPayload = JSON.stringify(row)
        const sourceRecordId = randomUUID()
        await transaction.query(
        `INSERT INTO review_source_records
          (id, import_job_id, project_id, row_number, raw_payload, payload_hash)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [sourceRecordId, jobId, request.projectId, index + 2, rawPayload, hash(rawPayload)],
        )

        const validation = validateImportRow(row, request.mapping)
        if (!validation.valid) continue
        const { rating, ratingRaw, ratingScale } = validation
        const body = validation.text || null

        const externalId = mappedValue(row, request.mapping, 'review_id')
        const normalizedBody = normalizeImportText(validation.text)
        const canonicalHash = hash(normalizedBody.length >= 20 ? normalizedBody : (externalId || `${normalizedBody}|${ratingRaw || ''}`))
        if (externalId) {
          if (seenExternalIds.has(externalId)) continue
          seenExternalIds.add(externalId)
          const existingId = await transaction.query(
            `SELECT 1 FROM reviews WHERE project_id = $1 AND external_review_id = $2 LIMIT 1`,
            [request.projectId, externalId],
          )
          if (existingId.rows[0]) continue
        }
        const metadata = Object.fromEntries(Object.entries(row).filter(([header]) => !mappedColumns.has(header)))

        await transaction.query(
          `INSERT INTO reviews (
            id, project_id, source_record_id, external_review_id, provider, entity_name,
            rating_value, rating_scale, title, body_original, language, reviewer_name,
            owner_reply, source_url, source_created_at, is_rating_only, canonical_hash, metadata
          ) VALUES (
            $1, $2, $3, $4, COALESCE($5, 'csv_import'), $6,
            $7, COALESCE($8, 5), $9, $10, $11, $12,
            $13, $14, $15::timestamptz, $16, $17, $18::jsonb
          ) ON CONFLICT (project_id, canonical_hash) DO NOTHING`,
          [
            randomUUID(), request.projectId, sourceRecordId, externalId,
            mappedValue(row, request.mapping, 'source'), mappedValue(row, request.mapping, 'entity'),
            rating, ratingScale, mappedValue(row, request.mapping, 'title'),
            body, mappedValue(row, request.mapping, 'language'), mappedValue(row, request.mapping, 'reviewer_name'),
            mappedValue(row, request.mapping, 'owner_reply'), mappedValue(row, request.mapping, 'source_url'),
            mappedValue(row, request.mapping, 'review_date'), !body, canonicalHash, JSON.stringify(metadata),
          ],
        )
        await transaction.query(`UPDATE import_jobs SET processed_rows = $2 WHERE id = $1`, [jobId, index + 1])
      }

      const countResult = await transaction.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM reviews r
         JOIN review_source_records s ON s.id = r.source_record_id
         WHERE s.import_job_id = $1`,
        [jobId],
      )
      const insertedCount = Number(countResult.rows[0]?.count || 0)

      await transaction.query(
        `UPDATE import_jobs SET status = 'completed', processed_rows = total_rows,
          usable_rows = $2, written_rows = $3, rating_only_rows = $4,
          duplicate_rows = $5, invalid_rows = $6, completed_at = NOW()
         WHERE id = $1`,
        [jobId, insertedCount, summary.written, summary.ratingOnly, summary.duplicates, summary.invalid],
      )
    })
  } catch (error) {
    const message = 'Import processing failed. Check the mapped values and try again.'
    await database.query(`UPDATE import_jobs SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1`, [jobId, message])
    throw error
  }
}
