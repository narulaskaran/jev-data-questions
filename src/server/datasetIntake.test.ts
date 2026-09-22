import { describe, expect, it, vi } from 'vitest'
import { CSV_PREVIEW_ROWS, DatasetError } from '../dataset/csvTypes'
import { DatasetIntakeService } from './datasetIntake'
import { InMemoryDatasetStore } from './datasetStore'
import { InMemoryBlobStore, UnconfiguredBlobStore } from './uploadthing'
import { AnalysisError } from './analysis'

const csv = 'label,count\nurgent,2\nroutine,1\n'

describe('dataset intake', () => {
  it('fails file upload without UploadThing, keeps public URL when Convex is up, and fails URL without Convex', async () => {
    const missingBlob = new DatasetIntakeService({
      datasets: new InMemoryDatasetStore(),
      blobs: new UnconfiguredBlobStore(),
      convexConfigured: true,
    })
    await expect(missingBlob.fromCsvText({ csvText: csv, filename: 'n.csv' })).rejects.toMatchObject({ code: 'UPLOADTHING_NOT_CONFIGURED', statusCode: 503 })
    expect(missingBlob.status()).toEqual({ convex: true, uploadThing: false, sampleAvailable: true })

    const fetched = new TextEncoder().encode(csv)
    const fetchMock: typeof fetch = vi.fn(async () => (
      new Response(fetched, { status: 200, headers: { 'content-type': 'text/csv' } })
    ))
    const urlWithoutBlob = new DatasetIntakeService({
      datasets: new InMemoryDatasetStore(),
      blobs: new UnconfiguredBlobStore(),
      convexConfigured: true,
      fetch: fetchMock,
      lookup: async () => ['93.184.216.34'],
    })
    const fromUrl = await urlWithoutBlob.fromPublicUrl({ url: 'https://example.com/data.csv' })
    expect(fromUrl.sourceType).toBe('public_url')
    expect(fromUrl.acceptedRowCount).toBe(2)
    expect(fromUrl.previewRows).toHaveLength(2)

    const missingConvex = new DatasetIntakeService({
      datasets: new InMemoryDatasetStore(),
      blobs: new InMemoryBlobStore(),
      convexConfigured: false,
    })
    await expect(missingConvex.fromPublicUrl({ url: 'https://example.com/data.csv' })).rejects.toBeInstanceOf(AnalysisError)
    await expect(missingConvex.fromPublicUrl({ url: 'https://example.com/data.csv' })).rejects.toMatchObject({ code: 'ANALYSIS_STORAGE_NOT_CONFIGURED', statusCode: 503 })
  })

  it('accepts CSV text and a public HTTPS CSV URL after server-side validation', async () => {
    const store = new InMemoryDatasetStore()
    const blobs = new InMemoryBlobStore()
    const fetched = new TextEncoder().encode(csv)
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      expect(String(input)).toBe('https://example.com/data.csv')
      return new Response(fetched, { status: 200, headers: { 'content-type': 'text/csv' } })
    })
    const intake = new DatasetIntakeService({ datasets: store, blobs, convexConfigured: true, fetch: fetchMock, lookup: async () => ['93.184.216.34'] })
    const uploaded = await intake.fromCsvText({ csvText: csv, filename: 'tickets.csv' })
    expect(uploaded.sourceType).toBe('upload')
    expect(uploaded.acceptedRowCount).toBe(2)
    expect(uploaded.previewRows[0]).toEqual({ label: 'urgent', count: 2 })
    expect(uploaded.previewRows).toHaveLength(2)
    const fromUrl = await intake.fromPublicUrl({ url: 'https://example.com/data.csv' })
    expect(fromUrl.sourceType).toBe('public_url')
    expect(fromUrl.acceptedRowCount).toBe(2)
    expect(fromUrl.previewRows).toHaveLength(2)
    expect(store.get(fromUrl.datasetId)?.sourceUrl).toBe('https://example.com/data.csv')
  })

  it('returns the full accepted table on intake and get without enlarging stored previewRows', async () => {
    const store = new InMemoryDatasetStore()
    const intake = new DatasetIntakeService({
      datasets: store,
      blobs: new InMemoryBlobStore(),
      convexConfigured: true,
    })
    const csvText = ['id,name', ...Array.from({ length: 20 }, (_, index) => `${index},n${index}`)].join('\n')
    const uploaded = await intake.fromCsvText({ csvText, filename: 'wide.csv' })
    expect(uploaded.previewRows).toHaveLength(20)
    expect(uploaded.acceptedRowCount).toBe(20)
    expect(store.get(uploaded.datasetId)?.previewRows).toHaveLength(CSV_PREVIEW_ROWS)
    expect(store.getRows(uploaded.datasetId)).toHaveLength(20)
    const readBack = await intake.get(uploaded.datasetId)
    expect(readBack.previewRows).toHaveLength(20)
  })

  it('rejects private URLs before fetch', async () => {
    const intake = new DatasetIntakeService({
      datasets: new InMemoryDatasetStore(),
      blobs: new InMemoryBlobStore(),
      convexConfigured: true,
      fetch: vi.fn(async () => { throw new Error('should not fetch') }),
    })
    await expect(intake.fromPublicUrl({ url: 'https://127.0.0.1/secret.csv' })).rejects.toBeInstanceOf(DatasetError)
    await expect(intake.fromPublicUrl({ url: 'http://example.com/data.csv' })).rejects.toMatchObject({ code: 'URL_NOT_HTTPS' })
  })

  it('maps datasets.put throws to CONVEX_PUT_FAILED instead of UNCAUGHT', async () => {
    const intake = new DatasetIntakeService({
      datasets: {
        get: () => undefined,
        put: async () => { throw new Error('undefined is not a valid Convex value') },
        getRows: () => [],
      },
      blobs: new InMemoryBlobStore(),
      convexConfigured: true,
    })
    const error = await intake.fromCsvText({ csvText: csv, filename: 'n.csv' }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DatasetError)
    expect(error).toMatchObject({
      code: 'DATASET_INTAKE_UNAVAILABLE',
      failure: 'CONVEX_PUT_FAILED',
      statusCode: 503,
      message: 'Convex rejected undefined fields in the dataset payload.',
    })
    expect((error as DatasetError).failure).not.toBe('UNCAUGHT')
  })
})
