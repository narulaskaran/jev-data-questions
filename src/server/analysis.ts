import { randomUUID } from 'node:crypto'
import {
  ANALYSIS_MAX_CALLS,
  ANALYSIS_MAX_CLASSES,
  ANALYSIS_MAX_CLASS_LENGTH,
  ANALYSIS_MAX_QUERY_LENGTH,
  ANALYSIS_MAX_ROWS,
  ANALYSIS_MAX_TASK_LENGTH,
  ANALYSIS_RUN_LEASE_MS,
  ANALYSIS_RUN_STALLED_CODE,
  ANALYSIS_STALE_AFTER_MS,
  cloneAnalysisSnapshot,
  normalizeSnapshot,
  shouldHealStalledRun,
  type AnalysisClassification,
  type AnalysisDraftInput,
  type AnalysisDraftResult,
  type AnalysisRowInput,
  type AnalysisResultRow,
  type AnalysisSnapshot,
  type AnalysisStartInput,
  type AnalysisStorage,
  type DatasetSourceType,
  type JevQuestionKind,
} from '../shared/analysis.js'
import {
  fixtureAnalysisSliceFor,
  inferQuestionKind,
  isFixturePlayerClassList,
  isSampleDefaultEatingTask,
  isSampleDefaultWinTask,
  classesFromLabelColumns,
  mergeClassLists,
  resolveDraftedQuery,
  SAMPLE_WIN_NOUL_QUERY,
  SQUIRREL_EATING_NOUL_QUERY,
  userAskedForFixturePlayers,
  type FixtureAnalysisSlice,
} from '../shared/questionKind.js'
import { analysisContentKey, analysisContentKeyFromSnapshot, draftContentKey } from './analysisContentKey.js'
import {
  buildJevQuery,
  classesFromJevQuery,
  parseJevQueryJson,
  stringifyJevQuery,
} from '../shared/jevQuery.js'
import { asAnalysisRow } from '../shared/dataset.js'
import { SAMPLE_DATASET_NAME } from '../shared/sampleDatasetName.js'
import {
  FOOTBALL_FIXTURE_ID,
  footballFixture,
  footballFixtureModelInputFields,
  footballFixtureWinLikelihoodInputFields,
  getHalftimeModelInput,
  getWinLikelihoodModelInput,
} from '../fixtures/footballTimeline.js'
import {
  SQUIRREL_DATASET_NAME,
  SQUIRREL_FIXTURE_ID,
  SQUIRREL_FIXTURE_SCHEMA,
  getSquirrelModelInput,
} from '../fixtures/squirrelCensus.js'

export type { AnalysisClassification, AnalysisDraftInput, AnalysisDraftResult, AnalysisResultRow, AnalysisSnapshot, AnalysisStartInput, AnalysisStorage } from '../shared/analysis.js'
export { ANALYSIS_CLASS_NAMES, ANALYSIS_MAX_CALLS, ANALYSIS_MAX_QUERY_LENGTH, ANALYSIS_MAX_ROWS, ANALYSIS_MAX_TASK_LENGTH } from '../shared/analysis.js'

/** Bounded Jev pool size. Large BYOD runs overlap classify with Convex puts. */
export const ANALYSIS_CLASSIFY_CONCURRENCY = 6

export interface ResolvedAnalysisDataset {
  datasetId: string
  fixtureId: string
  sourceType: DatasetSourceType
  displayName: string
  columns: readonly string[]
  rows: readonly AnalysisRowInput[]
  classes?: readonly string[]
}

export interface AnalysisDatasetSource {
  get(datasetId: string): Promise<ResolvedAnalysisDataset | undefined> | ResolvedAnalysisDataset | undefined
}

export interface AnalysisDraftProvider {
  draft(input: {
    fixtureId: string
    datasetId: string
    task: string
    classes?: readonly string[]
    columns?: readonly string[]
    sampleRows?: AnalysisRowInput[]
    sourceType?: DatasetSourceType
    questionKindHint?: JevQuestionKind
  }): Promise<{ query: string; model: string; classes?: readonly string[]; questionKind?: JevQuestionKind }>
}

export interface AnalysisClassifier {
  assertConfigured?: () => void
  classify(input: {
    analysisId: string
    fixtureId: string
    datasetId: string
    query: string
    rowIndex: number
    row: AnalysisRowInput
    classes: readonly string[]
    questionKind?: JevQuestionKind
  }): Promise<AnalysisClassification>
}

export class AnalysisError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, statusCode = 400, retryable = false) {
    super(message)
    this.name = 'AnalysisError'
    this.code = code
    this.statusCode = statusCode
    this.retryable = retryable
  }
}

const cloneDraftResult = (draft: AnalysisDraftResult): AnalysisDraftResult => JSON.parse(JSON.stringify(draft)) as AnalysisDraftResult

const persistableDraft = (draft: AnalysisDraftResult): AnalysisDraftResult => {
  const cloned = cloneDraftResult(draft)
  delete cloned.metadata.cacheWrite
  return cloned
}

const withCacheWrite = (draft: AnalysisDraftResult, cacheWrite: 'ok' | 'skipped'): AnalysisDraftResult => ({
  ...cloneDraftResult(draft),
  metadata: { ...draft.metadata, cacheWrite },
})

const resolveDatasetHint = (input: { datasetId?: string; fixtureId?: string }): string => {
  if (typeof input.datasetId === 'string' && input.datasetId.trim()) return input.datasetId.trim()
  if (typeof input.fixtureId === 'string' && input.fixtureId.trim()) return input.fixtureId.trim()
  return ''
}

const cacheFailureReason = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message.replace(/\s+/g, ' ').slice(0, 240)
  return 'unknown'
}

const startReuseParts = (
  query: string,
  parsedQuery: ReturnType<typeof parseJevQueryJson>,
  input: Pick<AnalysisStartInput, 'classes' | 'questionKind'>,
  datasetClasses?: readonly string[],
) => {
  const questionKind = parsedQuery?.type ?? inferQuestionKind(query, input.classes ?? datasetClasses ?? [], input.questionKind)
  const lookupClasses = questionKind === 'noul'
    ? []
    : [...(parsedQuery ? classesFromJevQuery(parsedQuery) : input.classes ?? datasetClasses ?? [])]
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
  return { questionKind, lookupClasses }
}

const reusableStatusRank = (status: AnalysisSnapshot['status']): number | undefined => {
  if (status === 'complete') return 0
  if (status === 'running') return 1
  if (status === 'queued') return 2
  return undefined
}

export class InMemoryAnalysisStore implements AnalysisStorage {
  private readonly snapshots = new Map<string, AnalysisSnapshot>()
  private readonly claims = new Map<string, { ownerToken: string; leaseExpiresAt: number }>()
  private readonly drafts = new Map<string, AnalysisDraftResult>()

  get(analysisId: string): AnalysisSnapshot | undefined {
    const snapshot = this.snapshots.get(analysisId)
    return snapshot ? cloneAnalysisSnapshot(normalizeSnapshot(snapshot)) : undefined
  }

  put(snapshot: AnalysisSnapshot): void {
    const incoming = cloneAnalysisSnapshot(normalizeSnapshot(snapshot))
    const existing = this.snapshots.get(snapshot.analysisId)
    if (existing && incoming.resultRows.length === 0 && existing.resultRows.length > 0) {
      incoming.resultRows = existing.resultRows
    } else if (existing && incoming.resultRows.length > 0) {
      let rows = [...existing.resultRows]
      for (const row of incoming.resultRows) rows = mergeResultRow(rows, row)
      incoming.resultRows = rows
    }
    this.snapshots.set(snapshot.analysisId, incoming)
  }

  findCompleteByContentKey(contentKey: string): AnalysisSnapshot | undefined {
    return this.findReusableByContentKey(contentKey, ['complete'])
  }

  claimByContentKey(contentKey: string, snapshot: AnalysisSnapshot): AnalysisSnapshot {
    const reusable = this.findReusableByContentKey(contentKey, ['complete', 'running', 'queued'])
    if (reusable) return reusable
    this.put(snapshot)
    return cloneAnalysisSnapshot(normalizeSnapshot(snapshot))
  }

  getDraftByContentKey(contentKey: string): AnalysisDraftResult | undefined {
    const draft = this.drafts.get(contentKey)
    return draft ? cloneDraftResult(draft) : undefined
  }

  putDraft(contentKey: string, draft: AnalysisDraftResult): void {
    this.drafts.set(contentKey, cloneDraftResult(draft))
  }

  getPublic(analysisId: string): AnalysisSnapshot | undefined {
    return this.get(analysisId)
  }

  claim(analysisId: string, ownerToken: string, nowMs: number, leaseMs: number): 'claimed' | 'busy' | 'complete' | 'missing' | 'error' {
    const snapshot = this.snapshots.get(analysisId)
    if (!snapshot) return 'missing'
    if (snapshot.status === 'complete') return 'complete'
    if (snapshot.status === 'error') return 'error'
    const current = this.claims.get(analysisId)
    if (current && current.leaseExpiresAt > nowMs && current.ownerToken !== ownerToken) return 'busy'
    this.claims.set(analysisId, { ownerToken, leaseExpiresAt: nowMs + leaseMs })
    return 'claimed'
  }

  release(analysisId: string, ownerToken: string): void {
    if (this.claims.get(analysisId)?.ownerToken === ownerToken) this.claims.delete(analysisId)
  }

  healStale(analysisId: string, nowMs: number): AnalysisSnapshot | undefined {
    const snapshot = this.snapshots.get(analysisId)
    if (!snapshot) return undefined
    const leaseExpiresAt = this.claims.get(analysisId)?.leaseExpiresAt
    if (!shouldHealStalledRun({ status: snapshot.status, updatedAt: snapshot.updatedAt, nowMs, leaseExpiresAt })) {
      return cloneAnalysisSnapshot(normalizeSnapshot(snapshot))
    }
    this.claims.delete(analysisId)
    const healed: AnalysisSnapshot = {
      ...snapshot,
      status: 'error',
      currentFixtureRow: undefined,
      updatedAt: new Date(nowMs).toISOString(),
      progress: {
        ...snapshot.progress,
        completedRows: consecutiveCompletedRows(snapshot.resultRows),
      },
      error: { code: ANALYSIS_RUN_STALLED_CODE, retryable: true },
    }
    this.snapshots.set(analysisId, cloneAnalysisSnapshot(normalizeSnapshot(healed)))
    return cloneAnalysisSnapshot(normalizeSnapshot(healed))
  }

  private findReusableByContentKey(contentKey: string, statuses: readonly AnalysisSnapshot['status'][]): AnalysisSnapshot | undefined {
    const allowed = new Set(statuses)
    let latest: AnalysisSnapshot | undefined
    let latestRank = Number.POSITIVE_INFINITY
    for (const snapshot of this.snapshots.values()) {
      if (!allowed.has(snapshot.status)) continue
      if (analysisContentKeyFromSnapshot(snapshot) !== contentKey) continue
      const rank = reusableStatusRank(snapshot.status)
      if (rank === undefined) continue
      if (!latest || rank < latestRank || (rank === latestRank && snapshot.updatedAt > latest.updatedAt)) {
        latest = snapshot
        latestRank = rank
      }
    }
    return latest ? cloneAnalysisSnapshot(normalizeSnapshot(latest)) : undefined
  }
}

export const fixtureAnalysisDataset = (slice: FixtureAnalysisSlice = 'win-likelihood'): ResolvedAnalysisDataset => {
  const winLikelihood = slice === 'win-likelihood'
  const rows = (winLikelihood ? getWinLikelihoodModelInput(footballFixture) : getHalftimeModelInput(footballFixture))
    .map((row) => asAnalysisRow(row))
  return {
    datasetId: FOOTBALL_FIXTURE_ID,
    fixtureId: FOOTBALL_FIXTURE_ID,
    sourceType: 'fixture',
    displayName: SAMPLE_DATASET_NAME,
    columns: [...(winLikelihood ? footballFixtureWinLikelihoodInputFields : footballFixtureModelInputFields)],
    rows,
  }
}

export const squirrelAnalysisDataset = (): ResolvedAnalysisDataset => {
  const rows = getSquirrelModelInput()
  return {
    datasetId: SQUIRREL_FIXTURE_ID,
    fixtureId: SQUIRREL_FIXTURE_ID,
    sourceType: 'fixture',
    displayName: SQUIRREL_DATASET_NAME,
    columns: [...SQUIRREL_FIXTURE_SCHEMA],
    rows,
  }
}

export class InMemoryDatasetSource implements AnalysisDatasetSource {
  private readonly datasets = new Map<string, ResolvedAnalysisDataset>()

  constructor(seed: readonly ResolvedAnalysisDataset[] = []) {
    for (const dataset of seed) this.datasets.set(dataset.datasetId, dataset)
  }

  put(dataset: ResolvedAnalysisDataset): void {
    this.datasets.set(dataset.datasetId, dataset)
  }

  get(datasetId: string): ResolvedAnalysisDataset | undefined {
    if (datasetId === FOOTBALL_FIXTURE_ID) return fixtureAnalysisDataset(fixtureAnalysisSliceFor())
    if (datasetId === SQUIRREL_FIXTURE_ID) return squirrelAnalysisDataset()
    return this.datasets.get(datasetId)
  }
}

export interface AnalysisServiceOptions {
  store: AnalysisStorage
  classifier: AnalysisClassifier
  draftProvider: AnalysisDraftProvider
  datasets?: AnalysisDatasetSource
  now?: () => number
  idFactory?: () => string
  /** Override Jev pool size (clamped 1–8). Default `ANALYSIS_CLASSIFY_CONCURRENCY`. */
  classifyConcurrency?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const validText = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !value.includes('\u0000')
const nowIso = (now: () => number): string => new Date(now()).toISOString()

const safeProviderError = (error: unknown): { code: string; retryable: boolean } => {
  if (error instanceof AnalysisError) return { code: error.code, retryable: error.retryable }
  if (isRecord(error) && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)) {
    return { code: error.code.slice(0, 64), retryable: error.retryable === true }
  }
  return { code: 'ANALYSIS_PROVIDER_ERROR', retryable: false }
}

export const normalizeClasses = (value: unknown, fallback: readonly string[] = []): string[] => {
  const source = Array.isArray(value) ? value : fallback
  const classes = [...new Set(source.map((item) => typeof item === 'string' ? item.trim() : '').filter((item) => item.length > 0 && item.length <= ANALYSIS_MAX_CLASS_LENGTH && !item.includes('\u0000')))]
  if (classes.length === 0) return []
  if (classes.length < 2 || classes.length > ANALYSIS_MAX_CLASSES) throw new AnalysisError('INVALID_CLASSES', 'Query classes must contain between 2 and 32 labels')
  return classes
}

const finiteUnit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

const normalizeChoiceClassification = (value: AnalysisClassification, classes: readonly string[]): AnalysisClassification => {
  if (typeof value.selectedClass !== 'string' || !value.selectedClass.trim()) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned an invalid classification', 502)
  }
  if (!isRecord(value.probabilities)) throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned no class probabilities', 502)
  const entries = Object.entries(value.probabilities)
  if (entries.length < 2 || entries.length > ANALYSIS_MAX_CLASSES || entries.some(([key, probability]) => !key || typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1)) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned invalid class probabilities', 502)
  }
  const total = entries.reduce((sum, [, probability]) => sum + probability, 0)
  if (Math.abs(total - 1) > 1e-6 || !Object.prototype.hasOwnProperty.call(value.probabilities, value.selectedClass)) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider class probabilities are inconsistent', 502)
  }
  if (classes.length >= 2 && !classes.includes(value.selectedClass)) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned a class outside the query', 502)
  }
  if (value.confidence !== undefined && !finiteUnit(value.confidence)) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned invalid confidence', 502)
  }
  return {
    model: value.model.trim().slice(0, 200),
    questionKind: 'choice',
    selectedClass: value.selectedClass.trim().slice(0, ANALYSIS_MAX_CLASS_LENGTH),
    probabilities: Object.fromEntries(entries.map(([key, probability]) => [key.slice(0, ANALYSIS_MAX_CLASS_LENGTH), probability])),
    ...(value.confidence === undefined ? {} : { confidence: value.confidence }),
  }
}

const normalizeClassification = (value: AnalysisClassification, classes: readonly string[], questionKind: JevQuestionKind): AnalysisClassification => {
  if (!isRecord(value) || typeof value.model !== 'string' || !value.model.trim()) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned an invalid classification', 502)
  }
  if (questionKind === 'noul') {
    const noul = typeof value.value === 'number' ? value.value : undefined
    if (!finiteUnit(noul)) throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned an invalid noul', 502)
    return { model: value.model.trim().slice(0, 200), questionKind: 'noul', value: noul }
  }
  if (questionKind === 'score') {
    const score = typeof value.value === 'number' ? value.value : undefined
    if (typeof score !== 'number' || !Number.isFinite(score)) throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned an invalid score', 502)
    if (value.confidence !== undefined && !finiteUnit(value.confidence)) {
      throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned invalid confidence', 502)
    }
    return {
      model: value.model.trim().slice(0, 200),
      questionKind: 'score',
      value: finiteUnit(score) ? score : Math.min(1, Math.max(0, score)),
      ...(value.confidence === undefined ? {} : { confidence: value.confidence }),
      ...(isRecord(value.probabilities) ? { probabilities: value.probabilities } : {}),
    }
  }
  return normalizeChoiceClassification(value, classes)
}

const resultFromClassification = (rowIndex: number, row: AnalysisRowInput, classification: AnalysisClassification): AnalysisResultRow => ({
  rowIndex,
  input: row,
  model: classification.model,
  ...(classification.questionKind ? { questionKind: classification.questionKind } : {}),
  ...(classification.selectedClass ? { selectedClass: classification.selectedClass } : {}),
  ...(classification.probabilities ? { probabilities: { ...classification.probabilities } } : {}),
  ...(classification.confidence === undefined ? {} : { confidence: classification.confidence }),
  ...(classification.value === undefined ? {} : { value: classification.value }),
})

export const consecutiveCompletedRows = (resultRows: readonly Pick<AnalysisResultRow, 'rowIndex'>[]): number => {
  const done = new Set(resultRows.map((row) => row.rowIndex))
  let count = 0
  while (done.has(count)) count += 1
  return count
}

export const pendingRowIndexes = (totalRows: number, resultRows: readonly Pick<AnalysisResultRow, 'rowIndex'>[]): number[] => {
  const done = new Set(resultRows.map((row) => row.rowIndex))
  const pending: number[] = []
  for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
    if (!done.has(rowIndex)) pending.push(rowIndex)
  }
  return pending
}

const mergeResultRow = (resultRows: readonly AnalysisResultRow[], resultRow: AnalysisResultRow): AnalysisResultRow[] => (
  [...resultRows.filter((item) => item.rowIndex !== resultRow.rowIndex), resultRow].sort((left, right) => left.rowIndex - right.rowIndex)
)

const runningProgress = (resultRows: readonly AnalysisResultRow[], totalRows: number) => ({
  completedRows: resultRows.length,
  totalRows,
  completedCalls: resultRows.length,
  totalCalls: totalRows,
})

const clampClassifyConcurrency = (value: number | undefined): number => {
  const candidate = value ?? ANALYSIS_CLASSIFY_CONCURRENCY
  if (!Number.isFinite(candidate)) return ANALYSIS_CLASSIFY_CONCURRENCY
  return Math.max(1, Math.min(8, Math.trunc(candidate)))
}

const persistError = (error: unknown): AnalysisError => {
  if (error instanceof AnalysisError) return error
  return new AnalysisError('ANALYSIS_STORAGE_ERROR', 'Could not save analysis progress', 503, true)
}

/** One in-flight snapshot put; later enqueues coalesce to the latest snapshot. Classify does not await. */
export const createSnapshotWritePipeline = (
  put: (snapshot: AnalysisSnapshot) => Promise<void> | void,
  options: { onFailed?: (error: unknown) => void } = {},
) => {
  let latest: AnalysisSnapshot | undefined
  let loop: Promise<void> | undefined
  let failed: unknown

  const runLoop = async (): Promise<void> => {
    try {
      while (latest !== undefined && failed === undefined) {
        const snapshot = latest
        latest = undefined
        await put(snapshot)
      }
    } catch (error) {
      failed = persistError(error)
      options.onFailed?.(failed)
    }
  }

  return {
    enqueue(snapshot: AnalysisSnapshot): void {
      if (failed !== undefined) return
      latest = snapshot
      loop = (loop ?? Promise.resolve()).then(runLoop)
    },
    async flush(): Promise<void> {
      await loop
      if (latest !== undefined && failed === undefined) {
        loop = runLoop()
        await loop
      }
      if (failed !== undefined) throw failed
    },
    failed(): unknown {
      return failed
    },
  }
}

const datasetDraftClasses = (dataset: ResolvedAnalysisDataset): string[] => {
  const classes = dataset.classes && dataset.classes.length >= 2 ? [...dataset.classes] : []
  return isFixturePlayerClassList(classes) ? [] : classes
}

export class AnalysisService {
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly datasets: AnalysisDatasetSource
  private readonly inFlight = new Map<string, Promise<AnalysisSnapshot>>()
  private readonly draftInFlight = new Map<string, Promise<AnalysisDraftResult>>()
  private readonly startInFlight = new Map<string, Promise<AnalysisSnapshot>>()

  constructor(private readonly options: AnalysisServiceOptions) {
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
    this.datasets = options.datasets ?? new InMemoryDatasetSource()
  }

  async draft(input: AnalysisDraftInput): Promise<AnalysisDraftResult> {
    if (!validText(input.task, ANALYSIS_MAX_TASK_LENGTH)) throw new AnalysisError('INVALID_TASK', 'Task must be non-empty and within the size limit')
    const datasetHint = resolveDatasetHint(input)
    const contentKey = draftContentKey({ datasetId: datasetHint, task: input.task })
    if (datasetHint) {
      const cached = await this.readDraftCache(contentKey)
      if (cached) return withCacheWrite(cached, 'ok')
    }
    const existingDraft = this.draftInFlight.get(contentKey)
    if (existingDraft) return existingDraft
    const pending = this.draftOnce(input, contentKey)
    this.draftInFlight.set(contentKey, pending)
    try {
      return await pending
    } finally {
      if (this.draftInFlight.get(contentKey) === pending) this.draftInFlight.delete(contentKey)
    }
  }

  async start(input: AnalysisStartInput): Promise<AnalysisSnapshot> {
    const query = this.requireQuery(input.query)
    const parsedQuery = parseJevQueryJson(query)
    const requestedAnalysisId = input.analysisId === undefined ? undefined : typeof input.analysisId === 'string' ? input.analysisId.trim() : undefined
    if (input.analysisId !== undefined && requestedAnalysisId === undefined) throw new AnalysisError('INVALID_ANALYSIS_ID', 'Analysis ID is invalid')
    const datasetHint = resolveDatasetHint(input)
    const earlyReuse = startReuseParts(query, parsedQuery, input)
    const canReuseEarly = input.forceNew !== true && (earlyReuse.questionKind !== 'choice' || earlyReuse.lookupClasses.length >= 2)
    if (datasetHint && canReuseEarly && !requestedAnalysisId) {
      const contentKey = analysisContentKey({
        datasetId: datasetHint,
        query,
        questionKind: earlyReuse.questionKind,
        classes: earlyReuse.lookupClasses,
      })
      const cached = await this.options.store.findCompleteByContentKey(contentKey)
      if (cached?.status === 'complete') return cloneAnalysisSnapshot(normalizeSnapshot(cached))
      const inFlightStart = this.startInFlight.get(contentKey)
      if (inFlightStart) return inFlightStart
    }
    const dataset = await this.requireDataset({
      ...input,
      query,
      questionKind: parsedQuery?.type ?? input.questionKind,
    })
    if (requestedAnalysisId) {
      if (!validText(requestedAnalysisId, 200)) throw new AnalysisError('INVALID_ANALYSIS_ID', 'Analysis ID is invalid')
      const existing = await this.options.store.get(requestedAnalysisId)
      if (existing) return this.resumeExisting(existing, dataset.datasetId, query, input.resume === true)
    }
    const { questionKind, lookupClasses } = startReuseParts(query, parsedQuery, input, dataset.classes)
    const canReuse = input.forceNew !== true && (questionKind !== 'choice' || lookupClasses.length >= 2)
    const contentKey = analysisContentKey({
      datasetId: dataset.datasetId,
      query,
      questionKind,
      classes: lookupClasses,
    })
    if (canReuse) {
      const cached = await this.options.store.findCompleteByContentKey(contentKey)
      if (cached?.status === 'complete') return cloneAnalysisSnapshot(normalizeSnapshot(cached))
      const inFlightStart = this.startInFlight.get(contentKey)
      if (inFlightStart) return inFlightStart
      const pending = this.createOrJoin({
        contentKey,
        dataset,
        query,
        questionKind,
        lookupClasses,
        requestedAnalysisId,
        parsedQuery,
        inputClasses: input.classes,
      })
      this.startInFlight.set(contentKey, pending)
      try {
        return await pending
      } finally {
        if (this.startInFlight.get(contentKey) === pending) this.startInFlight.delete(contentKey)
      }
    }
    return this.createQueuedSnapshot({
      dataset,
      query,
      questionKind,
      lookupClasses,
      requestedAnalysisId,
      parsedQuery,
      inputClasses: input.classes,
    })
  }

  async run(analysisId: string): Promise<AnalysisSnapshot> {
    const existingRun = this.inFlight.get(analysisId)
    if (existingRun) return existingRun
    const execution = this.execute(analysisId)
    this.inFlight.set(analysisId, execution)
    try {
      return await execution
    } finally {
      if (this.inFlight.get(analysisId) === execution) this.inFlight.delete(analysisId)
    }
  }

  async get(analysisId: string): Promise<AnalysisSnapshot> {
    const healed = await this.options.store.healStale?.(analysisId, this.now())
    const snapshot = healed ?? await this.options.store.get(analysisId)
    if (!snapshot) throw new AnalysisError('ANALYSIS_NOT_FOUND', 'Analysis was not found', 404)
    return cloneAnalysisSnapshot(normalizeSnapshot(snapshot))
  }

  async share(analysisId: string): Promise<AnalysisSnapshot> {
    const healed = await this.options.store.healStale?.(analysisId, this.now())
    const snapshot = healed ?? await (this.options.store.getPublic?.(analysisId) ?? this.options.store.get(analysisId))
    if (!snapshot) throw new AnalysisError('ANALYSIS_NOT_FOUND', 'Analysis was not found', 404)
    return cloneAnalysisSnapshot(normalizeSnapshot(snapshot))
  }

  private async draftOnce(input: AnalysisDraftInput, flightKey: string): Promise<AnalysisDraftResult> {
    const dataset = await this.requireDataset(input)
    const task = input.task.trim()
    const contentKey = draftContentKey({ datasetId: dataset.datasetId, task })
    const cached = await this.readDraftCache(contentKey)
    if (cached) return withCacheWrite(cached, 'ok')
    const datasetClasses = datasetDraftClasses(dataset)
    const questionKindHint = inferQuestionKind(task, datasetClasses)
    if (dataset.sourceType === 'fixture' && isSampleDefaultWinTask(task) && !userAskedForFixturePlayers(task)) {
      const canned = {
        fixtureId: dataset.fixtureId,
        datasetId: dataset.datasetId,
        sourceType: dataset.sourceType,
        query: stringifyJevQuery(buildJevQuery({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY })),
        metadata: {
          provider: 'openrouter',
          model: 'cached-sample-noul',
          rowCount: dataset.rows.length,
          classes: [],
          columns: [...dataset.columns],
          displayName: dataset.displayName,
          questionKind: 'noul' as const,
        },
      }
      return withCacheWrite(canned, await this.writeDraftCache(contentKey || flightKey, canned))
    }
    if (dataset.sourceType === 'fixture' && dataset.datasetId === SQUIRREL_FIXTURE_ID && isSampleDefaultEatingTask(task)) {
      const canned = {
        fixtureId: dataset.fixtureId,
        datasetId: dataset.datasetId,
        sourceType: dataset.sourceType,
        query: stringifyJevQuery(buildJevQuery({ type: 'noul', instructions: SQUIRREL_EATING_NOUL_QUERY })),
        metadata: {
          provider: 'openrouter',
          model: 'cached-sample-places',
          rowCount: dataset.rows.length,
          classes: [],
          columns: [...dataset.columns],
          displayName: dataset.displayName,
          questionKind: 'noul' as const,
        },
      }
      return withCacheWrite(canned, await this.writeDraftCache(contentKey || flightKey, canned))
    }
    const draft = await this.options.draftProvider.draft({
      fixtureId: dataset.fixtureId,
      datasetId: dataset.datasetId,
      task,
      classes: datasetClasses,
      columns: [...dataset.columns],
      sampleRows: dataset.rows.slice(0, 5).map((row) => ({ ...row })),
      sourceType: dataset.sourceType,
      questionKindHint,
    })
    if (!validText(draft.query, ANALYSIS_MAX_QUERY_LENGTH) || typeof draft.model !== 'string' || !draft.model.trim()) {
      throw new AnalysisError('MALFORMED_DRAFT', 'OpenRouter returned an invalid classifier query', 502)
    }
    const parsedDraft = parseJevQueryJson(draft.query)
    const resolved = resolveDraftedQuery({
      task,
      query: parsedDraft?.instructions ?? draft.query,
      questionKind: parsedDraft?.type ?? draft.questionKind ?? questionKindHint,
      classes: parsedDraft && parsedDraft.type !== 'noul' ? classesFromJevQuery(parsedDraft) : draft.classes,
    })
    const recovered = mergeClassLists(
      resolved.classes,
      datasetClasses,
      classesFromLabelColumns(dataset.columns, dataset.rows),
    )
    const questionKind = resolved.questionKind
    let classes: string[] = []
    if (questionKind === 'score') {
      classes = recovered.length >= 2 ? normalizeClasses(recovered) : ['Low', 'Medium', 'High']
    } else if (questionKind === 'choice') {
      if (recovered.length === 1) {
        throw new AnalysisError('INVALID_CLASSES', 'Query classes must contain between 2 and 32 labels')
      }
      if (recovered.length >= 2) classes = normalizeClasses(recovered)
    }
    const parsedCriteriaUsable = parsedDraft?.type === questionKind && (
      parsedDraft.type === 'noul' || classesFromJevQuery(parsedDraft).length >= 2
    )
    const result: AnalysisDraftResult = {
      fixtureId: dataset.fixtureId,
      datasetId: dataset.datasetId,
      sourceType: dataset.sourceType,
      query: stringifyJevQuery(buildJevQuery({
        type: questionKind,
        instructions: resolved.query,
        classes,
        criteria: parsedCriteriaUsable ? parsedDraft : undefined,
      })),
      metadata: {
        provider: 'openrouter',
        model: draft.model.trim().slice(0, 200),
        rowCount: dataset.rows.length,
        classes,
        columns: [...dataset.columns],
        displayName: dataset.displayName,
        questionKind,
        ...(dataset.sourceType === 'fixture' && fixtureAnalysisSliceFor({
          task,
          query: resolved.query,
          questionKind,
          classes,
        }) === 'halftime-eval' ? { inputHalf: 'H1' as const, labelHalf: 'H2' as const } : {}),
      },
    }
    return withCacheWrite(result, await this.writeDraftCache(contentKey, result))
  }

  private async createOrJoin(input: {
    contentKey: string
    dataset: ResolvedAnalysisDataset
    query: string
    questionKind: JevQuestionKind
    lookupClasses: readonly string[]
    requestedAnalysisId?: string
    parsedQuery: ReturnType<typeof parseJevQueryJson>
    inputClasses?: readonly string[]
  }): Promise<AnalysisSnapshot> {
    const cached = await this.options.store.findCompleteByContentKey(input.contentKey)
    if (cached?.status === 'complete') return cloneAnalysisSnapshot(normalizeSnapshot(cached))
    const snapshot = await this.createQueuedSnapshot({
      ...input,
      joinContentKey: input.contentKey,
    })
    return this.resumeExisting(snapshot, snapshot.datasetId, snapshot.query, false)
  }

  private async createQueuedSnapshot(input: {
    dataset: ResolvedAnalysisDataset
    query: string
    questionKind: JevQuestionKind
    lookupClasses: readonly string[]
    requestedAnalysisId?: string
    parsedQuery: ReturnType<typeof parseJevQueryJson>
    inputClasses?: readonly string[]
    joinContentKey?: string
  }): Promise<AnalysisSnapshot> {
    const analysisId = input.requestedAnalysisId || this.idFactory()
    if (!validText(analysisId, 200)) throw new AnalysisError('INVALID_ANALYSIS_ID', 'Analysis ID is invalid')
    const existing = await this.options.store.get(analysisId)
    if (existing) return this.resumeExisting(existing, input.dataset.datasetId, input.query, false)
    const classes = input.questionKind === 'noul' ? [] : normalizeClasses(input.parsedQuery ? classesFromJevQuery(input.parsedQuery) : input.inputClasses, input.dataset.classes ?? [])
    if (input.questionKind === 'choice' && classes.length < 2) throw new AnalysisError('INVALID_CLASSES', 'Query classes must contain between 2 and 32 labels')
    if (input.dataset.rows.length > ANALYSIS_MAX_ROWS || input.dataset.rows.length > ANALYSIS_MAX_CALLS) throw new AnalysisError('ANALYSIS_BOUNDS_EXCEEDED', 'Dataset exceeds analysis bounds', 413)
    this.options.classifier.assertConfigured?.()
    const timestamp = nowIso(this.now)
    const snapshot: AnalysisSnapshot = {
      analysisId,
      fixtureId: input.dataset.fixtureId,
      datasetId: input.dataset.datasetId,
      sourceType: input.dataset.sourceType,
      query: input.query,
      status: 'queued',
      createdAt: timestamp,
      updatedAt: timestamp,
      progress: { completedRows: 0, totalRows: input.dataset.rows.length, completedCalls: 0, totalCalls: input.dataset.rows.length },
      questionKind: input.questionKind,
      classes,
      columns: [...input.dataset.columns],
      resultRows: [],
    }
    if (input.joinContentKey) {
      const claimed = await this.options.store.claimByContentKey(input.joinContentKey, snapshot)
      return cloneAnalysisSnapshot(normalizeSnapshot(claimed))
    }
    await this.options.store.put(snapshot)
    return cloneAnalysisSnapshot(snapshot)
  }

  private async readDraftCache(contentKey: string): Promise<AnalysisDraftResult | undefined> {
    try {
      const cached = await this.options.store.getDraftByContentKey(contentKey)
      return cached ? persistableDraft(cached) : undefined
    } catch (error) {
      console.error('[analysis] draft cache read failed', { contentKey, message: cacheFailureReason(error) })
      return undefined
    }
  }

  private async writeDraftCache(contentKey: string, draft: AnalysisDraftResult): Promise<'ok' | 'skipped'> {
    try {
      await this.options.store.putDraft(contentKey, persistableDraft(draft))
      return 'ok'
    } catch (error) {
      console.error('[analysis] draft cache write failed', { contentKey, message: cacheFailureReason(error) })
      return 'skipped'
    }
  }

  private async execute(analysisId: string): Promise<AnalysisSnapshot> {
    const ownerToken = `${analysisId}:${this.idFactory()}`
    let snapshot: AnalysisSnapshot | undefined
    try {
      const claimed = await this.options.store.claim?.(analysisId, ownerToken, this.now(), ANALYSIS_RUN_LEASE_MS)
      if (claimed === 'missing') throw new AnalysisError('ANALYSIS_NOT_FOUND', 'Analysis was not found', 404)
      if (claimed === 'complete' || claimed === 'busy' || claimed === 'error') return this.get(analysisId)
      const initial = await this.options.store.get(analysisId)
      if (!initial) throw new AnalysisError('ANALYSIS_NOT_FOUND', 'Analysis was not found', 404)
      const snapshot0 = normalizeSnapshot(initial)
      if (snapshot0.status === 'complete' || snapshot0.status === 'error') return cloneAnalysisSnapshot(snapshot0)
      const dataset = await this.requireDataset({
        fixtureId: snapshot0.fixtureId,
        datasetId: snapshot0.datasetId,
        query: snapshot0.query,
        questionKind: snapshot0.questionKind,
        classes: snapshot0.classes,
      })
      const rows = dataset.rows
      const classes = snapshot0.classes
      const questionKind = inferQuestionKind(snapshot0.query, classes, snapshot0.questionKind)
      snapshot = { ...snapshot0, status: 'running', questionKind, updatedAt: nowIso(this.now), resultRows: [...snapshot0.resultRows] }
      const persistedIndexes = new Set(snapshot.resultRows.map((row) => row.rowIndex))
      const persistDelta = async (next: AnalysisSnapshot): Promise<void> => {
        const delta = next.resultRows.filter((row) => !persistedIndexes.has(row.rowIndex))
        await this.options.store.put({ ...next, resultRows: delta })
        for (const row of delta) persistedIndexes.add(row.rowIndex)
      }
      await persistDelta({ ...snapshot, resultRows: [] })
      let firstError: unknown
      let stopped = false
      const pipeline = createSnapshotWritePipeline(persistDelta, {
        onFailed: (error) => {
          stopped = true
          if (firstError === undefined) firstError = error
        },
      })
      const persistCompact = async (next: AnalysisSnapshot): Promise<void> => {
        await this.options.store.put({ ...next, resultRows: [] })
      }
      const persistFinal = async (next: AnalysisSnapshot): Promise<AnalysisSnapshot> => {
        try {
          await pipeline.flush()
        } catch (error) {
          if (next.status !== 'error') throw error
        }
        try {
          await persistDelta(next)
        } catch (error) {
          try {
            await persistCompact(next)
            return cloneAnalysisSnapshot(next)
          } catch {
            if (next.status === 'error') return cloneAnalysisSnapshot(next)
            throw persistError(error)
          }
        }
        return cloneAnalysisSnapshot(next)
      }
      const pending = pendingRowIndexes(rows.length, snapshot.resultRows)
      if (pending.length === 0) {
        snapshot = {
          ...snapshot,
          status: 'complete',
          currentFixtureRow: undefined,
          updatedAt: nowIso(this.now),
          progress: { completedRows: rows.length, totalRows: rows.length, completedCalls: rows.length, totalCalls: rows.length },
          error: undefined,
        }
        return await persistFinal(snapshot)
      }
      let resultRows = [...snapshot.resultRows]
      let cursor = 0
      let lastLeaseAt = this.now()
      const concurrency = Math.min(clampClassifyConcurrency(this.options.classifyConcurrency), pending.length)
      const refreshLease = () => {
        const now = this.now()
        if (now - lastLeaseAt < ANALYSIS_RUN_LEASE_MS / 4) return
        lastLeaseAt = now
        void Promise.resolve(this.options.store.claim?.(analysisId, ownerToken, now, ANALYSIS_RUN_LEASE_MS)).catch(() => undefined)
      }
      const applyResult = (resultRow: AnalysisResultRow) => {
        resultRows = mergeResultRow(resultRows, resultRow)
        snapshot = {
          ...snapshot!,
          status: 'running',
          currentFixtureRow: undefined,
          updatedAt: nowIso(this.now),
          progress: runningProgress(resultRows, rows.length),
          resultRows,
          error: undefined,
        }
        pipeline.enqueue(snapshot)
        refreshLease()
        const pipelineError = pipeline.failed()
        if (pipelineError !== undefined) {
          stopped = true
          if (firstError === undefined) firstError = pipelineError
        }
      }
      const worker = async () => {
        while (!stopped) {
          const next = cursor
          cursor += 1
          if (next >= pending.length) return
          const rowIndex = pending[next]
          if (typeof rowIndex !== 'number') return
          const row = rows[rowIndex]
          if (!row) continue
          try {
            const classification = normalizeClassification(await this.options.classifier.classify({
              analysisId,
              fixtureId: snapshot!.fixtureId,
              datasetId: snapshot!.datasetId,
              query: snapshot!.query,
              rowIndex,
              row,
              classes,
              questionKind,
            }), classes, questionKind)
            applyResult(resultFromClassification(rowIndex, row, classification))
          } catch (error) {
            stopped = true
            if (firstError === undefined) firstError = error
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => worker()))
      try {
        await pipeline.flush()
      } catch (error) {
        firstError = firstError ?? error
      }
      if (firstError !== undefined) {
        snapshot = {
          ...snapshot,
          status: 'error',
          currentFixtureRow: undefined,
          updatedAt: nowIso(this.now),
          progress: {
            completedRows: consecutiveCompletedRows(resultRows),
            totalRows: rows.length,
            completedCalls: resultRows.length,
            totalCalls: rows.length,
          },
          resultRows,
          error: safeProviderError(firstError),
        }
        return await persistFinal(snapshot)
      }
      snapshot = {
        ...snapshot,
        status: 'complete',
        currentFixtureRow: undefined,
        updatedAt: nowIso(this.now),
        progress: { completedRows: rows.length, totalRows: rows.length, completedCalls: rows.length, totalCalls: rows.length },
        resultRows,
        error: undefined,
      }
      return await persistFinal(snapshot)
    } catch (error) {
      if (error instanceof AnalysisError && error.code === 'ANALYSIS_NOT_FOUND') throw error
      const current = snapshot ?? await this.options.store.get(analysisId)
      if (!current || current.status === 'complete') throw persistError(error)
      if (current.status === 'error') return cloneAnalysisSnapshot(normalizeSnapshot(current))
      const failed: AnalysisSnapshot = {
        ...normalizeSnapshot(current),
        status: 'error',
        currentFixtureRow: undefined,
        updatedAt: nowIso(this.now),
        progress: {
          ...current.progress,
          completedRows: consecutiveCompletedRows(current.resultRows),
        },
        error: safeProviderError(error),
      }
      try {
        await this.options.store.put({ ...failed, resultRows: [] })
      } catch {
        // Compact status write is best-effort; GET heal still flips lease-dead runs.
      }
      return cloneAnalysisSnapshot(failed)
    } finally {
      try {
        await this.options.store.release?.(analysisId, ownerToken)
      } catch {
        // Lease expiry + GET heal recovers if release cannot persist.
      }
    }
  }

  private async resumeExisting(existing: AnalysisSnapshot, datasetId: string, query: string, resume = false): Promise<AnalysisSnapshot> {
    const normalized = normalizeSnapshot(existing)
    if (normalized.datasetId !== datasetId || normalized.query !== query) throw new AnalysisError('ANALYSIS_ID_CONFLICT', 'Analysis ID is already used for another analysis', 409)
    const stale = normalized.status === 'running' && this.now() - Date.parse(normalized.updatedAt) > ANALYSIS_STALE_AFTER_MS
    const retryableFailure = normalized.status === 'error' && (normalized.error?.retryable === true || resume)
    if (stale || retryableFailure) {
      const recovered: AnalysisSnapshot = {
        ...normalized,
        status: 'queued',
        currentFixtureRow: undefined,
        updatedAt: nowIso(this.now),
        error: undefined,
      }
      await this.options.store.put(recovered)
      return cloneAnalysisSnapshot(recovered)
    }
    return cloneAnalysisSnapshot(normalized)
  }

  private async requireDataset(input: {
    fixtureId?: string
    datasetId?: string
    task?: string
    query?: string
    questionKind?: JevQuestionKind
    classes?: readonly string[]
  }): Promise<ResolvedAnalysisDataset> {
    const datasetId = typeof input.datasetId === 'string' && input.datasetId.trim() ? input.datasetId.trim() : typeof input.fixtureId === 'string' && input.fixtureId.trim() ? input.fixtureId.trim() : ''
    if (!datasetId) throw new AnalysisError('INVALID_DATASET', 'Choose a sample dataset, upload a CSV, or paste a public CSV URL')
    if (datasetId === FOOTBALL_FIXTURE_ID || input.fixtureId === FOOTBALL_FIXTURE_ID) {
      return fixtureAnalysisDataset(fixtureAnalysisSliceFor({
        task: input.task,
        query: input.query,
        questionKind: input.questionKind,
        classes: input.classes,
      }))
    }
    if (datasetId === SQUIRREL_FIXTURE_ID || input.fixtureId === SQUIRREL_FIXTURE_ID) {
      return squirrelAnalysisDataset()
    }
    const dataset = await this.datasets.get(datasetId)
    if (!dataset) throw new AnalysisError('DATASET_NOT_FOUND', 'Dataset was not found', 404)
    if (dataset.rows.length < 1) throw new AnalysisError('CSV_EMPTY', 'The CSV has no data rows')
    return dataset
  }

  private requireQuery(query: string): string {
    if (!validText(query, ANALYSIS_MAX_QUERY_LENGTH)) throw new AnalysisError('INVALID_QUERY', 'Query must be non-empty and within the size limit')
    return query.trim()
  }
}
