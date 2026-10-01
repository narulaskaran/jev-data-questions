import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { rowToInput, type DatasetRowValues } from '../dataset/csvTypes.js'
import {
  ANALYSIS_MAX_ID_LENGTH,
  ANALYSIS_MAX_QUERY_LENGTH,
  ANALYSIS_MAX_TASK_LENGTH,
  ANALYSIS_READ_PAGE_ROWS,
  toAnalysisMeta,
  type AnalysisBrowseItem,
  type AnalysisDraftInput,
  type AnalysisDraftResult,
  type AnalysisPage,
  type AnalysisRecord,
  type AnalysisResultRow,
  type AnalysisStartInput,
  type AnalysisStartResult,
  type AnalysisStorage,
  type AnalysisViewRow,
  type LimitsStorage,
} from '../shared/analysis.js'
import type { DatasetRecord } from '../shared/dataset.js'
import type { DatasetService } from './datasets.js'
import { ApiError, errorName } from './errors.js'
import { normalizeClasses, type Classifier, type DraftProvider } from './providers.js'

const HOUR_MS = 60 * 60_000
/** Long enough for one batch of slow, retried Jev calls; renewed on every append. */
export const RUN_LEASE_MS = 60_000
/** A provider outage should stop the run, not burn the whole dataset on errors. */
export const MAX_CONSECUTIVE_FAILURES = 5
const DATASET_PAGE_ROWS = 200
/** Keeps a read response comfortably under serverless response limits. */
const READ_PAGE_BYTE_BUDGET = 1_500_000
const LABEL_SCAN_ROWS = 500
const MAX_LABEL_VALUES = 12

export interface AnalysisLimitsConfig {
  runsDisabled: boolean
  maxRowsPerRun: number
  dailyCallBudget: number
  runsPerHour: number
  draftsPerHour: number
  concurrency: number
}

export interface AnalysisServiceOptions {
  /** Absent when durable storage is not configured: everything fails closed. */
  store?: AnalysisStorage
  limits?: LimitsStorage
  datasets: DatasetService
  draftProvider?: DraftProvider
  classifier?: Classifier
  config: AnalysisLimitsConfig
  now?: () => number
  idFactory?: () => string
}

export type ChunkOutcome = 'complete' | 'continue' | 'stopped'

const validText = (value: unknown, maximum: number): value is string => (
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !value.includes('\u0000')
)

export const hashControlToken = (token: string): string => createHash('sha256').update(token).digest('hex')

const sameHash = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10)

export class AnalysisService {
  private readonly now: () => number
  private readonly idFactory: () => string

  constructor(private readonly options: AnalysisServiceOptions) {
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
  }

  private requireStore(): AnalysisStorage {
    if (!this.options.store) throw new ApiError('STORAGE_NOT_CONFIGURED', 'This deployment has no storage configured, so runs are unavailable.', 503)
    return this.options.store
  }

  private async rateLimit(action: 'draft' | 'run', clientKey: string, limit: number): Promise<void> {
    if (!this.options.limits) return
    const result = await this.options.limits.consumeRate(`${action}:${clientKey}`, limit, HOUR_MS)
    if (!result.allowed) {
      throw new ApiError('RATE_LIMITED', `You have reached this playground's hourly ${action} limit. Please try again later.`, 429, { retryable: true, retryAfterMs: result.retryAfterMs })
    }
  }

  private async requireDataset(datasetId: unknown): Promise<DatasetRecord> {
    if (!validText(datasetId, ANALYSIS_MAX_ID_LENGTH)) throw new ApiError('INVALID_DATASET', 'Choose a dataset first.')
    const dataset = await this.options.datasets.getRecord(datasetId.trim())
    if (!dataset) throw new ApiError('DATASET_NOT_FOUND', 'That dataset was not found.', 404)
    return dataset
  }

  private resolveLabelColumn(dataset: DatasetRecord, labelColumn: unknown): string | undefined {
    if (labelColumn === undefined || labelColumn === null || labelColumn === '') return undefined
    const names = dataset.columns.map((column) => column.name)
    if (typeof labelColumn !== 'string' || !names.includes(labelColumn)) throw new ApiError('INVALID_LABEL_COLUMN', 'The answer column is not in this dataset.')
    if (names.length < 2) throw new ApiError('INVALID_LABEL_COLUMN', 'The dataset needs at least one other column for Jev to read.')
    return labelColumn
  }

  /** Distinct held-out answers, when there are few enough to be the label set. */
  private async labelValues(dataset: DatasetRecord, labelColumn: string): Promise<string[] | undefined> {
    const index = dataset.columns.findIndex((column) => column.name === labelColumn)
    const rows = await this.options.datasets.getRows(dataset.datasetId, 0, LABEL_SCAN_ROWS)
    const values = new Set<string>()
    for (const row of rows) {
      const value = row[index]
      if (value === null || value === undefined) continue
      values.add(String(value).trim())
      if (values.size > MAX_LABEL_VALUES) return undefined
    }
    return values.size >= 2 ? [...values] : undefined
  }

  async draft(input: AnalysisDraftInput, clientKey: string): Promise<AnalysisDraftResult> {
    if (!validText(input.task, ANALYSIS_MAX_TASK_LENGTH)) throw new ApiError('INVALID_TASK', 'Describe what you want to find out, in up to 2,000 characters.')
    const dataset = await this.requireDataset(input.datasetId)
    const labelColumn = this.resolveLabelColumn(dataset, input.labelColumn)
    const provider = this.options.draftProvider
    if (!provider) throw new ApiError('DRAFTING_NOT_CONFIGURED', 'Drafting is not set up on this deployment. Write the question and labels yourself.', 503)
    await this.rateLimit('draft', clientKey, this.options.config.draftsPerHour)
    const columns = dataset.columns.map((column) => column.name)
    const inputColumns = columns.filter((name) => name !== labelColumn)
    const labelIndex = labelColumn ? columns.indexOf(labelColumn) : -1
    const draft = await provider.draft({
      task: input.task.trim(),
      datasetName: dataset.displayName,
      columns: inputColumns,
      sampleRows: dataset.previewRows.slice(0, 5).map((row) => rowToInput(inputColumns, row.filter((_, index) => index !== labelIndex))),
      ...(labelColumn ? { labelValues: await this.labelValues(dataset, labelColumn) } : {}),
    })
    return { datasetId: dataset.datasetId, query: draft.query, classes: draft.classes, model: draft.model, mode: provider.mode }
  }

  async start(input: AnalysisStartInput, clientKey: string): Promise<AnalysisStartResult> {
    const store = this.requireStore()
    const { config } = this.options
    if (config.runsDisabled) throw new ApiError('RUNS_DISABLED', 'New runs are paused on this playground right now.', 503)
    const classifier = this.options.classifier
    if (!classifier) throw new ApiError('JEV_NOT_CONFIGURED', 'Jev is not set up on this deployment yet.', 503)
    if (!validText(input.query, ANALYSIS_MAX_QUERY_LENGTH)) throw new ApiError('INVALID_QUERY', 'Write the question Jev should answer for each row (up to 4,000 characters).')
    const classes = normalizeClasses(input.classes)
    if (!classes) throw new ApiError('INVALID_CLASSES', 'Give Jev between 2 and 32 distinct labels to choose from.')
    const dataset = await this.requireDataset(input.datasetId)
    const labelColumn = this.resolveLabelColumn(dataset, input.labelColumn)
    if (dataset.acceptedRowCount < 1) throw new ApiError('INVALID_DATASET', 'That dataset has no rows.')
    if (dataset.acceptedRowCount > config.maxRowsPerRun) {
      throw new ApiError('RUN_TOO_LARGE', `This playground runs at most ${config.maxRowsPerRun.toLocaleString('en-US')} rows at a time.`, 413)
    }
    await this.rateLimit('run', clientKey, config.runsPerHour)
    if (classifier.mode === 'live' && this.options.limits) {
      const budget = await this.options.limits.reserveBudget(`jev-calls:${utcDay(this.now())}`, dataset.acceptedRowCount, config.dailyCallBudget)
      if (!budget.allowed) throw new ApiError('DAILY_BUDGET_EXHAUSTED', 'This playground has used its Jev budget for today. Please come back tomorrow.', 429, { retryable: true })
    }
    const controlToken = randomBytes(24).toString('hex')
    const timestamp = this.now()
    const record: AnalysisRecord = {
      analysisId: this.idFactory(),
      datasetId: dataset.datasetId,
      datasetName: dataset.displayName,
      sourceType: dataset.sourceType,
      query: input.query.trim(),
      classes,
      columns: dataset.columns.map((column) => column.name),
      ...(labelColumn ? { labelColumn } : {}),
      status: 'queued',
      mode: classifier.mode,
      createdAt: timestamp,
      updatedAt: timestamp,
      progress: { totalRows: dataset.acceptedRowCount, completedRows: 0, failedRows: 0 },
      controlTokenHash: hashControlToken(controlToken),
    }
    if (await store.create(record) === 'exists') throw new ApiError('INTERNAL_ERROR', 'Could not create the run. Please try again.', 500, { retryable: true })
    return { analysis: toAnalysisMeta(record), controlToken }
  }

  async read(analysisId: string, after = -1): Promise<AnalysisPage> {
    const store = this.requireStore()
    if (!validText(analysisId, ANALYSIS_MAX_ID_LENGTH)) throw new ApiError('ANALYSIS_NOT_FOUND', 'That run was not found.', 404)
    const cursor = Number.isInteger(after) && after >= -1 ? after : -1
    const page = await store.readPage(analysisId, cursor, ANALYSIS_READ_PAGE_ROWS)
    if (!page) throw new ApiError('ANALYSIS_NOT_FOUND', 'That run was not found.', 404)
    const inputs = page.rows.length > 0 ? await this.options.datasets.getRows(page.analysis.datasetId, page.rows[0].rowIndex, page.rows.length) : []
    const rows: AnalysisViewRow[] = []
    let bytes = 0
    for (let index = 0; index < page.rows.length; index += 1) {
      const row: AnalysisViewRow = { ...page.rows[index], values: inputs[index] ?? [] }
      bytes += JSON.stringify(row).length
      if (rows.length > 0 && bytes > READ_PAGE_BYTE_BUDGET) break
      rows.push(row)
    }
    const nextAfter = rows.length > 0 ? rows[rows.length - 1].rowIndex : cursor
    return {
      analysis: page.analysis,
      rows,
      nextAfter,
      hasMore: nextAfter < page.analysis.progress.completedRows - 1,
      serverTime: this.now(),
    }
  }

  private async requireControl(analysisId: unknown, controlToken: unknown): Promise<AnalysisRecord> {
    const store = this.requireStore()
    if (!validText(analysisId, ANALYSIS_MAX_ID_LENGTH)) throw new ApiError('ANALYSIS_NOT_FOUND', 'That run was not found.', 404)
    const record = await store.getRecord(analysisId)
    if (!record) throw new ApiError('ANALYSIS_NOT_FOUND', 'That run was not found.', 404)
    if (typeof controlToken !== 'string' || !sameHash(hashControlToken(controlToken), record.controlTokenHash)) {
      throw new ApiError('NOT_RUN_OWNER', 'Only the browser that started this run can control it.', 403)
    }
    return record
  }

  async cancel(analysisId: unknown, controlToken: unknown): Promise<void> {
    const record = await this.requireControl(analysisId, controlToken)
    await this.requireStore().cancel(record.analysisId)
  }

  /** Validates that the caller may resume. The caller then drives `runChunk`. */
  async authorizeResume(analysisId: unknown, controlToken: unknown): Promise<AnalysisRecord> {
    const record = await this.requireControl(analysisId, controlToken)
    if (record.status === 'complete' || record.status === 'cancelled') throw new ApiError('RUN_FINISHED', 'This run has already finished.', 409)
    if (this.options.config.runsDisabled) throw new ApiError('RUNS_DISABLED', 'Runs are paused on this playground right now.', 503)
    return record
  }

  /**
   * Classify rows for at most `budgetMs`, then hand off. Each batch is one
   * append; nothing already stored is rewritten. `continue` means rows remain
   * and the lease has been released for the next invocation.
   */
  async runChunk(analysisId: string, budgetMs: number, options: { resumeErrors?: boolean } = {}): Promise<ChunkOutcome> {
    const store = this.requireStore()
    const classifier = this.options.classifier
    if (!classifier) return 'stopped'
    // Only an explicit resume by the run's creator may restart a run that stopped on an error.
    if (!options.resumeErrors && (await store.getRecord(analysisId))?.status === 'error') return 'stopped'
    const ownerToken = `${this.idFactory()}`
    const claimed = await store.claim(analysisId, ownerToken, RUN_LEASE_MS)
    if (claimed !== 'claimed') return 'stopped'
    try {
      const record = await store.getRecord(analysisId)
      if (!record) return 'stopped'
      const total = record.progress.totalRows
      const labelIndex = record.labelColumn ? record.columns.indexOf(record.labelColumn) : -1
      const inputColumns = record.columns.filter((_, index) => index !== labelIndex)
      const deadline = this.now() + budgetMs
      const concurrency = Math.max(1, this.options.config.concurrency)
      let cache: { offset: number; rows: DatasetRowValues[] } = { offset: 0, rows: [] }
      const rowAt = async (rowIndex: number): Promise<DatasetRowValues | undefined> => {
        if (rowIndex < cache.offset || rowIndex >= cache.offset + cache.rows.length) {
          const offset = Math.floor(rowIndex / DATASET_PAGE_ROWS) * DATASET_PAGE_ROWS
          cache = { offset, rows: await this.options.datasets.getRows(record.datasetId, offset, DATASET_PAGE_ROWS) }
        }
        return cache.rows[rowIndex - cache.offset]
      }
      let next = record.progress.completedRows
      let failureStreak = 0
      while (next < total) {
        if (this.now() >= deadline) {
          await store.finish(analysisId, ownerToken, { status: 'yield' })
          return 'continue'
        }
        const indexes = Array.from({ length: Math.min(concurrency, total - next) }, (_, offset) => next + offset)
        const batch: Array<{ rowIndex: number; values: DatasetRowValues | undefined }> = []
        for (const rowIndex of indexes) batch.push({ rowIndex, values: await rowAt(rowIndex) })
        const results = await Promise.all(batch.map(async ({ rowIndex, values }): Promise<AnalysisResultRow> => {
          const startedAt = this.now()
          try {
            if (!values) throw new ApiError('ROW_MISSING', 'The dataset row is missing.', 500)
            const answer = await classifier.classify({
              analysisId,
              rowIndex,
              query: record.query,
              classes: record.classes,
              input: rowToInput(inputColumns, values.filter((_, index) => index !== labelIndex)),
            })
            return {
              rowIndex,
              model: answer.model,
              selectedClass: answer.selectedClass,
              ...(answer.probabilities ? { probabilities: answer.probabilities } : {}),
              ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
              latencyMs: this.now() - startedAt,
            }
          } catch (error) {
            const failure = error instanceof ApiError ? { code: error.code, retryable: error.retryable } : { code: 'CLASSIFIER_ERROR', retryable: false }
            return { rowIndex, model: classifier.mode === 'mock' ? 'simulated' : 'jev', error: failure, latencyMs: this.now() - startedAt }
          }
        }))
        const appended = await store.append(analysisId, ownerToken, results, RUN_LEASE_MS)
        if (appended !== 'ok') return 'stopped'
        next += results.length
        for (const result of results) failureStreak = result.error ? failureStreak + 1 : 0
        if (failureStreak >= MAX_CONSECUTIVE_FAILURES) {
          const last = results[results.length - 1].error ?? { code: 'CLASSIFIER_ERROR', retryable: true }
          await store.finish(analysisId, ownerToken, { status: 'error', error: last })
          return 'stopped'
        }
      }
      await store.finish(analysisId, ownerToken, { status: 'complete' })
      return 'complete'
    } catch (error) {
      console.error('[analysis] chunk failed', { analysisId, name: errorName(error) })
      await store.finish(analysisId, ownerToken, { status: 'error', error: { code: 'RUN_INTERRUPTED', retryable: true } }).catch(() => undefined)
      return 'stopped'
    }
  }

  async listRecent(limit: number): Promise<AnalysisBrowseItem[]> {
    if (!this.options.store) return []
    return (await this.options.store.listRecent(limit)).map((analysis) => ({
      analysisId: analysis.analysisId,
      datasetName: analysis.datasetName,
      query: analysis.query.slice(0, 160),
      status: analysis.status,
      completedRows: analysis.progress.completedRows,
      totalRows: analysis.progress.totalRows,
      createdAt: analysis.createdAt,
    }))
  }
}
