import type {
  AnalysisAppendResult,
  AnalysisClaimResult,
  AnalysisMeta,
  AnalysisRecord,
  AnalysisResultRow,
  AnalysisRowError,
  AnalysisStorage,
  LimitsStorage,
} from '../shared/analysis.js'
import { toAnalysisMeta } from '../shared/analysis.js'
import type { DatasetRecord, DatasetRowValues, DatasetStorage } from '../shared/dataset.js'

const MAX_LIST = 50
const MAX_READ_ROWS = 500

// JSON round trip: copies deeply and drops `undefined` fields, like a real database would.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

interface StoredAnalysis {
  record: AnalysisRecord
  rows: Map<number, AnalysisResultRow>
  ownerToken?: string
  leaseExpiresAt?: number
  seq: number
}

export class InMemoryAnalysisStore implements AnalysisStorage {
  private readonly analyses = new Map<string, StoredAnalysis>()
  private seq = 0

  constructor(private readonly now: () => number = Date.now) {}

  async create(record: AnalysisRecord): Promise<'created' | 'exists'> {
    if (this.analyses.has(record.analysisId)) return 'exists'
    const now = this.now()
    this.analyses.set(record.analysisId, {
      record: { ...clone(record), createdAt: now, updatedAt: now },
      rows: new Map(),
      seq: this.seq++,
    })
    return 'created'
  }

  async getRecord(analysisId: string): Promise<AnalysisRecord | undefined> {
    const stored = this.analyses.get(analysisId)
    return stored ? clone(stored.record) : undefined
  }

  async readPage(analysisId: string, after: number, limit: number): Promise<{ analysis: AnalysisMeta; rows: AnalysisResultRow[] } | undefined> {
    const stored = this.analyses.get(analysisId)
    if (!stored) return undefined
    const take = Math.min(MAX_READ_ROWS, Math.floor(limit))
    const rows = take > 0
      ? [...stored.rows.values()].filter((row) => row.rowIndex > after).sort((a, b) => a.rowIndex - b.rowIndex).slice(0, take)
      : []
    return { analysis: clone(toAnalysisMeta(stored.record)), rows: clone(rows) }
  }

  async claim(analysisId: string, ownerToken: string, leaseMs: number): Promise<AnalysisClaimResult> {
    const stored = this.analyses.get(analysisId)
    if (!stored) return 'missing'
    const { record } = stored
    if (record.status === 'complete' || record.status === 'cancelled') return 'finished'
    const now = this.now()
    const leased = stored.ownerToken !== undefined && (stored.leaseExpiresAt ?? 0) > now
    if (leased && stored.ownerToken !== ownerToken) return 'busy'
    record.status = 'running'
    delete record.error
    record.startedAt ??= now
    record.updatedAt = now
    stored.ownerToken = ownerToken
    stored.leaseExpiresAt = now + leaseMs
    return 'claimed'
  }

  async append(analysisId: string, ownerToken: string, rows: readonly AnalysisResultRow[], leaseMs: number): Promise<AnalysisAppendResult> {
    const stored = this.analyses.get(analysisId)
    if (!stored) return 'lost'
    if (stored.record.status === 'cancelled') return 'cancelled'
    if (stored.ownerToken === undefined || stored.ownerToken !== ownerToken) return 'lost'
    let completed = 0
    let failed = 0
    for (const row of clone([...rows])) {
      if (stored.rows.has(row.rowIndex)) continue
      stored.rows.set(row.rowIndex, row)
      completed += 1
      if (row.error) failed += 1
    }
    const now = this.now()
    stored.record.progress.completedRows += completed
    stored.record.progress.failedRows += failed
    stored.record.updatedAt = now
    stored.leaseExpiresAt = now + leaseMs
    return 'ok'
  }

  async finish(
    analysisId: string,
    ownerToken: string,
    outcome: { status: 'complete' } | { status: 'error'; error: AnalysisRowError } | { status: 'yield' },
  ): Promise<void> {
    const stored = this.analyses.get(analysisId)
    if (!stored || stored.record.status === 'cancelled' || stored.ownerToken === undefined || stored.ownerToken !== ownerToken) return
    const now = this.now()
    const { record } = stored
    if (outcome.status === 'complete') {
      record.status = 'complete'
      record.completedAt = now
    } else if (outcome.status === 'error') {
      record.status = 'error'
      record.error = clone(outcome.error)
    } else {
      record.status = 'running'
    }
    record.updatedAt = now
    delete stored.ownerToken
    delete stored.leaseExpiresAt
  }

  async cancel(analysisId: string): Promise<boolean> {
    const stored = this.analyses.get(analysisId)
    if (!stored || stored.record.status === 'complete' || stored.record.status === 'cancelled') return false
    const now = this.now()
    stored.record.status = 'cancelled'
    stored.record.completedAt = now
    stored.record.updatedAt = now
    delete stored.ownerToken
    delete stored.leaseExpiresAt
    return true
  }

  async listRecent(limit: number): Promise<AnalysisMeta[]> {
    const take = Math.min(MAX_LIST, Math.floor(limit))
    if (!(take > 0)) return []
    return [...this.analyses.values()]
      .sort((a, b) => b.record.createdAt - a.record.createdAt || b.seq - a.seq)
      .slice(0, take)
      .map((stored) => clone(toAnalysisMeta(stored.record)))
  }
}

export class InMemoryDatasetStore implements DatasetStorage {
  private readonly datasets = new Map<string, { record: DatasetRecord; rows: DatasetRowValues[]; seq: number }>()
  private seq = 0

  constructor(private readonly now: () => number = Date.now) {}

  async put(record: DatasetRecord, rows: readonly DatasetRowValues[]): Promise<void> {
    if (this.datasets.has(record.datasetId)) return
    if (rows.length !== record.acceptedRowCount) throw new Error(`Dataset has ${rows.length} rows, expected ${record.acceptedRowCount}`)
    this.datasets.set(record.datasetId, {
      record: { ...clone(record), createdAt: this.now() },
      rows: clone([...rows]),
      seq: this.seq++,
    })
  }

  async get(datasetId: string): Promise<DatasetRecord | undefined> {
    const stored = this.datasets.get(datasetId)
    return stored ? clone(stored.record) : undefined
  }

  async getRows(datasetId: string, offset: number, limit: number): Promise<DatasetRowValues[]> {
    const stored = this.datasets.get(datasetId)
    const start = Math.floor(offset)
    const count = Math.min(MAX_READ_ROWS, Math.floor(limit))
    if (!stored || !(start >= 0) || !(count > 0)) return []
    return clone(stored.rows.slice(start, start + count))
  }

  async listRecent(limit: number): Promise<DatasetRecord[]> {
    const take = Math.min(MAX_LIST, Math.floor(limit))
    if (!(take > 0)) return []
    return [...this.datasets.values()]
      .sort((a, b) => b.record.createdAt - a.record.createdAt || b.seq - a.seq)
      .slice(0, take)
      .map((stored) => clone(stored.record))
  }
}

export class InMemoryLimitsStore implements LimitsStorage {
  private readonly windows = new Map<string, { windowStart: number; count: number }>()
  private readonly budgets = new Map<string, number>()

  constructor(private readonly now: () => number = Date.now) {}

  async consumeRate(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterMs: number }> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid limit')
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('Invalid window')
    const now = this.now()
    const current = this.windows.get(key)
    if (!current || now - current.windowStart >= windowMs) {
      this.windows.set(key, { windowStart: now, count: 1 })
      return { allowed: true, retryAfterMs: 0 }
    }
    if (current.count >= limit) return { allowed: false, retryAfterMs: Math.max(1, current.windowStart + windowMs - now) }
    current.count += 1
    return { allowed: true, retryAfterMs: 0 }
  }

  async reserveBudget(scope: string, amount: number, max: number): Promise<{ allowed: boolean; remaining: number }> {
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid amount')
    if (!Number.isFinite(max) || max < 0) throw new Error('Invalid max')
    const total = this.budgets.get(scope) ?? 0
    if (total + amount > max) return { allowed: false, remaining: max - total }
    this.budgets.set(scope, total + amount)
    return { allowed: true, remaining: max - (total + amount) }
  }
}
