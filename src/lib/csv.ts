import { safeSourceUrl } from './sourceUrl'

export type CsvRow = Record<string, string>
export type TabularValue = string | number | boolean | Date | null | undefined

export type CanonicalField =
  | 'review_id'
  | 'source'
  | 'entity'
  | 'rating'
  | 'rating_scale'
  | 'title'
  | 'review_text'
  | 'review_date'
  | 'language'
  | 'reviewer_name'
  | 'customer_id'
  | 'context'
  | 'owner_reply'
  | 'source_url'

export type ColumnMapping = Record<string, CanonicalField | 'unmapped' | 'excluded'>

export const requiredCanonicalFields = ['review_id', 'source', 'review_text'] as const satisfies readonly CanonicalField[]

export type CsvColumnError = {
  code: 'missing_required_column' | 'duplicate_mapping' | 'unresolved_column'
  column?: string
  field?: CanonicalField
  message: string
}

export type CsvRowError = {
  row: number
  column: CanonicalField
  code: 'required_value_missing' | 'invalid_date' | 'invalid_rating' | 'rating_scale_required' | 'invalid_source_url' | 'feedback_too_long'
  message: string
}

export type ImportSummary = {
  total: number
  usable: number
  written: number
  ratingOnly: number
  duplicates: number
  invalid: number
  warnings: string[]
}

const aliases: Record<CanonicalField, string[]> = {
  review_id: ['reviewid', 'review_id', 'id', 'externalid'],
  source: ['source', 'provider', 'platform', 'channel'],
  entity: ['entity', 'location', 'locationorproduct', 'branch', 'product', 'store'],
  rating: ['rating', 'stars', 'score', 'reviewrating'],
  rating_scale: ['ratingscale', 'rating_scale', 'scale'],
  title: ['title', 'reviewtitle', 'headline'],
  review_text: ['reviewtext', 'review_text', 'review', 'comment', 'feedback', 'body', 'text'],
  review_date: ['reviewdate', 'review_date', 'date', 'created', 'createdat', 'submittedat'],
  language: ['language', 'lang', 'locale'],
  reviewer_name: ['reviewername', 'reviewer_name', 'author', 'customername', 'name'],
  customer_id: ['customerid', 'customer_id', 'accountid', 'contactid'],
  context: ['context', 'customercontext', 'feedbackcontext', 'segment', 'plan'],
  owner_reply: ['ownerreply', 'owner_reply', 'response', 'reply'],
  source_url: ['sourceurl', 'source_url', 'url', 'reviewurl'],
}

export const MAX_IMPORT_ROWS = 10_000
export const MAX_IMPORT_COLUMNS = 100
export const MAX_IMPORT_CELL_CHARS = 10_000

export class CsvValidationError extends Error {}

export function rowsToCsv(rows: TabularValue[][]) {
  return rows.map((row) => row.map((value) => {
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : value == null ? '' : String(value)
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }).join(',')).join('\n')
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
}

function parseRecord(line: string, delimiter: string) {
  const values: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      values.push(current.trim())
      if (values.length > MAX_IMPORT_COLUMNS) throw new CsvValidationError(`CSV imports are limited to ${MAX_IMPORT_COLUMNS} columns.`)
      current = ''
    } else {
      current += character
      if (current.length > MAX_IMPORT_CELL_CHARS) throw new CsvValidationError(`CSV cells are limited to ${MAX_IMPORT_CELL_CHARS.toLocaleString()} characters.`)
    }
  }
  if (quoted) throw new CsvValidationError('CSV contains an unterminated quoted value.')
  values.push(current.trim())
  if (values.length > MAX_IMPORT_COLUMNS) throw new CsvValidationError(`CSV imports are limited to ${MAX_IMPORT_COLUMNS} columns.`)
  return values
}

function splitLogicalLines(input: string) {
  const lines: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        current += '""'
        index += 1
      } else {
        quoted = !quoted
        current += character
      }
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      if (current.trim()) {
        lines.push(current)
        if (lines.length > MAX_IMPORT_ROWS + 1) throw new CsvValidationError(`CSV imports are limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows.`)
      }
      current = ''
    } else {
      current += character
    }
  }
  if (quoted) throw new CsvValidationError('CSV contains an unterminated quoted value.')
  if (current.trim()) {
    lines.push(current)
    if (lines.length > MAX_IMPORT_ROWS + 1) throw new CsvValidationError(`CSV imports are limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows.`)
  }
  return lines
}

export function parseCsv(input: string) {
  const lines = splitLogicalLines(input.replace(/^\uFEFF/, ''))
  if (lines.length === 0) return { headers: [], rows: [] }

  const delimiter = lines[0].split(';').length > lines[0].split(',').length ? ';' : ','
  const headers = parseRecord(lines[0], delimiter).map((header, index) => header || `Column ${index + 1}`)
  const rows = lines.slice(1).map((line, rowIndex) => {
    const values = parseRecord(line, delimiter)
    if (values.length !== headers.length) {
      throw new CsvValidationError(`CSV row ${rowIndex + 2} has ${values.length} columns; expected ${headers.length} columns.`)
    }
    return headers.reduce<CsvRow>((row, header, index) => {
      row[header] = values[index] ?? ''
      return row
    }, {})
  })
  return { headers, rows }
}

export function detectMapping(headers: string[]): ColumnMapping {
  return headers.reduce<ColumnMapping>((mapping, header) => {
    const normalized = normalizeHeader(header)
    const match = (Object.entries(aliases) as [CanonicalField, string[]][]).find(([, candidates]) =>
      candidates.includes(normalized),
    )
    mapping[header] = match?.[0] ?? 'unmapped'
    return mapping
  }, {})
}

function mappedValue(row: CsvRow, mapping: ColumnMapping, field: CanonicalField) {
  const column = Object.keys(mapping).find((header) => mapping[header] === field)
  return column ? row[column]?.trim() ?? '' : ''
}

export function normalizeImportText(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
}

export function validateImportRow(row: CsvRow, mapping: ColumnMapping, options: { allowLoopbackHttp?: boolean } = {}) {
  const externalId = mappedValue(row, mapping, 'review_id')
  const source = mappedValue(row, mapping, 'source')
  const text = mappedValue(row, mapping, 'review_text')
  const ratingRaw = mappedValue(row, mapping, 'rating')
  const ratingScaleRaw = mappedValue(row, mapping, 'rating_scale')
  const reviewDate = mappedValue(row, mapping, 'review_date')
  const sourceUrl = mappedValue(row, mapping, 'source_url')
  const rating = ratingRaw ? Number(ratingRaw) : null
  const ratingScale = ratingScaleRaw ? Number(ratingScaleRaw) : null

  if (!externalId) return { valid: false as const, reason: 'missing_review_id' as const }
  if (!source) return { valid: false as const, reason: 'missing_source' as const }
  if (!text) return { valid: false as const, reason: 'missing_feedback' as const }
  if (text.length > MAX_IMPORT_CELL_CHARS) return { valid: false as const, reason: 'feedback_too_long' as const }
  if (rating !== null && ratingScale === null) return { valid: false as const, reason: 'rating_scale_required' as const }
  if (rating !== null && (!Number.isFinite(rating) || !Number.isFinite(ratingScale) || ratingScale! <= 0 || rating < 0 || rating > ratingScale!)) {
    return { valid: false as const, reason: 'invalid_rating' as const }
  }
  if (reviewDate && (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(reviewDate) || Number.isNaN(Date.parse(reviewDate)))) return { valid: false as const, reason: 'invalid_date' as const }
  if (sourceUrl && !safeSourceUrl(sourceUrl, options.allowLoopbackHttp)) return { valid: false as const, reason: 'invalid_source_url' as const }

  return { valid: true as const, externalId, source, text, rating, ratingRaw, ratingScale, reviewDate, sourceUrl: sourceUrl || null }
}

export function preflightCsv(parsed: { headers: string[]; rows: CsvRow[] }, mapping: ColumnMapping, options: { allowLoopbackHttp?: boolean } = {}) {
  const columnErrors: CsvColumnError[] = []
  for (const field of requiredCanonicalFields) {
    if (!Object.values(mapping).includes(field)) columnErrors.push({ code: 'missing_required_column', field, message: `${canonicalFieldLabels[field]} must be mapped.` })
  }
  for (const header of parsed.headers) {
    if (!mapping[header] || mapping[header] === 'unmapped') columnErrors.push({ code: 'unresolved_column', column: header, message: `${header}: map or exclude this column.` })
  }
  for (const field of Object.keys(canonicalFieldLabels).filter((value): value is CanonicalField => !['unmapped', 'excluded'].includes(value))) {
    const matches = Object.entries(mapping).filter(([, target]) => target === field)
    if (matches.length > 1) columnErrors.push({ code: 'duplicate_mapping', field, message: `${canonicalFieldLabels[field]} is mapped more than once.` })
  }

  const rowErrors: CsvRowError[] = []
  parsed.rows.forEach((row, index) => {
    for (const [field, message] of [
      ['review_id', 'Feedback ID is required.'], ['source', 'Source is required.'], ['review_text', 'Comment text is required.'],
    ] as const) {
      if (!mappedValue(row, mapping, field)) rowErrors.push({ row: index + 2, column: field, code: 'required_value_missing', message })
    }
    const text = mappedValue(row, mapping, 'review_text')
    const date = mappedValue(row, mapping, 'review_date')
    const rating = mappedValue(row, mapping, 'rating')
    const scale = mappedValue(row, mapping, 'rating_scale')
    const url = mappedValue(row, mapping, 'source_url')
    if (text.length > MAX_IMPORT_CELL_CHARS) rowErrors.push({ row: index + 2, column: 'review_text', code: 'feedback_too_long', message: `Comment text must be ${MAX_IMPORT_CELL_CHARS.toLocaleString()} characters or fewer.` })
    if (date && (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(date) || Number.isNaN(Date.parse(date)))) rowErrors.push({ row: index + 2, column: 'review_date', code: 'invalid_date', message: 'Use an ISO 8601 date such as 2026-08-13.' })
    if (rating && !scale) rowErrors.push({ row: index + 2, column: 'rating_scale', code: 'rating_scale_required', message: 'Rating scale is required when rating is provided.' })
    if (rating && scale && (!Number.isFinite(Number(rating)) || !Number.isFinite(Number(scale)) || Number(scale) <= 0 || Number(rating) < 0 || Number(rating) > Number(scale))) rowErrors.push({ row: index + 2, column: 'rating', code: 'invalid_rating', message: 'Rating must be between 0 and the rating scale.' })
    if (url && !safeSourceUrl(url, options.allowLoopbackHttp)) rowErrors.push({ row: index + 2, column: 'source_url', code: 'invalid_source_url', message: 'Source URL must use HTTPS.' })
  })
  if (parsed.rows.length === 0) rowErrors.push({ row: 2, column: 'review_text', code: 'required_value_missing', message: 'Add at least one feedback row.' })
  return { valid: columnErrors.length === 0 && rowErrors.length === 0, columnErrors, rowErrors }
}

export function summarizeImport(rows: CsvRow[], mapping: ColumnMapping, options: { allowLoopbackHttp?: boolean } = {}): ImportSummary {
  const seenExternalIds = new Set<string>()
  const seenTexts = new Set<string>()
  let written = 0
  let ratingOnly = 0
  let duplicates = 0
  let invalid = 0

  for (const row of rows) {
    const validation = validateImportRow(row, mapping, options)
    if (!validation.valid) {
      invalid += 1
      continue
    }
    const { text, rating } = validation
    const externalId = mappedValue(row, mapping, 'review_id')
    const normalizedText = normalizeImportText(text)
    const duplicateExternalId = Boolean(externalId && seenExternalIds.has(externalId))
    const duplicateText = !externalId && normalizedText.length >= 20 && seenTexts.has(normalizedText)
    if (externalId) seenExternalIds.add(externalId)
    if (duplicateExternalId || duplicateText) {
      duplicates += 1
      continue
    }
    if (normalizedText.length >= 20) seenTexts.add(normalizedText)
    if (text) written += 1
    else ratingOnly += 1
  }

  const warnings: string[] = []
  if (!Object.values(mapping).includes('rating')) warnings.push('No rating column is mapped.')
  if (!Object.values(mapping).includes('review_date')) warnings.push('Review dates are unavailable for trend analysis.')

  return {
    total: rows.length,
    usable: written + ratingOnly,
    written,
    ratingOnly,
    duplicates,
    invalid,
    warnings,
  }
}

export const canonicalFieldLabels: Record<CanonicalField | 'unmapped' | 'excluded', string> = {
  unmapped: 'Choose a field',
  excluded: 'Exclude from processing',
  review_id: 'Review ID',
  source: 'Source',
  entity: 'Location or product',
  rating: 'Rating',
  rating_scale: 'Rating scale',
  title: 'Title',
  review_text: 'Review text',
  review_date: 'Review date',
  language: 'Language',
  reviewer_name: 'Reviewer name',
  customer_id: 'Customer ID',
  context: 'Context',
  owner_reply: 'Owner reply',
  source_url: 'Source URL',
}

export const sampleCsv = `review_id,source,entity,rating,rating_scale,review_text,review_date,language,reviewer_name,owner_reply
g2-101,G2,Main Product,2,5,"The setup took days and the documentation sent us in circles.",2026-06-02,en,Sam,
g2-102,G2,Main Product,5,5,"Finally a tool that just works without needing a consultant.",2026-06-04,en,Alex,"Thanks for sharing this."
tp-201,Trustpilot,Berlin,4,5,"Friendly team and a much simpler setup than the alternatives.",2026-06-10,en,Maya,
tp-203,Trustpilot,Berlin,3,5,"Good product, but the price felt high before we saw results.",2026-06-14,en,Jordan,
tp-202,Trustpilot,Berlin,3,5,"Good product, but the price felt high before we saw results.",2026-06-14,en,Jordan,
google-1,Google Reviews,Hamburg,5,5,"The team explained each step and kept me informed.",2026-06-20,de,Chris,
csv-1,CSV Upload,Hamburg,3,5,"The import status was unclear while I waited.",2026-06-21,de,,`
export const DEMO_COMMENT_ALLOWANCE = 50
