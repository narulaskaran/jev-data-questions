import { beforeEach, describe, expect, it } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api'
import schema from './schema'

const modules = (import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob('./**/*.ts')
const secret = ['dataset', 'convex', 'test', 'auth'].join('-')
const record = {
  datasetId: 'd1',
  sourceType: 'upload' as const,
  displayName: 'd1.csv',
  byteSize: 100,
  contentHash: 'h',
  delimiter: ',',
  columns: [{ name: 'a', inferredType: 'string' as const }],
  acceptedRowCount: 3,
  previewRows: [['x']],
  validationWarnings: [],
  createdAt: 1,
}
const rows = [['r0'], ['r1'], ['r2']]

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = secret
})

describe('dataset authorization', () => {
  const calls = (t: ReturnType<typeof convexTest>, authToken: string) => ({
    createDataset: () => t.mutation(api.datasets.createDataset, { authToken, record }),
    appendDatasetChunk: () => t.mutation(api.datasets.appendDatasetChunk, { authToken, datasetId: 'd1', chunks: [{ startIndex: 0, rows }] }),
    finalizeDataset: () => t.mutation(api.datasets.finalizeDataset, { authToken, datasetId: 'd1' }),
  })

  it.each(['createDataset', 'appendDatasetChunk', 'finalizeDataset'] as const)('rejects wrong and empty tokens on %s', async (name) => {
    const t = convexTest(schema, modules)
    await expect(calls(t, 'wrong')[name]()).rejects.toThrow(/Unauthorized/)
    await expect(calls(t, '')[name]()).rejects.toThrow(/Unauthorized/)
  })

  it.each(['createDataset', 'appendDatasetChunk', 'finalizeDataset'] as const)('fails closed on %s when CONVEX_WRITE_SECRET is unset', async (name) => {
    const t = convexTest(schema, modules)
    delete process.env.CONVEX_WRITE_SECRET
    await expect(calls(t, '')[name]()).rejects.toThrow(/Unauthorized/)
    await expect(calls(t, 'anything')[name]()).rejects.toThrow(/Unauthorized/)
  })
})

describe('dataset upload protocol', () => {
  const create = (t: ReturnType<typeof convexTest>, overrides: Record<string, unknown> = {}) =>
    t.mutation(api.datasets.createDataset, { authToken: secret, record: { ...record, ...overrides } })
  const append = (t: ReturnType<typeof convexTest>, chunks: { startIndex: number; rows: (string | number | boolean | null)[][] }[]) =>
    t.mutation(api.datasets.appendDatasetChunk, { authToken: secret, datasetId: 'd1', chunks })
  const finalize = (t: ReturnType<typeof convexTest>) => t.mutation(api.datasets.finalizeDataset, { authToken: secret, datasetId: 'd1' })

  it('hides a dataset until it is finalized', async () => {
    const t = convexTest(schema, modules)
    await create(t)
    await append(t, [{ startIndex: 0, rows }])
    expect(await t.query(api.datasets.get, { datasetId: 'd1' })).toBeNull()
    expect(await t.query(api.datasets.getRows, { datasetId: 'd1', offset: 0, limit: 10 })).toEqual([])
    expect(await t.query(api.datasets.listRecent, { limit: 10 })).toEqual([])
    await finalize(t)
    expect((await t.query(api.datasets.get, { datasetId: 'd1' }))?.datasetId).toBe('d1')
    expect(await t.query(api.datasets.getRows, { datasetId: 'd1', offset: 1, limit: 10 })).toEqual(rows.slice(1))
    expect(await t.query(api.datasets.listRecent, { limit: 10 })).toHaveLength(1)
  })

  it('refuses to finalize with missing, short or non-contiguous rows', async () => {
    const t = convexTest(schema, modules)
    await create(t)
    await expect(finalize(t)).rejects.toThrow(/expected 3/)
    await append(t, [{ startIndex: 0, rows: rows.slice(0, 2) }])
    await expect(finalize(t)).rejects.toThrow(/expected 3/)
    await append(t, [{ startIndex: 3, rows: rows.slice(2) }])
    await expect(finalize(t)).rejects.toThrow(/contiguous/)
    expect(await t.query(api.datasets.get, { datasetId: 'd1' })).toBeNull()
  })

  it('refuses to finalize an unknown dataset or append to one', async () => {
    const t = convexTest(schema, modules)
    await expect(finalize(t)).rejects.toThrow()
    await expect(append(t, [{ startIndex: 0, rows }])).rejects.toThrow()
  })

  it('skips chunks that were already stored, so retries do not duplicate rows', async () => {
    const t = convexTest(schema, modules)
    await create(t)
    expect(await append(t, [{ startIndex: 0, rows: rows.slice(0, 2) }])).toBe(2)
    expect(await append(t, [{ startIndex: 0, rows: rows.slice(0, 2) }, { startIndex: 2, rows: rows.slice(2) }])).toBe(1)
    await finalize(t)
    expect(await t.query(api.datasets.getRows, { datasetId: 'd1', offset: 0, limit: 10 })).toEqual(rows)
  })

  it('is immutable once ready and resets an unfinished attempt', async () => {
    const t = convexTest(schema, modules)
    expect(await create(t)).toBe('created')
    await append(t, [{ startIndex: 0, rows: [['stale']] }])
    expect(await create(t, { displayName: 'second.csv' })).toBe('created')
    await append(t, [{ startIndex: 0, rows }])
    await finalize(t)
    expect(await create(t, { displayName: 'third.csv' })).toBe('exists')
    await expect(append(t, [{ startIndex: 3, rows: [['late']] }])).rejects.toThrow()
    expect((await t.query(api.datasets.get, { datasetId: 'd1' }))?.displayName).toBe('second.csv')
    expect(await t.query(api.datasets.getRows, { datasetId: 'd1', offset: 0, limit: 10 })).toEqual(rows)
  })

  it('enforces bounds', async () => {
    const t = convexTest(schema, modules)
    await expect(create(t, { datasetId: 'x'.repeat(65) })).rejects.toThrow()
    await expect(create(t, { acceptedRowCount: 5_001 })).rejects.toThrow()
    await expect(create(t, { byteSize: 4 * 1024 * 1024 + 1 })).rejects.toThrow()
    await expect(create(t, { previewRows: new Array(9).fill(['x']) })).rejects.toThrow()
    await create(t)
    await expect(append(t, [{ startIndex: 0, rows: new Array(201).fill(['x']) }])).rejects.toThrow()
    await expect(append(t, [{ startIndex: 4_900, rows: new Array(101).fill(['x']) }])).rejects.toThrow()
    await expect(append(t, [{ startIndex: 0, rows: [{ a: 1 } as never] }])).rejects.toThrow()
  })

  it('reads only the chunks that overlap the requested range', async () => {
    const t = convexTest(schema, modules)
    const all = Array.from({ length: 450 }, (_, index) => [index])
    await create(t, { acceptedRowCount: 450 })
    await append(t, [0, 100, 200, 300, 400].map((startIndex) => ({ startIndex, rows: all.slice(startIndex, startIndex + 100) })))
    await finalize(t)
    expect(await t.query(api.datasets.getRows, { datasetId: 'd1', offset: 250, limit: 100 })).toEqual(all.slice(250, 350))
    expect(await t.query(api.datasets.getRows, { datasetId: 'd1', offset: 100, limit: 100 })).toEqual(all.slice(100, 200))
    expect(await t.query(api.datasets.getRows, { datasetId: 'd1', offset: 449, limit: 100 })).toEqual(all.slice(449))
  })
})
