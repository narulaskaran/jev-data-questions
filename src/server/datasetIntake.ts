import { DatasetError, PUBLIC_DATA_WARNING } from '../dataset/csvTypes.js'
import { validateCsvBytes, validateCsvText } from '../dataset/validateDataset.js'
import type { DatasetIntakeStatus, DatasetPreview } from '../shared/dataset.js'
import { AnalysisError } from './analysis.js'
import { wrapConvexPutError } from './convexDatasetPut.js'
import { fetchPublicCsv, type DatasetFetchOptions } from './datasetFetch.js'
import { analysisSourceFromDatasetStore, hashBytes, toDatasetPreview, toDatasetRecord, type DatasetStorage } from './datasetStore.js'
import { UnconfiguredBlobStore, type CsvBlobStore } from './uploadthing.js'

export interface DatasetIntakeServiceOptions {
  datasets: DatasetStorage
  blobs: CsvBlobStore
  convexConfigured: boolean
  fetch?: DatasetFetchOptions['fetch']
  lookup?: DatasetFetchOptions['lookup']
  now?: () => number
}

const displayNameFrom = (filenameOrUrl: string | undefined, fallback: string): string => {
  if (!filenameOrUrl?.trim()) return fallback
  try {
    const url = new URL(filenameOrUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    return decodeURIComponent(parts[parts.length - 1] || fallback).slice(0, 120)
  } catch {
    return filenameOrUrl.replace(/\s+/g, ' ').trim().slice(0, 120) || fallback
  }
}

const requireConvex = (options: DatasetIntakeServiceOptions): void => {
  if (!options.convexConfigured) throw new AnalysisError('ANALYSIS_STORAGE_NOT_CONFIGURED', 'Durable storage is not configured on this deployment.', 503, true)
}

const requireBlobs = (options: DatasetIntakeServiceOptions): void => {
  if (!options.blobs.isConfigured()) throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', 'CSV storage is not configured on this deployment.', 503)
}

export class DatasetIntakeService {
  constructor(private readonly options: DatasetIntakeServiceOptions) {}

  status(): DatasetIntakeStatus {
    return {
      convex: this.options.convexConfigured,
      uploadThing: this.options.blobs.isConfigured(),
      sampleAvailable: true,
    }
  }

  analysisSource() {
    return analysisSourceFromDatasetStore(this.options.datasets)
  }

  async fromCsvText(input: { csvText: string; filename?: string; displayName?: string }): Promise<DatasetPreview> {
    requireConvex(this.options)
    requireBlobs(this.options)
    if (typeof input.csvText !== 'string' || !input.csvText.trim()) throw new DatasetError('CSV_EMPTY', 'The CSV has no data rows.')
    const validated = validateCsvText(input.csvText)
    const bytes = new TextEncoder().encode(input.csvText)
    return this.persist({ bytes, validated, sourceType: 'upload', displayName: input.displayName || displayNameFrom(input.filename, 'Uploaded CSV'), filename: input.filename || 'upload.csv' })
  }

  async fromCsvBytes(input: { bytes: Uint8Array; filename?: string; displayName?: string }): Promise<DatasetPreview> {
    requireConvex(this.options)
    requireBlobs(this.options)
    const validated = validateCsvBytes(input.bytes)
    return this.persist({ bytes: input.bytes, validated, sourceType: 'upload', displayName: input.displayName || displayNameFrom(input.filename, 'Uploaded CSV'), filename: input.filename || 'upload.csv' })
  }

  async fromPublicUrl(input: { url: string; displayName?: string }): Promise<DatasetPreview> {
    requireConvex(this.options)
    const fetched = await fetchPublicCsv(input.url, { fetch: this.options.fetch, lookup: this.options.lookup })
    const validated = validateCsvBytes(fetched.bytes)
    const sanitizedUrl = fetched.finalUrl
    return this.persist({
      bytes: fetched.bytes,
      validated,
      sourceType: 'public_url',
      displayName: input.displayName || displayNameFrom(sanitizedUrl, 'Public CSV'),
      filename: displayNameFrom(sanitizedUrl, 'dataset.csv'),
      sourceUrl: sanitizedUrl,
    })
  }

  async get(datasetId: string): Promise<DatasetPreview> {
    if (!this.options.convexConfigured) throw new AnalysisError('ANALYSIS_STORAGE_NOT_CONFIGURED', 'Durable storage is not configured on this deployment.', 503, true)
    const dataset = await this.options.datasets.get(datasetId)
    if (!dataset) throw new DatasetError('DATASET_NOT_FOUND', 'That dataset was not found.', 404)
    const rows = await this.options.datasets.getRows(datasetId)
    const preview = toDatasetPreview(dataset)
    return rows.length > 0 ? { ...preview, previewRows: [...rows] } : preview
  }

  async listPublic() {
    if (!this.options.convexConfigured) return []
    return [...(await this.options.datasets.listPublic?.() ?? [])]
  }

  private async persist(input: {
    bytes: Uint8Array
    validated: ReturnType<typeof validateCsvText>
    sourceType: 'upload' | 'public_url'
    displayName: string
    filename: string
    sourceUrl?: string
  }): Promise<DatasetPreview> {
    let blobKey: string | undefined
    if (this.options.blobs.isConfigured()) {
      try {
        const blob = await this.options.blobs.putCsv({ bytes: input.bytes, filename: input.filename, contentType: 'text/csv' })
        blobKey = blob.blobKey
      } catch (error) {
        if (error instanceof DatasetError || error instanceof AnalysisError) throw error
        const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(error.name) ? error.name : 'Error'
        throw new DatasetError('UPLOADTHING_FAILED', `UploadThing ingest failed (${name}).`, 503, 'INGEST_RUNTIME')
      }
    } else if (input.sourceType !== 'public_url' || !input.sourceUrl) {
      requireBlobs(this.options)
    }
    const record = toDatasetRecord({
      sourceType: input.sourceType,
      displayName: input.displayName,
      validated: input.validated,
      contentHash: hashBytes(input.bytes),
      blobKey,
      sourceUrl: input.sourceUrl,
      createdAt: this.options.now?.() ?? Date.now(),
    })
    try {
      await this.options.datasets.put(record, input.validated.rows)
    } catch (error) {
      if (error instanceof AnalysisError) throw error
      wrapConvexPutError(error)
    }
    return { ...toDatasetPreview(record), previewRows: input.validated.rows, publicDataWarning: PUBLIC_DATA_WARNING }
  }
}

export const unconfiguredIntake = (): DatasetIntakeService => new DatasetIntakeService({
  datasets: {
    get: () => undefined,
    put: () => undefined,
    getRows: () => [],
  },
  blobs: new UnconfiguredBlobStore(),
  convexConfigured: false,
})
