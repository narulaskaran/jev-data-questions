import { beforeEach, describe, expect, it } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api'
import schema from './schema'

const modules = (import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob('./**/*.ts')
const writeSecret = ['analysis', 'convex', 'test', 'auth'].join('-')
const baseSnapshot = {
  analysisId: 'analysis-convex-1',
  fixtureId: 'football-fixture-2026',
  query: 'Classify H1 rows.',
  status: 'queued' as const,
  createdAt: '2026-09-17T18:00:00.000Z',
  updatedAt: '2026-09-17T18:00:00.000Z',
  progress: { completedRows: 0, totalRows: 2, completedCalls: 0, totalCalls: 2 },
  resultRows: [],
}
const resultRow = (rowIndex: number) => ({
  rowIndex,
  input: { playId: `play-${rowIndex}`, source: 'H1' },
  model: 'jev-test',
  selectedClass: 'K.Walker',
  probabilities: { 'K.Walker': 0.7, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 },
  confidence: 0.7,
})

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = writeSecret
})

describe('durable Convex analysis functions', () => {
  it('requires authenticated writes, supports incremental readback, public share snapshots, and idempotent updates', async () => {
    const t = convexTest(schema, modules)
    await expect(t.action(api.analyses.authorizedPutAnalysisSnapshot, { authToken: 'wrong', snapshot: baseSnapshot })).rejects.toThrow(/unauthorized/i)

    await expect(t.action(api.analyses.authorizedPutAnalysisSnapshot, { authToken: writeSecret, snapshot: baseSnapshot })).resolves.toMatchObject({ analysisId: baseSnapshot.analysisId, resultRows: [] })
    const partial = { ...baseSnapshot, status: 'running' as const, updatedAt: '2026-09-17T18:01:00.000Z', progress: { completedRows: 1, totalRows: 2, completedCalls: 1, totalCalls: 2 }, currentFixtureRow: { rowIndex: 1, input: { playId: 'play-1', source: 'H1' } }, resultRows: [resultRow(0)] }
    await t.action(api.analyses.authorizedPutAnalysisSnapshot, { authToken: writeSecret, snapshot: partial })

    await expect(t.action(api.analyses.authorizedGetAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId })).resolves.toMatchObject({ status: 'running', progress: partial.progress, resultRows: [expect.objectContaining({ rowIndex: 0 })] })
    await expect(t.query(api.analyses.getAnalysisShareSnapshot, { analysisId: baseSnapshot.analysisId })).resolves.toMatchObject({ analysisId: baseSnapshot.analysisId, resultRows: [expect.objectContaining({ rowIndex: 0 })] })
    await expect(t.query(api.analyses.getAnalysisShareSnapshot, { analysisId: 'missing' })).resolves.toBeNull()
  })

  it('claims one execution, rejects a live duplicate, and permits stale recovery', async () => {
    const t = convexTest(schema, modules)
    await t.action(api.analyses.authorizedPutAnalysisSnapshot, { authToken: writeSecret, snapshot: baseSnapshot })
    await expect(t.action(api.analyses.authorizedClaimAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId, ownerToken: 'owner-a', nowMs: 1_000, leaseMs: 300_000 })).resolves.toBe('claimed')
    await expect(t.action(api.analyses.authorizedClaimAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId, ownerToken: 'owner-b', nowMs: 2_000, leaseMs: 300_000 })).resolves.toBe('busy')
    await expect(t.action(api.analyses.authorizedClaimAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId, ownerToken: 'owner-b', nowMs: 301_001, leaseMs: 300_000 })).resolves.toBe('claimed')
    await expect(t.action(api.analyses.authorizedReleaseAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId, ownerToken: 'owner-b' })).resolves.toBeNull()
  })

  it('upserts incremental rows without dropping earlier completions and heals a dead lease', async () => {
    const t = convexTest(schema, modules)
    await t.action(api.analyses.authorizedPutAnalysisSnapshot, { authToken: writeSecret, snapshot: baseSnapshot })
    await t.action(api.analyses.authorizedPutAnalysisSnapshot, {
      authToken: writeSecret,
      snapshot: { ...baseSnapshot, status: 'running', progress: { completedRows: 1, totalRows: 2, completedCalls: 1, totalCalls: 2 }, resultRows: [resultRow(0)] },
    })
    await t.action(api.analyses.authorizedPutAnalysisSnapshot, {
      authToken: writeSecret,
      snapshot: { ...baseSnapshot, status: 'running', progress: { completedRows: 2, totalRows: 2, completedCalls: 2, totalCalls: 2 }, resultRows: [resultRow(1)] },
    })
    await expect(t.action(api.analyses.authorizedGetAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId })).resolves.toMatchObject({
      status: 'running',
      resultRows: [expect.objectContaining({ rowIndex: 0 }), expect.objectContaining({ rowIndex: 1 })],
    })

    await t.action(api.analyses.authorizedClaimAnalysis, { authToken: writeSecret, analysisId: baseSnapshot.analysisId, ownerToken: 'owner-a', nowMs: 1_000, leaseMs: 300_000 })
    await expect(t.action(api.analyses.authorizedHealStaleAnalysis, {
      authToken: writeSecret,
      analysisId: baseSnapshot.analysisId,
      nowMs: 61_000,
    })).resolves.toMatchObject({ status: 'running' })
    await expect(t.action(api.analyses.authorizedHealStaleAnalysis, {
      authToken: writeSecret,
      analysisId: baseSnapshot.analysisId,
      nowMs: 301_001,
    })).resolves.toMatchObject({
      status: 'error',
      error: { code: 'ANALYSIS_RUN_STALLED', retryable: true },
      progress: { completedRows: 2 },
      resultRows: [expect.objectContaining({ rowIndex: 0 }), expect.objectContaining({ rowIndex: 1 })],
    })
    await expect(t.action(api.analyses.authorizedClaimAnalysis, {
      authToken: writeSecret,
      analysisId: baseSnapshot.analysisId,
      ownerToken: 'owner-b',
      nowMs: 302_000,
      leaseMs: 300_000,
    })).resolves.toBe('error')
  })

  it('looks up a complete snapshot by content key and ignores incomplete runs', async () => {
    const t = convexTest(schema, modules)
    const contentKey = 'a'.repeat(64)
    await t.action(api.analyses.authorizedPutAnalysisSnapshot, {
      authToken: writeSecret,
      snapshot: { ...baseSnapshot, analysisId: 'queued-same-content', contentKey, status: 'queued' },
    })
    await expect(t.action(api.analyses.authorizedGetCompleteAnalysisByContentKey, { authToken: writeSecret, contentKey })).resolves.toBeNull()

    const complete = {
      ...baseSnapshot,
      analysisId: 'complete-same-content',
      contentKey,
      status: 'complete' as const,
      progress: { completedRows: 2, totalRows: 2, completedCalls: 2, totalCalls: 2 },
      resultRows: [resultRow(0), resultRow(1)],
    }
    await t.action(api.analyses.authorizedPutAnalysisSnapshot, { authToken: writeSecret, snapshot: complete })
    await expect(t.action(api.analyses.authorizedGetCompleteAnalysisByContentKey, { authToken: writeSecret, contentKey })).resolves.toMatchObject({
      analysisId: 'complete-same-content',
      status: 'complete',
      resultRows: [expect.objectContaining({ rowIndex: 0 }), expect.objectContaining({ rowIndex: 1 })],
    })
    await expect(t.query(api.analyses.getAnalysisShareSnapshot, { analysisId: 'complete-same-content' })).resolves.toMatchObject({
      analysisId: 'complete-same-content',
      status: 'complete',
    })
    await expect(t.action(api.analyses.authorizedGetCompleteAnalysisByContentKey, { authToken: 'wrong', contentKey })).rejects.toThrow(/unauthorized/i)
  })

  it('claims the first analysis for a content key and joins later queued inserts', async () => {
    const t = convexTest(schema, modules)
    const contentKey = 'b'.repeat(64)
    const queued = {
      ...baseSnapshot,
      analysisId: 'first-queued',
      contentKey,
      status: 'queued' as const,
    }
    await expect(t.action(api.analyses.authorizedClaimAnalysisByContentKey, { authToken: writeSecret, contentKey, snapshot: queued })).resolves.toMatchObject({
      analysisId: 'first-queued',
      status: 'queued',
    })
    await expect(t.action(api.analyses.authorizedClaimAnalysisByContentKey, {
      authToken: writeSecret,
      contentKey,
      snapshot: { ...queued, analysisId: 'second-queued' },
    })).resolves.toMatchObject({
      analysisId: 'first-queued',
      status: 'queued',
    })
    await expect(t.action(api.analyses.authorizedGetAnalysis, { authToken: writeSecret, analysisId: 'second-queued' })).resolves.toBeNull()
  })

  it('persists successful drafts by content key and requires write auth', async () => {
    const t = convexTest(schema, modules)
    const contentKey = 'c'.repeat(64)
    const draft = {
      fixtureId: 'football-fixture-2026',
      datasetId: 'football-fixture-2026',
      sourceType: 'fixture' as const,
      query: '{"type":"noul","instructions":"Will SEA win given this play state?"}',
      metadata: {
        provider: 'openrouter',
        model: 'openrouter/test',
        rowCount: 71,
        classes: [],
        columns: ['play_id', 'qtr'],
        displayName: '2026 Super Bowl Demo',
        questionKind: 'noul' as const,
      },
    }
    await expect(t.action(api.analyses.authorizedPutDraft, { authToken: 'wrong', contentKey, draft })).rejects.toThrow(/unauthorized/i)
    await expect(t.action(api.analyses.authorizedGetDraftByContentKey, { authToken: writeSecret, contentKey })).resolves.toBeNull()
    await expect(t.action(api.analyses.authorizedPutDraft, { authToken: writeSecret, contentKey, draft })).resolves.toMatchObject({
      datasetId: draft.datasetId,
      query: draft.query,
      metadata: expect.objectContaining({ model: 'openrouter/test', questionKind: 'noul' }),
    })
    await expect(t.action(api.analyses.authorizedGetDraftByContentKey, { authToken: writeSecret, contentKey })).resolves.toMatchObject({
      datasetId: draft.datasetId,
      query: draft.query,
    })
    await expect(t.action(api.analyses.authorizedPutDraft, {
      authToken: writeSecret,
      contentKey,
      draft: { ...draft, query: '{"type":"noul","instructions":"updated"}' },
    })).resolves.toMatchObject({ query: '{"type":"noul","instructions":"updated"}' })
    await expect(t.action(api.analyses.authorizedGetDraftByContentKey, { authToken: 'wrong', contentKey })).rejects.toThrow(/unauthorized/i)
  })
})
