/** Kept under Vercel's 4.5 MB function body limit so an accepted file can always be posted. */
export const CSV_MAX_BYTES = 4 * 1024 * 1024
export const CSV_MAX_ROWS = 5_000
export const CSV_MAX_COLUMNS = 100
export const CSV_MAX_CELL_LENGTH = 8_192
export const CSV_PREVIEW_ROWS = 8
export const CSV_MAX_HEADER_LENGTH = 200

export type DatasetSourceType = 'sample' | 'upload' | 'public_url'
export type DatasetColumnType = 'string' | 'number' | 'boolean' | 'empty'

export type AnalysisRowValue = string | number | boolean | null
/** One dataset row, aligned by index with the dataset's `columns`. */
export type DatasetRowValues = AnalysisRowValue[]
/** One dataset row keyed by column name (what the classifier and the UI detail panel see). */
export type AnalysisRowInput = Record<string, AnalysisRowValue>

export interface DatasetColumn {
  name: string
  inferredType: DatasetColumnType
}

export interface ParsedCsv {
  delimiter: string
  byteSize: number
  header: string[]
  rows: string[][]
  /** Human-readable notes about anything the parser repaired (ragged rows, dropped cells). */
  warnings: string[]
}

export type DatasetErrorCode =
  | 'CSV_TOO_LARGE'
  | 'NOT_CSV'
  | 'CSV_PARSE_FAILED'
  | 'CSV_EMPTY'
  | 'CSV_TOO_MANY_ROWS'
  | 'CSV_TOO_MANY_COLUMNS'
  | 'CSV_INVALID_HEADER'
  | 'URL_NOT_PUBLIC'
  | 'URL_UNSAFE'
  | 'URL_FETCH_FAILED'
  | 'DATASET_NOT_FOUND'
  | 'DATASET_STORAGE_FAILED'

export class DatasetError extends Error {
  readonly code: DatasetErrorCode
  readonly statusCode: number

  constructor(code: DatasetErrorCode, message: string, statusCode = 400) {
    super(message)
    this.name = 'DatasetError'
    this.code = code
    this.statusCode = statusCode
  }
}

export interface ValidatedDataset {
  delimiter: string
  byteSize: number
  columns: DatasetColumn[]
  acceptedRowCount: number
  rows: DatasetRowValues[]
  previewRows: DatasetRowValues[]
  validationWarnings: string[]
}

export const rowToInput = (columns: readonly string[], values: readonly AnalysisRowValue[]): AnalysisRowInput => {
  const input: AnalysisRowInput = {}
  for (let index = 0; index < columns.length; index += 1) input[columns[index]] = values[index] ?? null
  return input
}
