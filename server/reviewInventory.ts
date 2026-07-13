import type { Database } from './database'

type QueryValue = string | number | boolean

export type ReviewInventoryFilters = {
  provider?: string
  entity?: string
  ratingMin?: number
  ratingMax?: number
  dateFrom?: string
  dateTo?: string
  language?: string
  hasText?: boolean
  search?: string
}

type Cursor = { importedAt: string; id: string }

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>
    if (!parsed.importedAt || !parsed.id || Number.isNaN(Date.parse(parsed.importedAt))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) throw new Error()
    return { importedAt: parsed.importedAt, id: parsed.id }
  } catch {
    throw new Error('INVALID_CURSOR')
  }
}

function whereClause(projectId: string, filters: ReviewInventoryFilters, cursor?: Cursor) {
  const values: QueryValue[] = [projectId]
  const clauses = ['r.project_id = $1']
  const add = (sql: string, value: QueryValue) => {
    values.push(value)
    clauses.push(sql.replace('?', `$${values.length}`))
  }

  if (filters.provider) add('r.provider = ?', filters.provider)
  if (filters.entity) add('r.entity_name = ?', filters.entity)
  if (filters.ratingMin !== undefined) add('r.rating_value >= ?', filters.ratingMin)
  if (filters.ratingMax !== undefined) add('r.rating_value <= ?', filters.ratingMax)
  if (filters.dateFrom) add('r.source_created_at >= ?::timestamptz', filters.dateFrom)
  if (filters.dateTo) add(/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)
    ? "r.source_created_at < (?::date + INTERVAL '1 day')"
    : 'r.source_created_at <= ?::timestamptz', filters.dateTo)
  if (filters.language) add('r.language = ?', filters.language)
  if (filters.hasText !== undefined) add('r.is_rating_only = ?', !filters.hasText)
  if (filters.search) add("COALESCE(r.title, '') || ' ' || COALESCE(r.body_original, '') ILIKE '%' || ? || '%'", filters.search)
  if (cursor) {
    values.push(cursor.importedAt, cursor.id)
    clauses.push(`(r.imported_at, r.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`)
  }
  return { sql: clauses.join(' AND '), values }
}

const reviewColumns = `r.id, r.external_review_id AS "externalReviewId", r.provider,
  r.entity_name AS "entityName", r.rating_value AS "ratingValue", r.rating_scale AS "ratingScale",
  r.title, r.body_original AS body, r.language, r.reviewer_name AS "reviewerName",
  r.owner_reply AS "ownerReply", r.source_url AS "sourceUrl", r.source_created_at AS "sourceCreatedAt",
  r.is_rating_only AS "isRatingOnly", r.metadata, r.imported_at AS "importedAt"`

export async function listReviews(database: Database, projectId: string, filters: ReviewInventoryFilters, limit: number, cursor?: Cursor) {
  const where = whereClause(projectId, filters, cursor)
  const result = await database.query<Record<string, unknown>>(
    `SELECT ${reviewColumns} FROM reviews r WHERE ${where.sql}
     ORDER BY r.imported_at DESC, r.id DESC LIMIT $${where.values.length + 1}`,
    [...where.values, limit + 1],
  )
  const hasMore = result.rows.length > limit
  const rows = result.rows.slice(0, limit)
  const last = rows.at(-1) as { id?: string; importedAt?: string | Date } | undefined
  return {
    items: rows,
    hasMore,
    nextCursor: hasMore && last?.id && last.importedAt
      ? encodeCursor({ id: last.id, importedAt: new Date(last.importedAt).toISOString() })
      : null,
  }
}

export async function summarizeReviews(database: Database, projectId: string, filters: ReviewInventoryFilters) {
  const where = whereClause(projectId, filters)
  const [totals, providers, entities, ratings, languages] = await Promise.all([
    database.query<Record<string, unknown>>(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE NOT r.is_rating_only)::int AS "writtenCount",
      COUNT(*) FILTER (WHERE r.is_rating_only)::int AS "ratingOnlyCount",
      COUNT(DISTINCT r.provider)::int AS "providerCount",
      COUNT(DISTINCT r.entity_name) FILTER (WHERE r.entity_name IS NOT NULL)::int AS "entityCount",
      MIN(r.source_created_at) AS "earliestDate", MAX(r.source_created_at) AS "latestDate",
      AVG(r.rating_value) AS "averageRating"
      FROM reviews r WHERE ${where.sql}`, where.values),
    database.query(`SELECT r.provider AS value, COUNT(*)::int AS count FROM reviews r WHERE ${where.sql} GROUP BY r.provider ORDER BY count DESC, value`, where.values),
    database.query(`SELECT r.entity_name AS value, COUNT(*)::int AS count FROM reviews r WHERE ${where.sql} AND r.entity_name IS NOT NULL GROUP BY r.entity_name ORDER BY count DESC, value`, where.values),
    database.query(`SELECT r.rating_value AS value, COUNT(*)::int AS count FROM reviews r WHERE ${where.sql} AND r.rating_value IS NOT NULL GROUP BY r.rating_value ORDER BY value DESC`, where.values),
    database.query(`SELECT r.language AS value, COUNT(*)::int AS count FROM reviews r WHERE ${where.sql} AND r.language IS NOT NULL GROUP BY r.language ORDER BY count DESC, value`, where.values),
  ])
  return { ...totals.rows[0], breakdowns: { providers: providers.rows, entities: entities.rows, ratings: ratings.rows, languages: languages.rows } }
}

export async function getReviewDetail(database: Database, reviewId: string) {
  const result = await database.query<Record<string, unknown>>(
    `SELECT ${reviewColumns},
      s.id AS "sourceRecordId", s.row_number AS "sourceRowNumber", s.raw_payload AS "rawPayload",
      s.payload_hash AS "payloadHash", s.imported_at AS "sourceImportedAt",
      j.id AS "importJobId", j.file_name AS "importFileName", j.status AS "importStatus", j.created_at AS "importCreatedAt"
     FROM reviews r
     JOIN review_source_records s ON s.id = r.source_record_id
     JOIN import_jobs j ON j.id = s.import_job_id
     WHERE r.id = $1`,
    [reviewId],
  )
  const row = result.rows[0]
  if (!row) return undefined
  const {
    sourceRecordId, sourceRowNumber, rawPayload, payloadHash, sourceImportedAt,
    importJobId, importFileName, importStatus, importCreatedAt,
    ...review
  } = row
  return {
    review,
    sourceRecord: { id: sourceRecordId, rowNumber: sourceRowNumber, rawPayload, payloadHash, importedAt: sourceImportedAt },
    importJob: { id: importJobId, fileName: importFileName, status: importStatus, createdAt: importCreatedAt },
  }
}
