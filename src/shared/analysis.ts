import type { AnalysisRowValue, DatasetSourceType } from '../dataset/csvTypes.js'

export const ANALYSIS_MAX_ROWS = 5_000
export const ANALYSIS_MIN_CLASSES = 2
export const ANALYSIS_MAX_CLASSES = 32
export const ANALYSIS_MAX_CLASS_LENGTH = 80
export const ANALYSIS_MAX_CLASS_DESCRIPTION_LENGTH = 300
export const ANALYSIS_MAX_QUERY_LENGTH = 4_000
export const ANALYSIS_MAX_TASK_LENGTH = 2_000
export const ANALYSIS_MAX_ID_LENGTH = 64
/** Rows returned by one read. The server may return fewer to stay under a byte budget. */
export const ANALYSIS_READ_PAGE_ROWS = 500

export type AnalysisStatus = 'queued' | 'running' | 'complete' | 'error' | 'cancelled'
export type AnalysisMode = 'live' | 'mock'

export interface AnalysisClass {
  name: string
  /** What the label means. Sent to Jev as the choice criterion. */
  description: string
}

export interface AnalysisRowError {
  code: string
  retryable: boolean
}

export interface AnalysisProgress {
  totalRows: number
  /** Rows with a stored outcome (classified or failed). Rows 0..completedRows-1 always exist. */
  completedRows: number
  failedRows: number
}

/**
 * One durable per-row outcome. It deliberately carries no row input: inputs are
 * immutable dataset rows and are joined on read.
 */
export interface AnalysisResultRow {
  rowIndex: number
  model: string
  selectedClass?: string
  /** Index-aligned with the analysis `classes`. */
  probabilities?: number[]
  confidence?: number
  latencyMs?: number
  error?: AnalysisRowError
}

/** Public analysis metadata. */
export interface AnalysisMeta {
  analysisId: string
  datasetId: string
  datasetName: string
  sourceType: DatasetSourceType
  query: string
  classes: AnalysisClass[]
  /** Every dataset column, in order. Row `values` are aligned with this. */
  columns: string[]
  /** Held-out column: never sent to Jev, only used to score predictions. */
  labelColumn?: string
  status: AnalysisStatus
  mode: AnalysisMode
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  progress: AnalysisProgress
  error?: AnalysisRowError
}

/** Server-side record: public metadata plus what must never reach a browser. */
export interface AnalysisRecord extends AnalysisMeta {
  /** SHA-256 of the control token handed to the run's creator. */
  controlTokenHash: string
}

/** A result row joined with its dataset row for the browser. */
export interface AnalysisViewRow extends AnalysisResultRow {
  values: AnalysisRowValue[]
}

/** `GET /api/analysis/<id>?after=N` */
export interface AnalysisPage {
  analysis: AnalysisMeta
  /** Rows with `rowIndex > after`, ascending and contiguous. */
  rows: AnalysisViewRow[]
  /** Pass as `after` on the next read. */
  nextAfter: number
  /** More stored rows are available right now. */
  hasMore: boolean
  /** Server clock, so the browser can judge staleness without trusting its own. */
  serverTime: number
}

export interface AnalysisDraftInput {
  datasetId: string
  task: string
  labelColumn?: string
}

export interface AnalysisDraftResult {
  datasetId: string
  query: string
  classes: AnalysisClass[]
  model: string
  mode: AnalysisMode
}

export interface AnalysisStartInput {
  datasetId: string
  query: string
  classes: AnalysisClass[]
  labelColumn?: string
}

export interface AnalysisStartResult {
  analysis: AnalysisMeta
  /** Lets the creator cancel or resume. Shown once; keep it in the browser. */
  controlToken: string
}

export interface AnalysisBrowseItem {
  analysisId: string
  datasetName: string
  query: string
  status: AnalysisStatus
  completedRows: number
  totalRows: number
  createdAt: number
}

export type AnalysisClaimResult = 'claimed' | 'busy' | 'finished' | 'missing'
export type AnalysisAppendResult = 'ok' | 'lost' | 'cancelled'

/**
 * Durable analysis storage. Every write is append-only or a small patch: no
 * call ever rewrites the stored rows.
 */
export interface AnalysisStorage {
  /** Insert a new analysis. Returns `exists` (and changes nothing) when the ID is taken. */
  create(record: AnalysisRecord): Promise<'created' | 'exists'>
  /** Full server-side record, including `controlTokenHash`. */
  getRecord(analysisId: string): Promise<AnalysisRecord | undefined>
  /** Public metadata plus up to `limit` stored rows with `rowIndex > after`, ascending. */
  readPage(analysisId: string, after: number, limit: number): Promise<{ analysis: AnalysisMeta; rows: AnalysisResultRow[] } | undefined>
  /**
   * Take the run lease. `finished` for complete/cancelled runs, `busy` while
   * another owner holds an unexpired lease. A successful claim sets status
   * `running`, clears any error, and sets `startedAt` once.
   */
  claim(analysisId: string, ownerToken: string, leaseMs: number): Promise<AnalysisClaimResult>
  /**
   * Store outcomes and renew the lease in one transaction. Rows whose
   * `rowIndex` already exists are ignored. Progress counters are updated from
   * the rows actually inserted. `lost` when the caller no longer owns the
   * lease; `cancelled` when the run was cancelled (nothing is stored).
   */
  append(analysisId: string, ownerToken: string, rows: readonly AnalysisResultRow[], leaseMs: number): Promise<AnalysisAppendResult>
  /**
   * Release the lease. `complete` and `error` set that status (and
   * `completedAt` for complete); `yield` keeps the run `running` so a
   * continuation can claim it. No-op if the caller is not the lease owner or the
   * run was cancelled.
   */
  finish(analysisId: string, ownerToken: string, outcome: { status: 'complete' } | { status: 'error'; error: AnalysisRowError } | { status: 'yield' }): Promise<void>
  /** Mark a queued or running analysis cancelled. Returns false when it was already terminal or missing. */
  cancel(analysisId: string): Promise<boolean>
  /** Newest first. */
  listRecent(limit: number): Promise<AnalysisMeta[]>
}

/** Durable abuse and spend counters. */
export interface LimitsStorage {
  /** Fixed-window counter. Consumes one unit when allowed. */
  consumeRate(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterMs: number }>
  /** Atomically add `amount` to the scope's total when it stays within `max`. */
  reserveBudget(scope: string, amount: number, max: number): Promise<{ allowed: boolean; remaining: number }>
}

export const toAnalysisMeta = (record: AnalysisRecord): AnalysisMeta => {
  const { controlTokenHash: _controlTokenHash, ...meta } = record
  return meta
}

export const isTerminalStatus = (status: AnalysisStatus): boolean => status === 'complete' || status === 'cancelled'
