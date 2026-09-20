import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'

const MAX_ROWS = 5_000
const MAX_CALLS = 5_000
const MAX_ID_LENGTH = 200
const MAX_QUERY_LENGTH = 20_000
const MAX_DOCUMENT_JSON = 200_000
const ROW_WRITE_BATCH = 40
const STALL_AFTER_MS = 60_000
const RUN_STALLED_CODE = 'ANALYSIS_RUN_STALLED'

const analysisArgs = {
  analysisId: v.string(),
  fixtureId: v.string(),
  datasetId: v.optional(v.string()),
  sourceType: v.optional(v.union(v.literal('fixture'), v.literal('upload'), v.literal('public_url'))),
  query: v.string(),
  status: v.union(v.literal('queued'), v.literal('running'), v.literal('complete'), v.literal('error')),
  createdAt: v.string(),
  updatedAt: v.string(),
  progress: v.object({
    completedRows: v.number(),
    totalRows: v.number(),
    completedCalls: v.number(),
    totalCalls: v.number(),
  }),
  questionKind: v.optional(v.union(v.literal('noul'), v.literal('score'), v.literal('choice'))),
  classes: v.optional(v.array(v.string())),
  columns: v.optional(v.array(v.string())),
  currentFixtureRow: v.optional(v.any()),
  error: v.optional(v.object({ code: v.string(), retryable: v.boolean() })),
  resultRows: v.array(v.any()),
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

type DurableSnapshot = {
  analysisId: string
  fixtureId: string
  datasetId?: string
  sourceType?: 'fixture' | 'upload' | 'public_url'
  query: string
  status: 'queued' | 'running' | 'complete' | 'error'
  createdAt: string
  updatedAt: string
  progress: { completedRows: number; totalRows: number; completedCalls: number; totalCalls: number }
  questionKind?: 'noul' | 'score' | 'choice'
  classes?: string[]
  columns?: string[]
  currentFixtureRow?: unknown
  error?: { code: string; retryable: boolean }
  resultRows: unknown[]
  contentKey?: string
}

const authorizeWrite = (authToken: string): void => {
  const expected = process.env.CONVEX_WRITE_SECRET?.trim()
  if (!expected || authToken !== expected) throw new Error('Unauthorized analysis mutation')
}

const validateSnapshot: (snapshot: unknown) => asserts snapshot is DurableSnapshot = (snapshot) => {
  if (!isRecord(snapshot) || typeof snapshot.analysisId !== 'string' || snapshot.analysisId.length < 1 || snapshot.analysisId.length > MAX_ID_LENGTH) throw new Error('Invalid analysis snapshot')
  if (typeof snapshot.fixtureId !== 'string' || snapshot.fixtureId.length < 1 || snapshot.fixtureId.length > MAX_ID_LENGTH) throw new Error('Invalid analysis fixture')
  if (typeof snapshot.query !== 'string' || snapshot.query.length < 1 || snapshot.query.length > MAX_QUERY_LENGTH || snapshot.query.includes('\u0000')) throw new Error('Invalid analysis query')
  if (!['queued', 'running', 'complete', 'error'].includes(snapshot.status as string)) throw new Error('Invalid analysis status')
  if (typeof snapshot.createdAt !== 'string' || Number.isNaN(Date.parse(snapshot.createdAt)) || typeof snapshot.updatedAt !== 'string' || Number.isNaN(Date.parse(snapshot.updatedAt))) throw new Error('Invalid analysis timestamp')
  if (!isRecord(snapshot.progress)) throw new Error('Invalid analysis progress')
  const progress = snapshot.progress as { [key: string]: unknown }
  const progressNames = ['completedRows', 'totalRows', 'completedCalls', 'totalCalls'] as const
  for (const name of progressNames) {
    const value = progress[name]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_ROWS) throw new Error('Analysis progress exceeds bounds')
  }
  const completedRows = progress.completedRows as number
  const totalRows = progress.totalRows as number
  const completedCalls = progress.completedCalls as number
  const totalCalls = progress.totalCalls as number
  if (totalRows > MAX_ROWS || totalCalls > MAX_CALLS || completedRows > totalRows || completedCalls > totalCalls) throw new Error('Analysis progress is inconsistent')
  if (!Array.isArray(snapshot.resultRows) || snapshot.resultRows.length > MAX_ROWS) throw new Error('Analysis result rows exceed bounds')
  const indexes = new Set<number>()
  for (const row of snapshot.resultRows) {
    if (!isRecord(row) || typeof row.rowIndex !== 'number' || !Number.isInteger(row.rowIndex) || row.rowIndex < 0 || row.rowIndex >= MAX_ROWS || indexes.has(row.rowIndex)) throw new Error('Invalid analysis result row')
    if (typeof row.model !== 'string' || row.model.length < 1 || row.model.length > 256 || !isRecord(row.input)) throw new Error('Invalid analysis result row')
    indexes.add(row.rowIndex)
  }
  if (snapshot.currentFixtureRow !== undefined && !isRecord(snapshot.currentFixtureRow)) throw new Error('Invalid current analysis row')
  if (snapshot.error !== undefined && (!isRecord(snapshot.error) || typeof snapshot.error.code !== 'string' || !/^[A-Z0-9_]+$/.test(snapshot.error.code) || typeof snapshot.error.retryable !== 'boolean')) throw new Error('Invalid analysis error')
  if (snapshot.contentKey !== undefined && (typeof snapshot.contentKey !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.contentKey))) throw new Error('Invalid analysis content key')
  const { resultRows: _ignoredRows, ...documentFields } = snapshot
  if (JSON.stringify(documentFields).length > MAX_DOCUMENT_JSON) throw new Error('Analysis snapshot is too large')
}

const snapshotDocument = (snapshot: {
  analysisId: string
  fixtureId: string
  datasetId?: string
  sourceType?: 'fixture' | 'upload' | 'public_url'
  query: string
  status: 'queued' | 'running' | 'complete' | 'error'
  createdAt: string
  updatedAt: string
  progress: { completedRows: number; totalRows: number; completedCalls: number; totalCalls: number }
  questionKind?: 'noul' | 'score' | 'choice'
  classes?: string[]
  columns?: string[]
  currentFixtureRow?: unknown
  error?: { code: string; retryable: boolean }
  contentKey?: string
}) => ({
  analysisId: snapshot.analysisId,
  fixtureId: snapshot.fixtureId,
  ...(snapshot.datasetId === undefined ? {} : { datasetId: snapshot.datasetId }),
  ...(snapshot.sourceType === undefined ? {} : { sourceType: snapshot.sourceType }),
  query: snapshot.query,
  status: snapshot.status,
  createdAt: snapshot.createdAt,
  updatedAt: snapshot.updatedAt,
  progress: snapshot.progress,
  ...(snapshot.questionKind === undefined ? {} : { questionKind: snapshot.questionKind }),
  ...(snapshot.classes === undefined ? {} : { classes: snapshot.classes }),
  ...(snapshot.columns === undefined ? {} : { columns: snapshot.columns }),
  ...(snapshot.currentFixtureRow === undefined ? {} : { currentFixtureRow: snapshot.currentFixtureRow }),
  ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
  ...(snapshot.contentKey === undefined ? {} : { contentKey: snapshot.contentKey }),
})

const publicSnapshot = (document: Record<string, unknown>, rows: unknown[]) => ({
  analysisId: document.analysisId,
  fixtureId: document.fixtureId,
  datasetId: document.datasetId ?? document.fixtureId,
  sourceType: document.sourceType ?? 'fixture',
  query: document.query,
  status: document.status,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
  progress: document.progress,
  questionKind: document.questionKind,
  classes: document.classes ?? [],
  columns: document.columns ?? [],
  ...(document.currentFixtureRow === undefined ? {} : { currentFixtureRow: document.currentFixtureRow }),
  ...(document.error === undefined ? {} : { error: document.error }),
  resultRows: rows,
})

const findDocument = async (ctx: { db: any }, analysisId: string) => await ctx.db.query('analyses').withIndex('by_analysis_id', (q: any) => q.eq('analysisId', analysisId)).unique()

const readSnapshot = async (ctx: { db: any }, analysisId: string) => {
  const document = await findDocument(ctx, analysisId)
  if (!document) return null
  const rows = await ctx.db.query('analysisRows').withIndex('by_analysis_row', (q: any) => q.eq('analysisId', analysisId)).order('asc').take(MAX_ROWS)
  return publicSnapshot(document, rows.map((row: Record<string, unknown>) => {
    const { _id: _ignoredId, _creationTime: _ignoredCreationTime, analysisId: _ignoredAnalysisId, ...safe } = row
    return safe
  }))
}

export const getAnalysisInternal = internalQuery({
  args: { analysisId: v.string() },
  handler: async (ctx, { analysisId }) => await readSnapshot(ctx, analysisId),
})

export const getAnalysisShareSnapshot = query({
  args: { analysisId: v.string() },
  handler: async (ctx, { analysisId }) => await readSnapshot(ctx, analysisId),
})

export const getCompleteAnalysisByContentKeyInternal = internalQuery({
  args: { contentKey: v.string() },
  handler: async (ctx, { contentKey }) => {
    if (!/^[a-f0-9]{64}$/.test(contentKey)) return null
    const documents = await ctx.db.query('analyses').withIndex('by_content_key_status', (q: any) => q.eq('contentKey', contentKey).eq('status', 'complete')).order('desc').take(1)
    const document = documents[0]
    if (!document) return null
    return await readSnapshot(ctx, document.analysisId)
  },
})

const reusableStatusRank = (status: string): number => {
  if (status === 'complete') return 0
  if (status === 'running') return 1
  if (status === 'queued') return 2
  return 99
}

const findReusableDocument = async (ctx: { db: any }, contentKey: string) => {
  if (!/^[a-f0-9]{64}$/.test(contentKey)) return null
  const documents = await ctx.db.query('analyses').withIndex('by_content_key_status', (q: any) => q.eq('contentKey', contentKey)).take(32)
  const reusable = documents.filter((document: { status: string }) => document.status === 'complete' || document.status === 'running' || document.status === 'queued')
  reusable.sort((left: { status: string; updatedAt: string }, right: { status: string; updatedAt: string }) => {
    const rank = reusableStatusRank(left.status) - reusableStatusRank(right.status)
    if (rank !== 0) return rank
    return left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0
  })
  return reusable[0] ?? null
}

const writeSnapshotDocument = async (ctx: { db: any }, snapshot: DurableSnapshot) => {
  const existing = await findDocument(ctx, snapshot.analysisId)
  const currentClaims = existing ? {
    ...(existing.runOwnerToken === undefined ? {} : { runOwnerToken: existing.runOwnerToken }),
    ...(existing.runLeaseExpiresAt === undefined ? {} : { runLeaseExpiresAt: existing.runLeaseExpiresAt }),
  } : {}
  const contentKey = typeof snapshot.contentKey === 'string' ? snapshot.contentKey : existing?.contentKey
  const document = {
    ...snapshotDocument({
      ...snapshot,
      ...(typeof contentKey === 'string' ? { contentKey } : {}),
    }),
    ...currentClaims,
  }
  if (existing) await ctx.db.replace(existing._id, document)
  else await ctx.db.insert('analyses', document)
  return document
}

const upsertAnalysisRows = async (ctx: { db: any }, analysisId: string, rows: unknown[]) => {
  for (const row of rows) {
    const durableRow = row as { rowIndex: number; input: unknown; model: string; selectedClass?: string; probabilities?: unknown; confidence?: number; value?: number; questionKind?: 'noul' | 'score' | 'choice'; error?: { code: string; retryable: boolean } }
    const existingRows = await ctx.db.query('analysisRows').withIndex('by_analysis_row', (q: any) => q.eq('analysisId', analysisId).eq('rowIndex', durableRow.rowIndex)).take(1)
    const existing = existingRows[0]
    const stored = { analysisId, ...durableRow }
    if (existing) await ctx.db.replace(existing._id, stored)
    else await ctx.db.insert('analysisRows', stored)
  }
}

const consecutiveCompletedRows = (rows: Array<{ rowIndex?: unknown }>): number => {
  const done = new Set(rows.map((row) => row.rowIndex).filter((index): index is number => typeof index === 'number' && Number.isInteger(index)))
  let count = 0
  while (done.has(count)) count += 1
  return count
}

const shouldHealStalledDocument = (document: { status: string; updatedAt: string; runLeaseExpiresAt?: number }, nowMs: number): boolean => {
  if (document.status !== 'queued' && document.status !== 'running') return false
  const updatedAtMs = Date.parse(document.updatedAt)
  if (!Number.isFinite(updatedAtMs) || nowMs - updatedAtMs < STALL_AFTER_MS) return false
  if (document.runLeaseExpiresAt !== undefined && document.runLeaseExpiresAt > nowMs) return false
  return true
}

const writeSnapshot = async (ctx: { db: any }, snapshot: DurableSnapshot) => {
  const document = await writeSnapshotDocument(ctx, snapshot)
  await upsertAnalysisRows(ctx, snapshot.analysisId, snapshot.resultRows)
  return publicSnapshot(document, snapshot.resultRows)
}

export const putAnalysisSnapshotInternal = internalMutation({
  args: { snapshot: v.any() },
  handler: async (ctx, { snapshot }) => {
    validateSnapshot(snapshot)
    return await writeSnapshot(ctx, snapshot)
  },
})

export const putAnalysisMetaInternal = internalMutation({
  args: { snapshot: v.any() },
  handler: async (ctx, { snapshot }) => {
    validateSnapshot(snapshot)
    await writeSnapshotDocument(ctx, snapshot)
    return null
  },
})

export const upsertAnalysisRowsInternal = internalMutation({
  args: { analysisId: v.string(), rows: v.array(v.any()) },
  handler: async (ctx, { analysisId, rows }) => {
    if (typeof analysisId !== 'string' || analysisId.length < 1 || analysisId.length > MAX_ID_LENGTH) throw new Error('Invalid analysis snapshot')
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new Error('Analysis result rows exceed bounds')
    const indexes = new Set<number>()
    for (const row of rows) {
      if (!isRecord(row) || typeof row.rowIndex !== 'number' || !Number.isInteger(row.rowIndex) || row.rowIndex < 0 || row.rowIndex >= MAX_ROWS || indexes.has(row.rowIndex)) throw new Error('Invalid analysis result row')
      if (typeof row.model !== 'string' || row.model.length < 1 || row.model.length > 256 || !isRecord(row.input)) throw new Error('Invalid analysis result row')
      indexes.add(row.rowIndex)
    }
    await upsertAnalysisRows(ctx, analysisId, rows)
    return null
  },
})

export const claimAnalysisByContentKeyInternal = internalMutation({
  args: { snapshot: v.any() },
  handler: async (ctx, { snapshot }) => {
    validateSnapshot(snapshot)
    const contentKey = typeof snapshot.contentKey === 'string' ? snapshot.contentKey : undefined
    if (contentKey) {
      const reusable = await findReusableDocument(ctx, contentKey)
      if (reusable) return await readSnapshot(ctx, reusable.analysisId)
    }
    return await writeSnapshot(ctx, snapshot)
  },
})

export const claimAnalysisInternal = internalMutation({
  args: { analysisId: v.string(), ownerToken: v.string(), nowMs: v.number(), leaseMs: v.number() },
  handler: async (ctx, args) => {
    if (!args.analysisId.trim() || !args.ownerToken.trim() || !Number.isFinite(args.nowMs) || !Number.isFinite(args.leaseMs) || args.leaseMs < 1_000 || args.leaseMs > 86_400_000) throw new Error('Invalid analysis claim')
    const document = await findDocument(ctx, args.analysisId)
    if (!document) return 'missing' as const
    if (document.status === 'complete') return 'complete' as const
    if (document.status === 'error') return 'error' as const
    if (document.runOwnerToken && document.runOwnerToken !== args.ownerToken && (document.runLeaseExpiresAt ?? 0) > args.nowMs) return 'busy' as const
    await ctx.db.patch(document._id, { status: 'running', updatedAt: new Date(args.nowMs).toISOString(), runOwnerToken: args.ownerToken, runLeaseExpiresAt: args.nowMs + args.leaseMs })
    return 'claimed' as const
  },
})

export const releaseAnalysisInternal = internalMutation({
  args: { analysisId: v.string(), ownerToken: v.string() },
  handler: async (ctx, { analysisId, ownerToken }) => {
    const document = await findDocument(ctx, analysisId)
    if (document?.runOwnerToken === ownerToken) await ctx.db.patch(document._id, { runOwnerToken: undefined, runLeaseExpiresAt: undefined })
    return null
  },
})

export const healStaleAnalysisInternal = internalMutation({
  args: { analysisId: v.string(), nowMs: v.number() },
  handler: async (ctx, { analysisId, nowMs }) => {
    if (!analysisId.trim() || !Number.isFinite(nowMs)) throw new Error('Invalid analysis heal')
    const document = await findDocument(ctx, analysisId)
    if (!document) return null
    if (!shouldHealStalledDocument(document, nowMs)) return await readSnapshot(ctx, analysisId)
    const rows = await ctx.db.query('analysisRows').withIndex('by_analysis_row', (q: any) => q.eq('analysisId', analysisId)).order('asc').take(MAX_ROWS)
    const completedPrefix = consecutiveCompletedRows(rows)
    await ctx.db.patch(document._id, {
      status: 'error',
      updatedAt: new Date(nowMs).toISOString(),
      error: { code: RUN_STALLED_CODE, retryable: true },
      progress: {
        completedRows: completedPrefix,
        totalRows: document.progress.totalRows,
        completedCalls: rows.length,
        totalCalls: document.progress.totalCalls,
      },
      runOwnerToken: undefined,
      runLeaseExpiresAt: undefined,
    })
    return await readSnapshot(ctx, analysisId)
  },
})

export const authorizedGetAnalysis = action({
  args: { authToken: v.string(), analysisId: v.string() },
  handler: async (ctx: any, { authToken, analysisId }: { authToken: string; analysisId: string }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runQuery(internal.analyses.getAnalysisInternal, { analysisId })
  },
})

export const authorizedHealStaleAnalysis = action({
  args: { authToken: v.string(), analysisId: v.string(), nowMs: v.number() },
  handler: async (ctx: any, { authToken, analysisId, nowMs }: { authToken: string; analysisId: string; nowMs: number }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runMutation(internal.analyses.healStaleAnalysisInternal, { analysisId, nowMs })
  },
})

export const authorizedGetCompleteAnalysisByContentKey = action({
  args: { authToken: v.string(), contentKey: v.string() },
  handler: async (ctx: any, { authToken, contentKey }: { authToken: string; contentKey: string }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runQuery(internal.analyses.getCompleteAnalysisByContentKeyInternal, { contentKey })
  },
})

export const authorizedClaimAnalysisByContentKey = action({
  args: { authToken: v.string(), contentKey: v.string(), snapshot: v.any() },
  handler: async (ctx: any, { authToken, contentKey, snapshot }: { authToken: string; contentKey: string; snapshot: unknown }): Promise<unknown> => {
    authorizeWrite(authToken)
    if (typeof contentKey !== 'string' || !/^[a-f0-9]{64}$/.test(contentKey)) throw new Error('Invalid analysis content key')
    validateSnapshot(snapshot)
    return await ctx.runMutation(internal.analyses.claimAnalysisByContentKeyInternal, {
      snapshot: { ...(snapshot as object), contentKey },
    })
  },
})

export const authorizedPutAnalysisSnapshot = action({
  args: { authToken: v.string(), snapshot: v.any() },
  handler: async (ctx: any, { authToken, snapshot }: { authToken: string; snapshot: unknown }): Promise<unknown> => {
    authorizeWrite(authToken)
    validateSnapshot(snapshot)
    const durable = snapshot as DurableSnapshot
    await ctx.runMutation(internal.analyses.putAnalysisMetaInternal, { snapshot: { ...durable, resultRows: [] } })
    const rows = Array.isArray(durable.resultRows) ? durable.resultRows : []
    for (let offset = 0; offset < rows.length; offset += ROW_WRITE_BATCH) {
      await ctx.runMutation(internal.analyses.upsertAnalysisRowsInternal, {
        analysisId: durable.analysisId,
        rows: rows.slice(offset, offset + ROW_WRITE_BATCH),
      })
    }
    return await ctx.runQuery(internal.analyses.getAnalysisInternal, { analysisId: durable.analysisId })
  },
})

export const authorizedClaimAnalysis = action({
  args: { authToken: v.string(), analysisId: v.string(), ownerToken: v.string(), nowMs: v.number(), leaseMs: v.number() },
  handler: async (ctx: any, { authToken, ...args }: { authToken: string; analysisId: string; ownerToken: string; nowMs: number; leaseMs: number }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runMutation(internal.analyses.claimAnalysisInternal, args)
  },
})

export const authorizedReleaseAnalysis = action({
  args: { authToken: v.string(), analysisId: v.string(), ownerToken: v.string() },
  handler: async (ctx: any, { authToken, ...args }: { authToken: string; analysisId: string; ownerToken: string }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runMutation(internal.analyses.releaseAnalysisInternal, args)
  },
})

type DurableDraft = {
  contentKey: string
  fixtureId: string
  datasetId: string
  sourceType: 'fixture' | 'upload' | 'public_url'
  query: string
  metadata: {
    provider: string
    model: string
    rowCount: number
    classes: string[]
    columns: string[]
    displayName: string
    questionKind?: 'noul' | 'score' | 'choice'
    inputHalf?: 'H1'
    labelHalf?: 'H2'
    cacheWrite?: 'ok' | 'skipped'
  }
  createdAt: string
  updatedAt: string
}

const publicDraft = (document: DurableDraft) => ({
  fixtureId: document.fixtureId,
  datasetId: document.datasetId,
  sourceType: document.sourceType,
  query: document.query,
  metadata: document.metadata,
})

const validateDraft: (value: unknown) => asserts value is DurableDraft = (value) => {
  if (!isRecord(value) || typeof value.contentKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentKey)) throw new Error('Invalid draft content key')
  if (typeof value.fixtureId !== 'string' || value.fixtureId.length < 1 || value.fixtureId.length > MAX_ID_LENGTH) throw new Error('Invalid draft fixture')
  if (typeof value.datasetId !== 'string' || value.datasetId.length < 1 || value.datasetId.length > MAX_ID_LENGTH) throw new Error('Invalid draft dataset')
  if (value.sourceType !== 'fixture' && value.sourceType !== 'upload' && value.sourceType !== 'public_url') throw new Error('Invalid draft source')
  if (typeof value.query !== 'string' || value.query.length < 1 || value.query.length > MAX_QUERY_LENGTH || value.query.includes('\u0000')) throw new Error('Invalid draft query')
  if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)) || typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))) throw new Error('Invalid draft timestamp')
  if (!isRecord(value.metadata)) throw new Error('Invalid draft metadata')
  const metadata = value.metadata
  if (typeof metadata.provider !== 'string' || !metadata.provider.trim() || metadata.provider.length > 64) throw new Error('Invalid draft provider')
  if (typeof metadata.model !== 'string' || !metadata.model.trim() || metadata.model.length > 200) throw new Error('Invalid draft model')
  if (typeof metadata.rowCount !== 'number' || !Number.isInteger(metadata.rowCount) || metadata.rowCount < 1 || metadata.rowCount > MAX_ROWS) throw new Error('Invalid draft row count')
  if (typeof metadata.displayName !== 'string' || !metadata.displayName.trim() || metadata.displayName.length > 200) throw new Error('Invalid draft display name')
  if (!Array.isArray(metadata.classes) || metadata.classes.length > 32 || metadata.classes.some((item) => typeof item !== 'string' || !item.trim() || item.length > 80)) throw new Error('Invalid draft classes')
  if (!Array.isArray(metadata.columns) || metadata.columns.length < 1 || metadata.columns.length > 100 || metadata.columns.some((item) => typeof item !== 'string' || !item.trim() || item.length > 80)) throw new Error('Invalid draft columns')
  if (metadata.questionKind !== undefined && metadata.questionKind !== 'noul' && metadata.questionKind !== 'score' && metadata.questionKind !== 'choice') throw new Error('Invalid draft question kind')
  if (metadata.inputHalf !== undefined && metadata.inputHalf !== 'H1') throw new Error('Invalid draft input half')
  if (metadata.labelHalf !== undefined && metadata.labelHalf !== 'H2') throw new Error('Invalid draft label half')
  if (metadata.cacheWrite !== undefined && metadata.cacheWrite !== 'ok' && metadata.cacheWrite !== 'skipped') throw new Error('Invalid draft cache write')
  if (JSON.stringify(value).length > 200_000) throw new Error('Draft snapshot is too large')
}

const findDraftDocument = async (ctx: { db: any }, contentKey: string) => {
  const documents = await ctx.db.query('analysisDrafts').withIndex('by_content_key', (q: any) => q.eq('contentKey', contentKey)).take(1)
  return documents[0] ?? null
}

export const getDraftByContentKeyInternal = internalQuery({
  args: { contentKey: v.string() },
  handler: async (ctx, { contentKey }) => {
    if (!/^[a-f0-9]{64}$/.test(contentKey)) return null
    const document = await findDraftDocument(ctx, contentKey)
    if (!document) return null
    return publicDraft(document as DurableDraft)
  },
})

export const putDraftInternal = internalMutation({
  args: { draft: v.any() },
  handler: async (ctx, { draft }) => {
    validateDraft(draft)
    const document = {
      contentKey: draft.contentKey,
      fixtureId: draft.fixtureId,
      datasetId: draft.datasetId,
      sourceType: draft.sourceType,
      query: draft.query,
      metadata: draft.metadata,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    }
    const existing = await findDraftDocument(ctx, draft.contentKey)
    if (existing) {
      await ctx.db.replace(existing._id, { ...document, createdAt: existing.createdAt })
    } else {
      await ctx.db.insert('analysisDrafts', document)
    }
    return publicDraft(document)
  },
})

export const authorizedGetDraftByContentKey = action({
  args: { authToken: v.string(), contentKey: v.string() },
  handler: async (ctx: any, { authToken, contentKey }: { authToken: string; contentKey: string }): Promise<unknown> => {
    authorizeWrite(authToken)
    return await ctx.runQuery(internal.analyses.getDraftByContentKeyInternal, { contentKey })
  },
})

export const authorizedPutDraft = action({
  args: { authToken: v.string(), contentKey: v.string(), draft: v.any() },
  handler: async (ctx: any, { authToken, contentKey, draft }: { authToken: string; contentKey: string; draft: unknown }): Promise<unknown> => {
    authorizeWrite(authToken)
    if (typeof contentKey !== 'string' || !/^[a-f0-9]{64}$/.test(contentKey)) throw new Error('Invalid draft content key')
    if (!isRecord(draft)) throw new Error('Invalid draft snapshot')
    const now = new Date().toISOString()
    const metadata = isRecord(draft.metadata) ? { ...draft.metadata } : draft.metadata
    if (isRecord(metadata)) delete metadata.cacheWrite
    const snapshot = {
      contentKey,
      fixtureId: draft.fixtureId,
      datasetId: draft.datasetId,
      sourceType: draft.sourceType,
      query: draft.query,
      metadata,
      createdAt: typeof draft.createdAt === 'string' ? draft.createdAt : now,
      updatedAt: now,
    }
    validateDraft(snapshot)
    return await ctx.runMutation(internal.analyses.putDraftInternal, { draft: snapshot })
  },
})

export const listPublicAnalyses = query({
  args: {},
  handler: async (ctx) => {
    const documents = await ctx.db.query('analyses').take(48)
    return documents.map((document) => ({
      analysisId: document.analysisId,
      datasetId: document.datasetId ?? document.fixtureId,
      title: document.query.slice(0, 80),
      status: document.status,
      completedRows: document.progress.completedRows,
      totalRows: document.progress.totalRows,
      createdAt: document.createdAt,
    }))
  },
})
