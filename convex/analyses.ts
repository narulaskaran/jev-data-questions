import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { assertAuthorized } from './auth'
import { analysisMetaFields, analysisRowFields, rowErrorValidator } from './schema'

// Mirrors src/shared/analysis.ts: Convex functions cannot import from src/.
const MAX_ROWS = 5_000
const MIN_CLASSES = 2
const MAX_CLASSES = 32
const MAX_CLASS_LENGTH = 80
const MAX_CLASS_DESCRIPTION_LENGTH = 300
const MAX_QUERY_LENGTH = 4_000
const MAX_ID_LENGTH = 64
const MAX_COLUMNS = 100
const MAX_NAME_LENGTH = 200
const MAX_APPEND_ROWS = 64
const MAX_READ_ROWS = 500
const MAX_LIST = 50
const MAX_LEASE_MS = 10 * 60_000

const recordValidator = v.object({ ...analysisMetaFields, controlTokenHash: v.string() })
const rowValidator = v.object(analysisRowFields)

const compact = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T

const check = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

const isCount = (value: number, max: number): boolean => Number.isInteger(value) && value >= 0 && value <= max

const toMeta = (doc: Doc<'analyses'>) => compact({
  analysisId: doc.analysisId,
  datasetId: doc.datasetId,
  datasetName: doc.datasetName,
  sourceType: doc.sourceType,
  query: doc.query,
  classes: doc.classes,
  columns: doc.columns,
  labelColumn: doc.labelColumn,
  status: doc.status,
  mode: doc.mode,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
  startedAt: doc.startedAt,
  completedAt: doc.completedAt,
  progress: doc.progress,
  error: doc.error,
})

const toRow = (doc: Doc<'analysisRows'>) => compact({
  rowIndex: doc.rowIndex,
  model: doc.model,
  selectedClass: doc.selectedClass,
  probabilities: doc.probabilities,
  confidence: doc.confidence,
  latencyMs: doc.latencyMs,
  error: doc.error,
})

const findAnalysis = (ctx: { db: { query: (table: 'analyses') => any } }, analysisId: string): Promise<Doc<'analyses'> | null> =>
  ctx.db.query('analyses').withIndex('by_analysis_id', (q: any) => q.eq('analysisId', analysisId)).unique()

const validateLease = (leaseMs: number, ownerToken: string): void => {
  check(Number.isFinite(leaseMs) && leaseMs > 0 && leaseMs <= MAX_LEASE_MS, 'Invalid lease')
  check(ownerToken.length > 0 && ownerToken.length <= 200, 'Invalid owner token')
}

export const create = mutation({
  args: { authToken: v.string(), record: recordValidator },
  handler: async (ctx, { authToken, record }): Promise<'created' | 'exists'> => {
    assertAuthorized(authToken)
    check(record.analysisId.length > 0 && record.analysisId.length <= MAX_ID_LENGTH, 'Invalid analysisId')
    check(record.datasetId.length > 0 && record.datasetId.length <= MAX_ID_LENGTH, 'Invalid datasetId')
    check(record.datasetName.length <= MAX_NAME_LENGTH, 'datasetName too long')
    check(record.query.length <= MAX_QUERY_LENGTH, 'query too long')
    check(record.classes.length >= MIN_CLASSES && record.classes.length <= MAX_CLASSES, 'Invalid class count')
    check(
      record.classes.every((entry) => entry.name.length > 0 && entry.name.length <= MAX_CLASS_LENGTH && entry.description.length <= MAX_CLASS_DESCRIPTION_LENGTH),
      'Invalid class',
    )
    check(record.columns.length <= MAX_COLUMNS && record.columns.every((name) => name.length <= MAX_NAME_LENGTH), 'Invalid columns')
    check(isCount(record.progress.totalRows, MAX_ROWS), 'Invalid totalRows')
    if (await findAnalysis(ctx, record.analysisId)) return 'exists'
    const now = Date.now()
    await ctx.db.insert('analyses', compact({ ...record, createdAt: now, updatedAt: now }))
    return 'created'
  },
})

export const getRecord = query({
  args: { authToken: v.string(), analysisId: v.string() },
  handler: async (ctx, { authToken, analysisId }) => {
    assertAuthorized(authToken)
    const doc = await findAnalysis(ctx, analysisId)
    return doc ? { ...toMeta(doc), controlTokenHash: doc.controlTokenHash } : null
  },
})

export const readPage = query({
  args: { analysisId: v.string(), after: v.number(), limit: v.number() },
  handler: async (ctx, { analysisId, after, limit }) => {
    const doc = await findAnalysis(ctx, analysisId)
    if (!doc) return null
    const take = Math.min(MAX_READ_ROWS, Math.floor(limit))
    const docs = take > 0
      ? await ctx.db
        .query('analysisRows')
        .withIndex('by_analysis_row', (q) => q.eq('analysisId', analysisId).gt('rowIndex', after))
        .take(take)
      : []
    return { analysis: toMeta(doc), rows: docs.map(toRow) }
  },
})

export const claim = mutation({
  args: { authToken: v.string(), analysisId: v.string(), ownerToken: v.string(), leaseMs: v.number() },
  handler: async (ctx, { authToken, analysisId, ownerToken, leaseMs }): Promise<'claimed' | 'busy' | 'finished' | 'missing'> => {
    assertAuthorized(authToken)
    validateLease(leaseMs, ownerToken)
    const doc = await findAnalysis(ctx, analysisId)
    if (!doc) return 'missing'
    if (doc.status === 'complete' || doc.status === 'cancelled') return 'finished'
    const now = Date.now()
    const leased = doc.runOwnerToken !== undefined && (doc.runLeaseExpiresAt ?? 0) > now
    if (leased && doc.runOwnerToken !== ownerToken) return 'busy'
    await ctx.db.patch(doc._id, {
      status: 'running',
      error: undefined,
      startedAt: doc.startedAt ?? now,
      updatedAt: now,
      runOwnerToken: ownerToken,
      runLeaseExpiresAt: now + leaseMs,
    })
    return 'claimed'
  },
})

export const append = mutation({
  args: { authToken: v.string(), analysisId: v.string(), ownerToken: v.string(), rows: v.array(rowValidator), leaseMs: v.number() },
  handler: async (ctx, { authToken, analysisId, ownerToken, rows, leaseMs }): Promise<'ok' | 'lost' | 'cancelled'> => {
    assertAuthorized(authToken)
    validateLease(leaseMs, ownerToken)
    check(rows.length <= MAX_APPEND_ROWS, 'Too many rows in one append')
    const doc = await findAnalysis(ctx, analysisId)
    if (!doc) return 'lost'
    // Cancel clears the lease, so check it first or a cancelled run would always read as lost.
    if (doc.status === 'cancelled') return 'cancelled'
    if (doc.runOwnerToken === undefined || doc.runOwnerToken !== ownerToken) return 'lost'
    const seen = new Set<number>()
    let completed = 0
    let failed = 0
    for (const row of rows) {
      check(isCount(row.rowIndex, MAX_ROWS - 1), 'Invalid rowIndex')
      check(row.probabilities === undefined || row.probabilities.length <= MAX_CLASSES, 'Too many probabilities')
      if (seen.has(row.rowIndex)) continue
      seen.add(row.rowIndex)
      const existing = await ctx.db
        .query('analysisRows')
        .withIndex('by_analysis_row', (q) => q.eq('analysisId', analysisId).eq('rowIndex', row.rowIndex))
        .first()
      if (existing) continue
      await ctx.db.insert('analysisRows', compact({ analysisId, ...row }))
      completed += 1
      if (row.error) failed += 1
    }
    const now = Date.now()
    await ctx.db.patch(doc._id, {
      progress: {
        ...doc.progress,
        completedRows: doc.progress.completedRows + completed,
        failedRows: doc.progress.failedRows + failed,
      },
      updatedAt: now,
      runLeaseExpiresAt: now + leaseMs,
    })
    return 'ok'
  },
})

export const finish = mutation({
  args: {
    authToken: v.string(),
    analysisId: v.string(),
    ownerToken: v.string(),
    outcome: v.union(
      v.object({ status: v.literal('complete') }),
      v.object({ status: v.literal('error'), error: rowErrorValidator }),
      v.object({ status: v.literal('yield') }),
    ),
  },
  handler: async (ctx, { authToken, analysisId, ownerToken, outcome }): Promise<void> => {
    assertAuthorized(authToken)
    const doc = await findAnalysis(ctx, analysisId)
    if (!doc || doc.status === 'cancelled' || doc.runOwnerToken === undefined || doc.runOwnerToken !== ownerToken) return
    const now = Date.now()
    const release = { runOwnerToken: undefined, runLeaseExpiresAt: undefined, updatedAt: now }
    if (outcome.status === 'complete') await ctx.db.patch(doc._id, { ...release, status: 'complete', completedAt: now })
    else if (outcome.status === 'error') await ctx.db.patch(doc._id, { ...release, status: 'error', error: outcome.error })
    else await ctx.db.patch(doc._id, { ...release, status: 'running' })
  },
})

export const cancel = mutation({
  args: { authToken: v.string(), analysisId: v.string() },
  handler: async (ctx, { authToken, analysisId }): Promise<boolean> => {
    assertAuthorized(authToken)
    const doc = await findAnalysis(ctx, analysisId)
    if (!doc || doc.status === 'complete' || doc.status === 'cancelled') return false
    const now = Date.now()
    await ctx.db.patch(doc._id, {
      status: 'cancelled',
      completedAt: now,
      updatedAt: now,
      runOwnerToken: undefined,
      runLeaseExpiresAt: undefined,
    })
    return true
  },
})

export const listRecent = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const take = Math.min(MAX_LIST, Math.floor(limit))
    if (!(take > 0)) return []
    const docs = await ctx.db.query('analyses').withIndex('by_created_at').order('desc').take(take)
    return docs.map(toMeta)
  },
})
