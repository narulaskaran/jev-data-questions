import {
  CSV_PREVIEW_ROWS,
  DatasetError,
  type AnalysisRowValue,
  type DatasetColumn,
  type DatasetColumnType,
  type DatasetRowValues,
  type ParsedCsv,
  type ValidatedDataset,
} from './csvTypes.js'
import { parseCsvBytes, parseCsvText } from './parseCsv.js'

const LOOSE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const PLAIN_NUMBER = /^-?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/
const PLAIN_INTEGER = /^-?\d+$/
const MAX_SIGNIFICANT_DIGITS = 15

/** True only when converting to a JS number cannot corrupt the value (leading zeros, long IDs, precision). */
const isSafeNumber = (value: string): boolean => {
  if (!PLAIN_NUMBER.test(value)) return false
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return false
  if (PLAIN_INTEGER.test(value)) return Number.isSafeInteger(parsed)
  const mantissa = value.replace(/[eE].*$/, '').replace(/^-/, '').replace('.', '').replace(/^0+/, '')
  return mantissa.length <= MAX_SIGNIFICANT_DIGITS
}

const isBoolean = (value: string): boolean => /^(?:true|false)$/i.test(value)

interface Inference {
  type: DatasetColumnType
  keptAsText: boolean
}

const inferType = (values: string[][], index: number): Inference => {
  let sawValue = false
  let allNumbers = true
  let allLooseNumbers = true
  let allBooleans = true
  for (const cells of values) {
    const trimmed = (cells[index] ?? '').trim()
    if (!trimmed) continue
    sawValue = true
    if (allBooleans && !isBoolean(trimmed)) allBooleans = false
    if (allLooseNumbers) {
      if (!LOOSE_NUMBER.test(trimmed)) allLooseNumbers = false
      else if (allNumbers && !isSafeNumber(trimmed)) allNumbers = false
    }
    if (!allBooleans && !allLooseNumbers) break
  }
  if (!sawValue) return { type: 'empty', keptAsText: false }
  if (allBooleans) return { type: 'boolean', keptAsText: false }
  if (allLooseNumbers && allNumbers) return { type: 'number', keptAsText: false }
  return { type: 'string', keptAsText: allLooseNumbers }
}

const coerceValue = (value: string | undefined, type: DatasetColumnType): AnalysisRowValue => {
  const raw = value ?? ''
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (type === 'number') return Number(trimmed) + 0
  if (type === 'boolean') return trimmed.toLowerCase() === 'true'
  return raw
}

export const toValidatedDataset = (parsed: ParsedCsv): ValidatedDataset => {
  const warnings = [...parsed.warnings]
  const columns: DatasetColumn[] = parsed.header.map((name, index) => {
    const { type, keptAsText } = inferType(parsed.rows, index)
    if (keptAsText) warnings.push(`Column “${name}” kept as text to preserve leading zeros or long IDs.`)
    return { name, inferredType: type }
  })
  const rows: DatasetRowValues[] = parsed.rows.map((cells) => columns.map((column, index) => coerceValue(cells[index], column.inferredType)))
  return {
    delimiter: parsed.delimiter,
    byteSize: parsed.byteSize,
    columns,
    acceptedRowCount: rows.length,
    rows,
    previewRows: rows.slice(0, CSV_PREVIEW_ROWS),
    validationWarnings: warnings,
  }
}

export const validateCsvBytes = (bytes: Uint8Array): ValidatedDataset => toValidatedDataset(parseCsvBytes(bytes))
export const validateCsvText = (text: string): ValidatedDataset => toValidatedDataset(parseCsvText(text))

const ALLOWED_CONTENT_TYPES = new Set([
  'text/csv',
  'text/plain',
  'text/tab-separated-values',
  'text/x-csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/octet-stream',
])

export const sniffCsvContentType = (contentType: string | undefined, bytes: Uint8Array): void => {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase()
  if (!normalized) return
  if (!ALLOWED_CONTENT_TYPES.has(normalized)) throw new DatasetError('NOT_CSV', 'That does not look like a CSV.')
  void bytes
}
