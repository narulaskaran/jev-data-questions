import type { FootballModelInput } from '../fixtures/footballTimeline.js'
import type { AnalysisRowInput, DatasetSourceType } from './dataset.js'
import type { JevQuestionKind } from './questionKind.js'

export type { JevQuestionKind } from './questionKind.js'
export {
  SAMPLE_WIN_LIKELIHOOD_TASK,
  SAMPLE_WIN_NOUL_QUERY,
  SQUIRREL_EATING_NOUL_QUERY,
  SQUIRREL_EATING_TASK,
} from './questionKind.js'

export const ANALYSIS_MAX_CALLS = 5_000
export const ANALYSIS_MAX_ROWS = 5_000
export const ANALYSIS_MAX_CLASSES = 32
export const ANALYSIS_MAX_CLASS_LENGTH = 80
export const ANALYSIS_MAX_QUERY_LENGTH = 20_000
export const ANALYSIS_MAX_TASK_LENGTH = 2_000
export const ANALYSIS_RUN_LEASE_MS = 5 * 60_000
export const ANALYSIS_STALE_AFTER_MS = 15 * 60_000
/** UI stall copy and lease-dead heal. Frozen queued/running runs flip to retryable error. */
export const ANALYSIS_STALL_AFTER_MS = 60_000
export const ANALYSIS_RUN_STALLED_CODE = 'ANALYSIS_RUN_STALLED'
export const ANALYSIS_CLASS_NAMES = ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'] as const

export type AnalysisClassName = typeof ANALYSIS_CLASS_NAMES[number]
export type AnalysisStatus = 'queued' | 'running' | 'complete' | 'error'
export type { AnalysisRowInput, DatasetSourceType }

export interface AnalysisProgress {
  completedRows: number
  totalRows: number
  completedCalls: number
  totalCalls: number
}

export interface AnalysisClassification {
  model: string
  questionKind?: JevQuestionKind
  selectedClass?: string
  probabilities?: Record<string, number>
  confidence?: number
  value?: number
}

export interface AnalysisResultRow {
  rowIndex: number
  input: AnalysisRowInput
  model: string
  questionKind?: JevQuestionKind
  selectedClass?: string
  probabilities?: Record<string, number>
  confidence?: number
  value?: number
  error?: { code: string; retryable: boolean }
}

export interface AnalysisSnapshot {
  analysisId: string
  fixtureId: string
  datasetId: string
  sourceType: DatasetSourceType
  query: string
  status: AnalysisStatus
  createdAt: string
  updatedAt: string
  progress: AnalysisProgress
  questionKind?: JevQuestionKind
  classes: readonly string[]
  columns: readonly string[]
  currentFixtureRow?: { rowIndex: number; input: AnalysisRowInput }
  resultRows: readonly AnalysisResultRow[]
  error?: { code: string; retryable: boolean }
}

export interface AnalysisDraftInput {
  fixtureId?: string
  datasetId?: string
  task: string
}

export interface AnalysisDraftResult {
  fixtureId: string
  datasetId: string
  sourceType: DatasetSourceType
  query: string
  metadata: {
    provider: string
    model: string
    rowCount: number
    classes: readonly string[]
    columns: readonly string[]
    displayName: string
    questionKind?: JevQuestionKind
    inputHalf?: 'H1'
    labelHalf?: 'H2'
    /** Dogfood: durable draft cache write outcome. Omitted from stored Convex drafts. */
    cacheWrite?: 'ok' | 'skipped'
  }
}

export interface AnalysisStartInput {
  fixtureId?: string
  datasetId?: string
  query: string
  analysisId?: string
  classes?: readonly string[]
  questionKind?: JevQuestionKind
  /** Skip content-hash reuse and mint a new analysis. Same analysisId is still idempotent. */
  forceNew?: boolean
  /** Requeue an errored analysis and continue from the last persisted row. */
  resume?: boolean
}

export interface AnalysisStorage {
  get(analysisId: string): Promise<AnalysisSnapshot | undefined> | AnalysisSnapshot | undefined
  put(snapshot: AnalysisSnapshot): Promise<void> | void
  getPublic?(analysisId: string): Promise<AnalysisSnapshot | undefined> | AnalysisSnapshot | undefined
  findCompleteByContentKey(contentKey: string): Promise<AnalysisSnapshot | undefined> | AnalysisSnapshot | undefined
  /** Return a complete/running/queued snapshot for this key, or store `snapshot` and return it. */
  claimByContentKey(contentKey: string, snapshot: AnalysisSnapshot): Promise<AnalysisSnapshot> | AnalysisSnapshot
  getDraftByContentKey(contentKey: string): Promise<AnalysisDraftResult | undefined> | AnalysisDraftResult | undefined
  putDraft(contentKey: string, draft: AnalysisDraftResult): Promise<void> | void
  claim?(analysisId: string, ownerToken: string, nowMs: number, leaseMs: number): Promise<'claimed' | 'busy' | 'complete' | 'missing' | 'error'> | 'claimed' | 'busy' | 'complete' | 'missing' | 'error'
  release?(analysisId: string, ownerToken: string): Promise<void> | void
  /** Mark a lease-dead queued/running snapshot as a retryable error. Missing stays undefined. */
  healStale?(analysisId: string, nowMs: number): Promise<AnalysisSnapshot | undefined> | AnalysisSnapshot | undefined
}

export const progressAgeMs = (updatedAt: string, nowMs: number): number => {
  const at = Date.parse(updatedAt)
  return Number.isFinite(at) ? Math.max(0, nowMs - at) : 0
}

/** Heal when the run is queued/running, progress is frozen ~60s, and the lease is missing or expired. */
export const shouldHealStalledRun = (input: {
  status: AnalysisStatus
  updatedAt: string
  nowMs: number
  leaseExpiresAt?: number
}): boolean => {
  if (input.status !== 'queued' && input.status !== 'running') return false
  if (progressAgeMs(input.updatedAt, input.nowMs) < ANALYSIS_STALL_AFTER_MS) return false
  if (input.leaseExpiresAt !== undefined && input.leaseExpiresAt > input.nowMs) return false
  return true
}

export const cloneAnalysisSnapshot = (snapshot: AnalysisSnapshot): AnalysisSnapshot => JSON.parse(JSON.stringify({
  ...snapshot,
  resultRows: [...snapshot.resultRows].sort((left, right) => left.rowIndex - right.rowIndex),
})) as AnalysisSnapshot

export const serializeAnalysisSnapshot = (snapshot: AnalysisSnapshot): string => JSON.stringify(cloneAnalysisSnapshot(snapshot))

export const normalizeSnapshot = (snapshot: AnalysisSnapshot): AnalysisSnapshot => {
  const datasetId = snapshot.datasetId || snapshot.fixtureId
  return {
    ...snapshot,
    datasetId,
    fixtureId: snapshot.fixtureId || datasetId,
    sourceType: snapshot.sourceType ?? 'fixture',
    questionKind: snapshot.questionKind,
    classes: snapshot.classes ?? [],
    columns: snapshot.columns ?? [],
  }
}

export type { FootballModelInput }
