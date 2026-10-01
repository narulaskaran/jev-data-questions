import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { assertAuthorized } from './auth'
import { datasetRecordFields, rowValuesValidator } from './schema'

// Mirrors src/dataset/csvTypes.ts: Convex functions cannot import from src/.
const MAX_ROWS = 5_000
const MAX_COLUMNS = 100
const MAX_BYTES = 4 * 1024 * 1024
const MAX_PREVIEW_ROWS = 8
const MAX_ID_LENGTH = 64
const MAX_NAME_LENGTH = 200
const MAX_CHUNK_ROWS = 200
const MAX_CHUNKS_PER_CALL = 32
const MAX_READ_ROWS = 500
const MAX_LIST = 50

const recordValidator = v.object(datasetRecordFields)

const compact = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T

const check = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const toRecord = (doc: Doc<'datasets'>) => compact({
  datasetId: doc.datasetId,
  sourceType: doc.sourceType,
  displayName: doc.displayName,
  byteSize: doc.byteSize,
  contentHash: doc.contentHash,
  delimiter: doc.delimiter,
  columns: doc.columns,
  acceptedRowCount: doc.acceptedRowCount,
  previewRows: doc.previewRows,
  validationWarnings: doc.validationWarnings,
  sourceUrl: doc.sourceUrl,
  createdAt: doc.createdAt,
})

const findDataset = (ctx: { db: { query: (table: 'datasets') => any } }, datasetId: string): Promise<Doc<'datasets'> | null> =>
  ctx.db.query('datasets').withIndex('by_dataset_id', (q: any) => q.eq('datasetId', datasetId)).unique()

/**
 * Step 1 of an upload. Returns `exists` when a ready dataset already has this
 * ID (datasets are immutable). An unfinished earlier attempt is reset.
 */
export const createDataset = mutation({
  args: { authToken: v.string(), record: recordValidator },
  handler: async (ctx, { authToken, record }): Promise<'created' | 'exists'> => {
    assertAuthorized(authToken)
    check(record.datasetId.length > 0 && record.datasetId.length <= MAX_ID_LENGTH, 'Invalid datasetId')
    check(record.displayName.length <= MAX_NAME_LENGTH, 'displayName too long')
    check(record.columns.length <= MAX_COLUMNS && record.columns.every((column) => column.name.length <= MAX_NAME_LENGTH), 'Invalid columns')
    check(Number.isInteger(record.acceptedRowCount) && record.acceptedRowCount >= 0 && record.acceptedRowCount <= MAX_ROWS, 'Invalid acceptedRowCount')
    check(Number.isFinite(record.byteSize) && record.byteSize >= 0 && record.byteSize <= MAX_BYTES, 'Invalid byteSize')
    check(record.previewRows.length <= MAX_PREVIEW_ROWS && record.previewRows.every((row) => row.length <= MAX_COLUMNS), 'Invalid previewRows')
    const existing = await findDataset(ctx, record.datasetId)
    if (existing?.ready) return 'exists'
    const now = Date.now()
    if (existing) {
      const stale = await ctx.db.query('datasetChunks').withIndex('by_dataset_start', (q) => q.eq('datasetId', record.datasetId)).collect()
      for (const chunk of stale) await ctx.db.delete(chunk._id)
      await ctx.db.replace(existing._id, compact({ ...record, createdAt: now, ready: false }))
    } else {
      await ctx.db.insert('datasets', compact({ ...record, createdAt: now, ready: false }))
    }
    return 'created'
  },
})

/** Step 2, repeatable. Chunks already stored at a `startIndex` are skipped, so retries are safe. */
export const appendDatasetChunk = mutation({
  args: {
    authToken: v.string(),
    datasetId: v.string(),
    chunks: v.array(v.object({ startIndex: v.number(), rows: v.array(rowValuesValidator) })),
  },
  handler: async (ctx, { authToken, datasetId, chunks }): Promise<number> => {
    assertAuthorized(authToken)
    check(chunks.length <= MAX_CHUNKS_PER_CALL, 'Too many chunks in one call')
    const dataset = await findDataset(ctx, datasetId)
    check(dataset !== null && !dataset.ready, 'Dataset is not accepting rows')
    let stored = 0
    for (const chunk of chunks) {
      check(Number.isInteger(chunk.startIndex) && chunk.startIndex >= 0, 'Invalid startIndex')
      check(chunk.rows.length > 0 && chunk.rows.length <= MAX_CHUNK_ROWS, 'Invalid chunk size')
      check(chunk.startIndex + chunk.rows.length <= MAX_ROWS, 'Too many rows')
      check(chunk.rows.every((row) => row.length <= MAX_COLUMNS), 'Row has too many columns')
      const existing = await ctx.db
        .query('datasetChunks')
        .withIndex('by_dataset_start', (q) => q.eq('datasetId', datasetId).eq('startIndex', chunk.startIndex))
        .first()
      if (existing) continue
      await ctx.db.insert('datasetChunks', { datasetId, startIndex: chunk.startIndex, rows: chunk.rows })
      stored += chunk.rows.length
    }
    return stored
  },
})

/** Step 3. Makes the dataset readable once the stored rows are exactly `0..acceptedRowCount-1`. */
export const finalizeDataset = mutation({
  args: { authToken: v.string(), datasetId: v.string() },
  handler: async (ctx, { authToken, datasetId }): Promise<void> => {
    assertAuthorized(authToken)
    const dataset = await findDataset(ctx, datasetId)
    check(dataset !== null, 'Dataset not found')
    if (!dataset || dataset.ready) return
    const chunks = await ctx.db.query('datasetChunks').withIndex('by_dataset_start', (q) => q.eq('datasetId', datasetId)).collect()
    let next = 0
    for (const chunk of chunks) {
      check(chunk.startIndex === next, 'Dataset chunks are not contiguous')
      next += chunk.rows.length
    }
    check(next === dataset.acceptedRowCount, `Dataset has ${next} rows, expected ${dataset.acceptedRowCount}`)
    await ctx.db.patch(dataset._id, { ready: true })
  },
})

export const get = query({
  args: { datasetId: v.string() },
  handler: async (ctx, { datasetId }) => {
    const dataset = await findDataset(ctx, datasetId)
    return dataset?.ready ? toRecord(dataset) : null
  },
})

export const getRows = query({
  args: { datasetId: v.string(), offset: v.number(), limit: v.number() },
  handler: async (ctx, { datasetId, offset, limit }) => {
    const start = Math.floor(offset)
    const count = Math.min(MAX_READ_ROWS, Math.floor(limit))
    const dataset = await findDataset(ctx, datasetId)
    if (!dataset?.ready || !(start >= 0) || !(count > 0) || start >= dataset.acceptedRowCount) return []
    const end = start + count
    // The chunk containing `start` begins at or before it; later chunks are read only up to `end`.
    const first = await ctx.db
      .query('datasetChunks')
      .withIndex('by_dataset_start', (q) => q.eq('datasetId', datasetId).lte('startIndex', start))
      .order('desc')
      .first()
    const chunks = await ctx.db
      .query('datasetChunks')
      .withIndex('by_dataset_start', (q) => q.eq('datasetId', datasetId).gte('startIndex', first?.startIndex ?? start).lt('startIndex', end))
      .collect()
    const rows: Doc<'datasetChunks'>['rows'] = []
    for (const chunk of chunks) {
      const from = Math.max(start, chunk.startIndex) - chunk.startIndex
      const to = Math.min(end, chunk.startIndex + chunk.rows.length) - chunk.startIndex
      if (to > from) rows.push(...chunk.rows.slice(from, to))
    }
    return rows
  },
})

export const listRecent = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const take = Math.min(MAX_LIST, Math.floor(limit))
    if (!(take > 0)) return []
    const docs = await ctx.db
      .query('datasets')
      .withIndex('by_ready_created_at', (q) => q.eq('ready', true))
      .order('desc')
      .take(take)
    return docs.map(toRecord)
  },
})
