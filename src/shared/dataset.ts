import type { DatasetColumn, DatasetRowValues, DatasetSourceType } from '../dataset/csvTypes.js'
import type { AnalysisClass } from './analysis.js'

export type { AnalysisRowInput, AnalysisRowValue, DatasetColumn, DatasetRowValues, DatasetSourceType } from '../dataset/csvTypes.js'
export { CSV_MAX_BYTES, CSV_MAX_COLUMNS, CSV_MAX_ROWS, CSV_PREVIEW_ROWS, rowToInput } from '../dataset/csvTypes.js'

export interface DatasetAttribution {
  label: string
  sourceUrl: string
  licenseLabel: string
  licenseUrl: string
}

/** A ready-to-run starting point shipped with a dataset (only the sample has one). */
export interface DatasetSuggestion {
  task: string
  query: string
  classes: AnalysisClass[]
  labelColumn?: string
}

/** Durable dataset metadata. Rows live beside it in storage, never inside it. */
export interface DatasetRecord {
  datasetId: string
  sourceType: DatasetSourceType
  displayName: string
  byteSize: number
  contentHash: string
  delimiter: string
  columns: DatasetColumn[]
  acceptedRowCount: number
  previewRows: DatasetRowValues[]
  validationWarnings: string[]
  /** Final public URL for `public_url` datasets. Never contains credentials. */
  sourceUrl?: string
  createdAt: number
}

/** What the browser receives for a dataset. */
export interface DatasetPreview {
  datasetId: string
  sourceType: DatasetSourceType
  displayName: string
  byteSize: number
  delimiter: string
  columns: DatasetColumn[]
  acceptedRowCount: number
  previewRows: DatasetRowValues[]
  validationWarnings: string[]
  attribution?: DatasetAttribution
  suggestion?: DatasetSuggestion
}

export interface DatasetBrowseItem {
  datasetId: string
  displayName: string
  sourceType: DatasetSourceType
  acceptedRowCount: number
  createdAt: number
}

/** Durable dataset storage. Rows are immutable once `put` resolves. */
export interface DatasetStorage {
  /** Store metadata and every row. A dataset is not readable until this resolves. */
  put(record: DatasetRecord, rows: readonly DatasetRowValues[]): Promise<void>
  get(datasetId: string): Promise<DatasetRecord | undefined>
  /** Rows `offset .. offset+limit-1` in order. Shorter (or empty) past the end. */
  getRows(datasetId: string, offset: number, limit: number): Promise<DatasetRowValues[]>
  /** Newest first. */
  listRecent(limit: number): Promise<DatasetRecord[]>
}

export type ProviderMode ='live' | 'mock' | 'off'

/** `GET /api/status` — what this deployment can do. Names only, never secrets. */
export interface PlaygroundStatus {
  /** Durable storage is available, so uploads, runs and share links work. */
  storage: boolean
  drafting: ProviderMode
  classifier: ProviderMode
  runsEnabled: boolean
  limits: {
    maxRows: number
    maxBytes: number
    maxColumns: number
  }
}
