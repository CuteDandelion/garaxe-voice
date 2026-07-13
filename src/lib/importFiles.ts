import readXlsxFile from 'read-excel-file/browser'

type TabularValue = string | number | boolean | Date | null | undefined

function text(value: TabularValue) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value == null ? '' : String(value)
}

function csvCell(value: TabularValue) {
  const normalized = text(value)
  return /[",\r\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized
}

export function rowsToCsv(rows: TabularValue[][]) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

export function jsonToCsv(raw: string) {
  const parsed = JSON.parse(raw) as unknown
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { reviews?: unknown }).reviews)
      ? (parsed as { reviews: unknown[] }).reviews
      : null
  if (!records?.length || records.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) {
    throw new Error('JSON must contain an array of review objects or a reviews array.')
  }
  const headers = Array.from(new Set(records.flatMap((record) => Object.keys(record as Record<string, unknown>))))
  return rowsToCsv([headers, ...records.map((record) => headers.map((header) => {
    const value = (record as Record<string, unknown>)[header]
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : value as TabularValue
  }))])
}

export function pastedFeedbackToCsv(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Paste at least one feedback item.')
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return jsonToCsv(trimmed)
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return rowsToCsv([['review_text'], ...lines.map((line) => [line])])
}

export async function fileToCsv(file: File) {
  const extension = file.name.toLowerCase().split('.').pop()
  if (extension === 'xlsx' || extension === 'xls') {
    const workbook = await readXlsxFile(file) as unknown
    const first = Array.isArray(workbook) ? workbook[0] : null
    const rows = first && typeof first === 'object' && 'data' in first
      ? (first as { data: TabularValue[][] }).data
      : workbook as TabularValue[][]
    if (rows.length < 2) throw new Error('The workbook must contain a header row and at least one feedback row.')
    return rowsToCsv(rows as unknown as TabularValue[][])
  }
  const raw = await file.text()
  if (extension === 'json' || file.type === 'application/json') return jsonToCsv(raw)
  return raw
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)))
  }
  return btoa(binary)
}

export async function prepareImportFile(file: File) {
  const extension = file.name.toLowerCase().split('.').pop()
  const rawCsv = await fileToCsv(file)
  if (extension === 'xlsx' || extension === 'xls') {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return { rawCsv, originalSource: { encoding: 'base64' as const, content: bytesToBase64(bytes), mediaType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }
  }
  return { rawCsv, originalSource: { encoding: 'utf8' as const, content: await file.text(), mediaType: file.type || (extension === 'json' ? 'application/json' : 'text/csv') } }
}
