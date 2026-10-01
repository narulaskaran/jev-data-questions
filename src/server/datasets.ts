import { createHash, randomUUID } from 'node:crypto'
import { CSV_MAX_BYTES, CSV_PREVIEW_ROWS, DatasetError, type DatasetRowValues, type ValidatedDataset } from '../dataset/csvTypes.js'
import { SAMPLE_DATASET_ID, samplePreview, sampleRecord, sampleRows } from '../dataset/sampleDataset.js'
import { sniffCsvContentType, validateCsvBytes } from '../dataset/validateDataset.js'
import type { DatasetBrowseItem, DatasetPreview, DatasetRecord, DatasetStorage } from '../shared/dataset.js'
import { fetchPublicCsv } from './datasetFetch.js'
import { ApiError, errorName } from './errors.js'

export type PublicCsvFetcher = (url: string) => Promise<{ bytes: Uint8Array; finalUrl: string; contentType?: string }>

export interface DatasetServiceOptions {
  /** Absent when durable storage is not configured: the sample still works, intake fails closed. */
  store?: DatasetStorage
  fetchCsv?: PublicCsvFetcher
  now?: () => number
  idFactory?: () => string
}

const MAX_NAME_LENGTH = 120
const PREVIEW_CELL_LENGTH = 300

/** The preview is stored inside the metadata document, so long cells are clipped there (never in the rows). */
const clipPreview = (rows: readonly DatasetRowValues[]): DatasetRowValues[] => rows.slice(0, CSV_PREVIEW_ROWS).map((row) => (
  row.map((value) => (typeof value === 'string' && value.length > PREVIEW_CELL_LENGTH ? `${value.slice(0, PREVIEW_CELL_LENGTH)}…` : value))
))

/** A display name from a filename or URL path: last segment, no control characters, bounded. */
export const displayNameFrom = (source: string | undefined, fallback: string): string => {
  if (!source) return fallback
  let name = source
  try {
    if (/^https?:\/\//i.test(source)) name = decodeURIComponent(new URL(source).pathname)
  } catch { /* keep the raw value */ }
  name = name.split(/[\\/]/).filter(Boolean).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
  return name || fallback
}

const toPreview = (record: DatasetRecord): DatasetPreview => ({
  datasetId: record.datasetId,
  sourceType: record.sourceType,
  displayName: record.displayName,
  byteSize: record.byteSize,
  delimiter: record.delimiter,
  columns: record.columns,
  acceptedRowCount: record.acceptedRowCount,
  previewRows: record.previewRows,
  validationWarnings: record.validationWarnings,
})

export class DatasetService {
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly fetchCsv: PublicCsvFetcher

  constructor(private readonly options: DatasetServiceOptions = {}) {
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
    this.fetchCsv = options.fetchCsv ?? ((url) => fetchPublicCsv(url))
  }

  get storageReady(): boolean {
    return this.options.store !== undefined
  }

  private requireStore(): DatasetStorage {
    if (!this.options.store) throw new ApiError('STORAGE_NOT_CONFIGURED', 'This deployment has no storage configured, so only the sample dataset is available.', 503)
    return this.options.store
  }

  async fromCsvBytes(bytes: Uint8Array, filename?: string): Promise<DatasetPreview> {
    const store = this.requireStore()
    if (bytes.byteLength > CSV_MAX_BYTES) throw new DatasetError('CSV_TOO_LARGE', 'That file is over the 4 MB limit.', 413)
    const validated = validateCsvBytes(bytes)
    return this.persist(store, { bytes, validated, sourceType: 'upload', displayName: displayNameFrom(filename, 'Uploaded CSV') })
  }

  async fromPublicUrl(url: string): Promise<DatasetPreview> {
    const store = this.requireStore()
    const fetched = await this.fetchCsv(url)
    sniffCsvContentType(fetched.contentType, fetched.bytes)
    const validated = validateCsvBytes(fetched.bytes)
    return this.persist(store, { bytes: fetched.bytes, validated, sourceType: 'public_url', displayName: displayNameFrom(fetched.finalUrl, 'Public CSV'), sourceUrl: fetched.finalUrl })
  }

  private async persist(store: DatasetStorage, input: { bytes: Uint8Array; validated: ValidatedDataset; sourceType: 'upload' | 'public_url'; displayName: string; sourceUrl?: string }): Promise<DatasetPreview> {
    const record: DatasetRecord = {
      datasetId: this.idFactory(),
      sourceType: input.sourceType,
      displayName: input.displayName,
      byteSize: input.validated.byteSize,
      contentHash: createHash('sha256').update(input.bytes).digest('hex'),
      delimiter: input.validated.delimiter,
      columns: input.validated.columns,
      acceptedRowCount: input.validated.acceptedRowCount,
      previewRows: clipPreview(input.validated.rows),
      validationWarnings: input.validated.validationWarnings,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      createdAt: this.now(),
    }
    try {
      await store.put(record, input.validated.rows)
    } catch (error) {
      // Never forward the storage error text: Convex failures echo call arguments.
      console.error('[datasets] store.put failed', { name: errorName(error) })
      throw new DatasetError('DATASET_STORAGE_FAILED', 'We could not save that dataset. Please try again.', 503)
    }
    return toPreview(record)
  }

  /** Metadata for any dataset, including the built-in sample. */
  async getRecord(datasetId: string): Promise<DatasetRecord | undefined> {
    if (datasetId === SAMPLE_DATASET_ID) return sampleRecord()
    if (!this.options.store) return undefined
    return await this.options.store.get(datasetId)
  }

  async getPreview(datasetId: string): Promise<DatasetPreview> {
    if (datasetId === SAMPLE_DATASET_ID) return samplePreview()
    const record = await this.requireStore().get(datasetId)
    if (!record) throw new DatasetError('DATASET_NOT_FOUND', 'That dataset was not found.', 404)
    return toPreview(record)
  }

  async getRows(datasetId: string, offset: number, limit: number): Promise<DatasetRowValues[]> {
    if (limit <= 0) return []
    if (datasetId === SAMPLE_DATASET_ID) return sampleRows().slice(offset, offset + limit)
    return await this.requireStore().getRows(datasetId, offset, limit)
  }

  async listRecent(limit: number): Promise<DatasetBrowseItem[]> {
    if (!this.options.store) return []
    return (await this.options.store.listRecent(limit)).map((record) => ({
      datasetId: record.datasetId,
      displayName: record.displayName,
      sourceType: record.sourceType,
      acceptedRowCount: record.acceptedRowCount,
      createdAt: record.createdAt,
    }))
  }
}
