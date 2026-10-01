// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CSV_MAX_BYTES, CSV_PREVIEW_ROWS, DatasetError } from '../dataset/csvTypes'
import { SAMPLE_DATASET_ID, sampleRows } from '../dataset/sampleDataset'
import type { DatasetRecord, DatasetStorage } from '../shared/dataset'
import { DatasetService, displayNameFrom, type PublicCsvFetcher } from './datasets'
import { ApiError } from './errors'
import { InMemoryDatasetStore } from './memoryStores'

const T0 = 1_700_000_000_000
const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const CSV = 'name,score\nalice,1\nbob,2\n'

let counter = 0
const createService = (options: { store?: DatasetStorage; fetchCsv?: PublicCsvFetcher } = {}) => {
  const store = 'store' in options ? options.store : new InMemoryDatasetStore(() => T0)
  const service = new DatasetService({ store, fetchCsv: options.fetchCsv, now: () => T0, idFactory: () => `ds-${(counter += 1)}` })
  return { service, store: store as InMemoryDatasetStore }
}

/** No lone surrogate halves (String#isWellFormed is newer than the project's TS lib). */
const isWellFormed = (text: string): boolean => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)

const failure = async (promise: Promise<unknown>): Promise<Error & { code?: string; statusCode?: number }> => {
  try {
    await promise
  } catch (error) {
    return error as Error & { code?: string; statusCode?: number }
  }
  throw new Error('expected a rejection')
}

afterEach(() => { vi.restoreAllMocks() })

describe('DatasetService.fromCsvBytes', () => {
  it('stores an upload and returns a preview without internal fields', async () => {
    const { service, store } = createService()
    const bytes = encode(CSV)
    const preview = await service.fromCsvBytes(bytes, 'my data.csv')
    expect(preview).toEqual({
      datasetId: expect.stringMatching(/^ds-/),
      sourceType: 'upload',
      displayName: 'my data.csv',
      byteSize: bytes.byteLength,
      delimiter: ',',
      columns: [{ name: 'name', inferredType: 'string' }, { name: 'score', inferredType: 'number' }],
      acceptedRowCount: 2,
      previewRows: [['alice', 1], ['bob', 2]],
      validationWarnings: [],
    })
    expect(preview).not.toHaveProperty('contentHash')
    expect(preview).not.toHaveProperty('sourceUrl')
    expect(await service.getRows(preview.datasetId, 0, 10)).toEqual([['alice', 1], ['bob', 2]])
    expect(await service.getRows(preview.datasetId, 1, 10)).toEqual([['bob', 2]])
    expect(await service.getRows(preview.datasetId, 5, 10)).toEqual([])
    expect(await service.getRows(preview.datasetId, 0, 0)).toEqual([])
    expect(await service.getPreview(preview.datasetId)).toEqual(preview)

    const record = await store.get(preview.datasetId)
    expect(record?.contentHash).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(record?.createdAt).toBe(T0)
    expect(record?.sourceType).toBe('upload')
  })

  it('hashes the raw bytes, not the parsed rows', async () => {
    const { service, store } = createService()
    const withCrlf = encode('name,score\r\nalice,1\r\n')
    const plain = encode('name,score\nalice,1\n')
    const first = await service.fromCsvBytes(withCrlf)
    const second = await service.fromCsvBytes(plain)
    expect((await store.get(first.datasetId))?.contentHash).not.toBe((await store.get(second.datasetId))?.contentHash)
  })

  it('uses the fallback name when no filename is given', async () => {
    const { service } = createService()
    expect((await service.fromCsvBytes(encode(CSV))).displayName).toBe('Uploaded CSV')
  })

  it('rejects a file over 4 MB with CSV_TOO_LARGE 413 and stores nothing', async () => {
    const { service, store } = createService()
    const error = await failure(service.fromCsvBytes(new Uint8Array(CSV_MAX_BYTES + 1).fill(97), 'big.csv'))
    expect(error).toBeInstanceOf(DatasetError)
    expect(error).toMatchObject({ code: 'CSV_TOO_LARGE', statusCode: 413 })
    expect(await store.listRecent(10)).toEqual([])
  })

  it('rejects empty and header-only files rather than storing an empty dataset', async () => {
    const { service, store } = createService()
    expect(await failure(service.fromCsvBytes(encode('')))).toBeInstanceOf(DatasetError)
    expect(await failure(service.fromCsvBytes(encode('a,b\n')))).toBeInstanceOf(DatasetError)
    expect(await store.listRecent(10)).toEqual([])
  })

  it('clips long cells in the preview only; stored rows keep the full value', async () => {
    const { service, store } = createService()
    const long = 'L'.repeat(1_000)
    const preview = await service.fromCsvBytes(encode(`id,text\n1,${long}\n2,short\n`), 'long.csv')
    const previewCell = preview.previewRows[0][1] as string
    expect(previewCell.length).toBeLessThan(long.length)
    expect(previewCell.startsWith('L'.repeat(300))).toBe(true)
    expect(previewCell.length).toBeLessThanOrEqual(301)
    expect(preview.previewRows[1]).toEqual([2, 'short'])
    expect((await store.get(preview.datasetId))?.previewRows[0][1]).toBe(previewCell)
    expect((await service.getRows(preview.datasetId, 0, 1))[0][1]).toBe(long)
  })

  it('keeps cells of exactly 300 characters intact', async () => {
    const { service } = createService()
    const exact = 'e'.repeat(300)
    const preview = await service.fromCsvBytes(encode(`id,text\n1,${exact}\n`))
    expect(preview.previewRows[0][1]).toBe(exact)
  })

  it('previews at most CSV_PREVIEW_ROWS rows but stores them all', async () => {
    const { service } = createService()
    const lines = Array.from({ length: 25 }, (_, index) => `${index},row${index}`)
    const preview = await service.fromCsvBytes(encode(`n,label\n${lines.join('\n')}\n`))
    expect(preview.previewRows).toHaveLength(CSV_PREVIEW_ROWS)
    expect(preview.acceptedRowCount).toBe(25)
    expect(await service.getRows(preview.datasetId, 0, 500)).toHaveLength(25)
  })

  // SOURCE BUG (minor): clipping uses String.slice(0, 300), which can cut a surrogate pair in half and persist an
  // ill-formed string (a lone surrogate) into the dataset record.
  it.fails('never stores a lone surrogate when clipping a preview cell inside an emoji', async () => {
    const { service } = createService()
    const cell = `${'a'.repeat(299)}😀${'b'.repeat(50)}`
    const preview = await service.fromCsvBytes(encode(`id,text\n1,${cell}\n`))
    expect(isWellFormed(preview.previewRows[0][1] as string)).toBe(true)
  })

  it('fails closed without storage (STORAGE_NOT_CONFIGURED 503), while the sample keeps working', async () => {
    const { service } = createService({ store: undefined })
    expect(service.storageReady).toBe(false)
    const unconfigured = await failure(service.fromCsvBytes(encode(CSV)))
    expect(unconfigured).toBeInstanceOf(ApiError)
    expect(unconfigured).toMatchObject({ code: 'STORAGE_NOT_CONFIGURED', statusCode: 503 })
    expect(await failure(service.fromPublicUrl('https://example.com/a.csv'))).toMatchObject({ code: 'STORAGE_NOT_CONFIGURED', statusCode: 503 })

    const preview = await service.getPreview(SAMPLE_DATASET_ID)
    expect(preview).toMatchObject({ datasetId: SAMPLE_DATASET_ID, sourceType: 'sample', acceptedRowCount: 71 })
    expect(preview.suggestion?.labelColumn).toBe('play_call')
    const record = await service.getRecord(SAMPLE_DATASET_ID)
    expect(record?.acceptedRowCount).toBe(71)
    expect(await service.getRows(SAMPLE_DATASET_ID, 0, 500)).toEqual(sampleRows())
    expect(await service.getRows(SAMPLE_DATASET_ID, 70, 10)).toEqual(sampleRows().slice(70))
    expect(await service.getRecord('anything-else')).toBeUndefined()
    expect(await service.listRecent(10)).toEqual([])
  })

  it('serves the sample when storage is configured too, without writing it', async () => {
    const { service, store } = createService()
    expect(service.storageReady).toBe(true)
    expect((await service.getPreview(SAMPLE_DATASET_ID)).displayName).toMatch(/Super Bowl/)
    expect(await store.listRecent(10)).toEqual([])
  })

  it('answers 404 DATASET_NOT_FOUND for an unknown id', async () => {
    const { service } = createService()
    expect(await failure(service.getPreview('nope'))).toMatchObject({ code: 'DATASET_NOT_FOUND', statusCode: 404 })
    expect(await service.getRecord('nope')).toBeUndefined()
    expect(await service.getRows('nope', 0, 10)).toEqual([])
  })

  it('turns a storage failure into DATASET_STORAGE_FAILED 503 without echoing the underlying error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const inner = new InMemoryDatasetStore()
    const store: DatasetStorage = {
      ...{ get: (id: string) => inner.get(id), getRows: (id: string, offset: number, limit: number) => inner.getRows(id, offset, limit), listRecent: (limit: number) => inner.listRecent(limit) },
      put: async (record: DatasetRecord) => { throw new Error(`Convex call failed with args {"authToken":"sk_live_SECRET","name":"${record.displayName}"}`) },
    }
    const { service } = createService({ store })
    const error = await failure(service.fromCsvBytes(encode(CSV), 'private-name.csv'))
    expect(error).toBeInstanceOf(DatasetError)
    expect(error).toMatchObject({ code: 'DATASET_STORAGE_FAILED', statusCode: 503 })
    for (const text of [error.message, String(error), JSON.stringify({ ...error })]) {
      expect(text).not.toContain('SECRET')
      expect(text).not.toContain('Convex')
      expect(text).not.toContain('private-name')
    }
  })

  it('lists recent datasets newest first with browse fields only', async () => {
    let clock = T0
    const store = new InMemoryDatasetStore(() => clock)
    const service = new DatasetService({ store, now: () => clock })
    await service.fromCsvBytes(encode(CSV), 'first.csv')
    clock += 1_000
    await service.fromCsvBytes(encode(CSV), 'second.csv')
    const items = await service.listRecent(10)
    expect(items.map((item) => item.displayName)).toEqual(['second.csv', 'first.csv'])
    expect(items[0]).toEqual({ datasetId: expect.any(String), displayName: 'second.csv', sourceType: 'upload', acceptedRowCount: 2, createdAt: T0 + 1_000 })
  })
})

describe('DatasetService.fromPublicUrl', () => {
  const fetched = (overrides: Partial<Awaited<ReturnType<PublicCsvFetcher>>> = {}): PublicCsvFetcher => async () => ({
    bytes: encode(CSV),
    finalUrl: 'https://cdn.example.com/data/My%20File.csv?token=1',
    contentType: 'text/csv; charset=utf-8',
    ...overrides,
  })

  it('stores finalUrl as the source, names the dataset from it, and hashes the fetched bytes', async () => {
    const requested: string[] = []
    const { service, store } = createService({ fetchCsv: async (url) => { requested.push(url); return fetched()(url) } })
    const preview = await service.fromPublicUrl('https://short.example/abc')
    expect(requested).toEqual(['https://short.example/abc'])
    expect(preview).toMatchObject({ sourceType: 'public_url', displayName: 'My File.csv', acceptedRowCount: 2 })
    const record = await store.get(preview.datasetId)
    expect(record?.sourceUrl).toBe('https://cdn.example.com/data/My%20File.csv?token=1')
    expect(record?.sourceType).toBe('public_url')
    expect(record?.contentHash).toBe(createHash('sha256').update(encode(CSV)).digest('hex'))
  })

  it.each(['text/html', 'application/json', 'image/png', 'application/pdf'])('rejects a %s response as NOT_CSV and stores nothing', async (contentType) => {
    const { service, store } = createService({ fetchCsv: fetched({ contentType }) })
    const error = await failure(service.fromPublicUrl('https://example.com/x'))
    expect(error).toBeInstanceOf(DatasetError)
    expect(error.code).toBe('NOT_CSV')
    expect(await store.listRecent(10)).toEqual([])
  })

  it.each(['text/csv', 'text/plain; charset=utf-8', 'application/octet-stream', undefined])('accepts content type %s', async (contentType) => {
    const { service } = createService({ fetchCsv: fetched({ contentType }) })
    await expect(service.fromPublicUrl('https://example.com/x')).resolves.toMatchObject({ acceptedRowCount: 2 })
  })

  it('propagates a fetch refusal unchanged and stores nothing', async () => {
    const refusal = new DatasetError('URL_NOT_PUBLIC', 'That address is not public.')
    const { service, store } = createService({ fetchCsv: async () => { throw refusal } })
    expect(await failure(service.fromPublicUrl('http://10.0.0.1/x'))).toBe(refusal)
    expect(await store.listRecent(10)).toEqual([])
  })

  it('rejects a fetched file that is not parseable CSV', async () => {
    const { service } = createService({ fetchCsv: fetched({ bytes: encode(''), contentType: 'text/csv' }) })
    expect(await failure(service.fromPublicUrl('https://example.com/x'))).toBeInstanceOf(DatasetError)
  })
})

describe('displayNameFrom', () => {
  it('uses the fallback for missing or blank input', () => {
    expect(displayNameFrom(undefined, 'Fallback')).toBe('Fallback')
    expect(displayNameFrom('', 'Fallback')).toBe('Fallback')
    expect(displayNameFrom('   ', 'Fallback')).toBe('Fallback')
    expect(displayNameFrom('///', 'Fallback')).toBe('Fallback')
    expect(displayNameFrom('https://example.com/', 'Fallback')).toBe('Fallback')
    expect(displayNameFrom('\u0000\u0007\n', 'Fallback')).toBe('Fallback')
  })

  it('keeps only the last path segment, so traversal and Windows paths cannot leak directories', () => {
    expect(displayNameFrom('../../etc/passwd', 'F')).toBe('passwd')
    expect(displayNameFrom('/var/secrets/key.csv', 'F')).toBe('key.csv')
    expect(displayNameFrom('C:\\Users\\me\\Documents\\data.csv', 'F')).toBe('data.csv')
    expect(displayNameFrom('..\\..\\windows\\system32\\drivers.csv', 'F')).toBe('drivers.csv')
    expect(displayNameFrom('folder/sub/', 'F')).toBe('sub')
    expect(displayNameFrom('plain.csv', 'F')).toBe('plain.csv')
  })

  it('decodes the path of a URL and drops the query and fragment', () => {
    expect(displayNameFrom('https://example.com/a/b/my%20data%20set.csv?x=1#frag', 'F')).toBe('my data set.csv')
    expect(displayNameFrom('https://example.com/%E2%9C%93%20done.csv', 'F')).toBe('✓ done.csv')
    expect(displayNameFrom('https://example.com/a%2F..%2Fsecret.csv', 'F')).toBe('secret.csv')
    expect(displayNameFrom('HTTP://EXAMPLE.com/Upper.CSV', 'F')).toBe('Upper.CSV')
  })

  it('survives a URL with broken percent-encoding', () => {
    const name = displayNameFrom('https://example.com/%E0%A4%A.csv', 'F')
    expect(name).toBeTruthy()
    expect(name).not.toContain('/')
  })

  it('strips control characters and collapses whitespace', () => {
    expect(displayNameFrom('a\u0000b\u001f\u007fc.csv', 'F')).toBe('abc.csv')
    expect(displayNameFrom('weird\r\nname  with\t spaces.csv', 'F')).toBe('weirdname with spaces.csv')
    expect(displayNameFrom('  padded name.csv  ', 'F')).toBe('padded name.csv')
  })

  it('bounds the name to 120 characters', () => {
    expect(displayNameFrom(`${'n'.repeat(300)}.csv`, 'F')).toHaveLength(120)
    expect(displayNameFrom('m'.repeat(120), 'F')).toHaveLength(120)
    expect(displayNameFrom(`https://example.com/${'u'.repeat(500)}.csv`, 'F')).toHaveLength(120)
  })

  // SOURCE BUG (minor): String.slice(0, 120) can cut an emoji in half, leaving an ill-formed name.
  it.fails('does not cut a surrogate pair when truncating', () => {
    expect(isWellFormed(displayNameFrom(`${'a'.repeat(119)}😀.csv`, 'F'))).toBe(true)
  })
})
