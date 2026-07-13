export type CsvRow = Record<string, string>

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
  | 'owner_reply'
  | 'source_url'

export type ColumnMapping = Record<string, CanonicalField | 'unmapped'>

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
  owner_reply: ['ownerreply', 'owner_reply', 'response', 'reply'],
  source_url: ['sourceurl', 'source_url', 'url', 'reviewurl'],
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
      current = ''
    } else {
      current += character
    }
  }
  values.push(current.trim())
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
      if (current.trim()) lines.push(current)
      current = ''
    } else {
      current += character
    }
  }
  if (current.trim()) lines.push(current)
  return lines
}

export function parseCsv(input: string) {
  const lines = splitLogicalLines(input.replace(/^\uFEFF/, ''))
  if (lines.length === 0) return { headers: [], rows: [] }

  const delimiter = lines[0].split(';').length > lines[0].split(',').length ? ';' : ','
  const headers = parseRecord(lines[0], delimiter).map((header, index) => header || `Column ${index + 1}`)
  const rows = lines.slice(1).map((line) => {
    const values = parseRecord(line, delimiter)
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

export function validateImportRow(row: CsvRow, mapping: ColumnMapping) {
  const text = mappedValue(row, mapping, 'review_text')
  const ratingRaw = mappedValue(row, mapping, 'rating')
  const ratingScaleRaw = mappedValue(row, mapping, 'rating_scale')
  const reviewDate = mappedValue(row, mapping, 'review_date')
  const rating = ratingRaw ? Number(ratingRaw) : null
  const ratingScale = ratingScaleRaw ? Number(ratingScaleRaw) : 5

  if (!text && rating === null) return { valid: false as const, reason: 'missing_feedback' as const }
  if (rating !== null && (!Number.isFinite(rating) || !Number.isFinite(ratingScale) || ratingScale <= 0 || rating < 0 || rating > ratingScale)) {
    return { valid: false as const, reason: 'invalid_rating' as const }
  }
  if (reviewDate && Number.isNaN(Date.parse(reviewDate))) return { valid: false as const, reason: 'invalid_date' as const }

  return { valid: true as const, text, rating, ratingRaw, ratingScale, reviewDate }
}

export function summarizeImport(rows: CsvRow[], mapping: ColumnMapping): ImportSummary {
  const seenExternalIds = new Set<string>()
  const seenTexts = new Set<string>()
  let written = 0
  let ratingOnly = 0
  let duplicates = 0
  let invalid = 0

  for (const row of rows) {
    const validation = validateImportRow(row, mapping)
    if (!validation.valid) {
      invalid += 1
      continue
    }
    const { text, rating } = validation
    const externalId = mappedValue(row, mapping, 'review_id')
    const normalizedText = normalizeImportText(text)
    const duplicateExternalId = Boolean(externalId && seenExternalIds.has(externalId))
    const duplicateText = normalizedText.length >= 20 && seenTexts.has(normalizedText)
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
  if (!Object.values(mapping).includes('review_text')) warnings.push('No review text column is mapped.')
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

export const canonicalFieldLabels: Record<CanonicalField | 'unmapped', string> = {
  unmapped: 'Keep as metadata',
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
  owner_reply: 'Owner reply',
  source_url: 'Source URL',
}

export const sampleCsv = `review_id,source,entity,rating,review_text,review_date,language,reviewer_name,owner_reply
g2-101,G2,Main Product,2,"The setup took days and the documentation sent us in circles.",2026-06-02,en,Sam,
g2-102,G2,Main Product,5,"Finally a tool that just works without needing a consultant.",2026-06-04,en,Alex,"Thanks for sharing this."
tp-201,Trustpilot,Berlin,4,"Friendly team and a much simpler setup than the alternatives.",2026-06-10,en,Maya,
tp-202,Trustpilot,Berlin,3,"Good product, but the price felt high before we saw results.",2026-06-14,en,Jordan,
tp-202,Trustpilot,Berlin,3,"Good product, but the price felt high before we saw results.",2026-06-14,en,Jordan,
google-1,Google Reviews,Hamburg,5,,2026-06-20,de,Chris,
bad-1,CSV Upload,Hamburg,not-a-rating,,2026-06-21,de,,`
