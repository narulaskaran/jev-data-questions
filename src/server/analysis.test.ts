// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AnalysisMode, AnalysisPage, AnalysisStorage, AnalysisViewRow } from '../shared/analysis'
import { ANALYSIS_READ_PAGE_ROWS } from '../shared/analysis'
import type { DatasetRowValues } from '../dataset/csvTypes'
import { SAMPLE_DATASET_ID, sampleRows } from '../dataset/sampleDataset'
import { AnalysisService, MAX_CONSECUTIVE_FAILURES, RUN_LEASE_MS, type AnalysisLimitsConfig } from './analysis'
import { DatasetService } from './datasets'
import { ApiError } from './errors'
import { InMemoryAnalysisStore, InMemoryDatasetStore, InMemoryLimitsStore } from './memoryStores'
import type { ClassifyRequest, Classifier, DraftProvider, DraftRequest } from './providers'

const T0 = 1_700_000_000_000
const HOUR = 60 * 60_000
const DAY = 24 * HOUR

const baseConfig: AnalysisLimitsConfig = {
  runsDisabled: false,
  maxRowsPerRun: 5_000,
  dailyCallBudget: 1_000_000,
  runsPerHour: 100,
  draftsPerHour: 100,
  concurrency: 2,
}

const classes = [
  { name: 'Run', description: 'A designed rushing play.' },
  { name: 'Pass', description: 'A called pass play.' },
]

interface ClassifierOptions {
  mode?: AnalysisMode
  /** Runs inside classify, after the call is recorded. Throw to fail the row. */
  onClassify?: (request: ClassifyRequest) => Promise<void> | void
}

const createClassifier = (options: ClassifierOptions = {}) => {
  const calls: ClassifyRequest[] = []
  const classifier: Classifier = {
    mode: options.mode ?? 'live',
    classify: async (request) => {
      calls.push(request)
      await options.onClassify?.(request)
      const chosen = request.rowIndex % request.classes.length
      return {
        model: 'fake-jev',
        selectedClass: request.classes[chosen].name,
        probabilities: request.classes.map((_, index) => (index === chosen ? 0.7 : 0.3 / (request.classes.length - 1))),
        confidence: 0.7,
      }
    },
  }
  return { classifier, calls }
}

interface HarnessOptions extends ClassifierOptions {
  config?: Partial<AnalysisLimitsConfig>
  wrapStore?: (store: AnalysisStorage) => AnalysisStorage
  /** Milliseconds the injected clock advances on every classify call. */
  tick?: number
  withLimits?: boolean
  draftProvider?: DraftProvider
}

const createHarness = (options: HarnessOptions = {}) => {
  let clock = T0
  const now = () => clock
  const advance = (ms: number) => { clock += ms }
  const analyses = new InMemoryAnalysisStore(now)
  const datasetStore = new InMemoryDatasetStore(now)
  const limits = new InMemoryLimitsStore(now)
  const datasets = new DatasetService({ store: datasetStore, now })
  const { classifier, calls } = createClassifier({
    mode: options.mode,
    onClassify: async (request) => {
      if (options.tick) advance(options.tick)
      await options.onClassify?.(request)
    },
  })
  const store = options.wrapStore ? options.wrapStore(analyses) : analyses
  const service = new AnalysisService({
    store,
    limits: options.withLimits === false ? undefined : limits,
    datasets,
    classifier,
    draftProvider: options.draftProvider,
    config: { ...baseConfig, ...options.config },
    now,
  })
  return { now, advance, analyses, store, datasetStore, limits, datasets, classifier, calls, service }
}

type Harness = ReturnType<typeof createHarness>

const putDataset = async (harness: Harness, datasetId: string, columnNames: string[], rows: DatasetRowValues[]): Promise<void> => {
  await harness.datasetStore.put({
    datasetId,
    sourceType: 'upload',
    displayName: datasetId,
    byteSize: 0,
    contentHash: 'test',
    delimiter: ',',
    columns: columnNames.map((name) => ({ name, inferredType: 'string' as const })),
    acceptedRowCount: rows.length,
    previewRows: rows.slice(0, 8),
    validationWarnings: [],
    createdAt: T0,
  }, rows)
}

const startSample = (harness: Harness, overrides: Partial<{ labelColumn: string | undefined; clientKey: string }> = {}) => (
  harness.service.start({
    datasetId: SAMPLE_DATASET_ID,
    query: 'Run or pass?',
    classes,
    ...('labelColumn' in overrides ? { labelColumn: overrides.labelColumn } : { labelColumn: 'play_call' }),
  }, overrides.clientKey ?? 'client-1')
)

const runToEnd = async (harness: Harness, analysisId: string, budgetMs = 60_000, runOptions: { resumeErrors?: boolean } = {}) => {
  const outcomes: string[] = []
  for (let guard = 0; guard < 10_000; guard += 1) {
    const outcome = await harness.service.runChunk(analysisId, budgetMs, runOptions)
    outcomes.push(outcome)
    if (outcome !== 'continue') return outcomes
  }
  throw new Error('run never finished')
}

const readAll = async (harness: Harness, analysisId: string): Promise<{ rows: AnalysisViewRow[]; pages: AnalysisPage[] }> => {
  const rows: AnalysisViewRow[] = []
  const pages: AnalysisPage[] = []
  let after = -1
  for (let guard = 0; guard < 10_000; guard += 1) {
    const page = await harness.service.read(analysisId, after)
    pages.push(page)
    rows.push(...page.rows)
    after = page.nextAfter
    if (!page.hasMore) return { rows, pages }
  }
  throw new Error('read never reached the end')
}

const rejection = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('expected a rejection')
}

describe('AnalysisService.start', () => {
  it('returns a control token whose hash, not the token, is stored; public meta hides the hash', async () => {
    const harness = createHarness()
    const result = await startSample(harness)
    expect(result.controlToken).toMatch(/^[0-9a-f]{48}$/)
    const stored = await harness.analyses.getRecord(result.analysis.analysisId)
    expect(stored?.controlTokenHash).toBe(createHash('sha256').update(result.controlToken).digest('hex'))
    expect(JSON.stringify(stored)).not.toContain(result.controlToken)
    expect(result.analysis).not.toHaveProperty('controlTokenHash')
    expect(JSON.stringify(result.analysis)).not.toContain(stored!.controlTokenHash)
    expect(result.analysis).toMatchObject({
      status: 'queued',
      mode: 'live',
      datasetId: SAMPLE_DATASET_ID,
      labelColumn: 'play_call',
      progress: { totalRows: 71, completedRows: 0, failedRows: 0 },
    })
    expect(result.analysis.columns).toEqual(['quarter', 'clock', 'down', 'yards_to_go', 'yards_to_end_zone', 'score_margin', 'play_call'])
  })

  it('issues a different token for every run', async () => {
    const harness = createHarness()
    const first = await startSample(harness)
    const second = await startSample(harness)
    expect(first.controlToken).not.toBe(second.controlToken)
    expect(first.analysis.analysisId).not.toBe(second.analysis.analysisId)
  })

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['too long', 'x'.repeat(4_001)],
    ['non-string', 42],
    ['missing', undefined],
    ['NUL byte', 'a\u0000b'],
  ])('rejects a bad query (%s)', async (_label, query) => {
    const harness = createHarness()
    const error = await rejection(harness.service.start({ datasetId: SAMPLE_DATASET_ID, query: query as string, classes }, 'c'))
    expect(error.code).toBe('INVALID_QUERY')
    expect(error.statusCode).toBe(400)
    expect(await harness.analyses.listRecent(10)).toEqual([])
  })

  it('accepts a query of exactly 4,000 characters', async () => {
    const harness = createHarness()
    await expect(harness.service.start({ datasetId: SAMPLE_DATASET_ID, query: 'x'.repeat(4_000), classes }, 'c')).resolves.toBeDefined()
  })

  it.each([
    ['one class', [{ name: 'Only', description: '' }]],
    ['no classes', []],
    ['33 classes', Array.from({ length: 33 }, (_, index) => ({ name: `c${index}`, description: '' }))],
    ['duplicates that collapse below two', [{ name: 'Run', description: '' }, { name: ' run ', description: '' }]],
    ['non-array', { name: 'a' }],
    ['undefined', undefined],
    ['blank names', [{ name: '  ', description: '' }, { name: '', description: '' }]],
  ])('rejects bad classes (%s)', async (_label, badClasses) => {
    const harness = createHarness()
    const error = await rejection(harness.service.start({ datasetId: SAMPLE_DATASET_ID, query: 'q', classes: badClasses as never }, 'c'))
    expect(error.code).toBe('INVALID_CLASSES')
  })

  it('accepts exactly 32 classes and collapses duplicates and plain strings', async () => {
    const harness = createHarness()
    const many = Array.from({ length: 32 }, (_, index) => `class ${index}`)
    const big = await harness.service.start({ datasetId: SAMPLE_DATASET_ID, query: 'q', classes: many as never }, 'c')
    expect(big.analysis.classes).toHaveLength(32)
    const collapsed = await harness.service.start({ datasetId: SAMPLE_DATASET_ID, query: 'q', classes: ['A', 'a', ' B  ', 'b'] as never }, 'c')
    expect(collapsed.analysis.classes.map((item) => item.name)).toEqual(['A', 'B'])
  })

  it('rejects an unknown dataset with 404 and a non-string dataset id with INVALID_DATASET', async () => {
    const harness = createHarness()
    const missing = await rejection(harness.service.start({ datasetId: 'nope', query: 'q', classes }, 'c'))
    expect(missing).toMatchObject({ code: 'DATASET_NOT_FOUND', statusCode: 404 })
    const invalid = await rejection(harness.service.start({ datasetId: 7 as never, query: 'q', classes }, 'c'))
    expect(invalid.code).toBe('INVALID_DATASET')
  })

  it('rejects an unknown label column, and a dataset with no other column to read', async () => {
    const harness = createHarness()
    const unknown = await rejection(harness.service.start({ datasetId: SAMPLE_DATASET_ID, query: 'q', classes, labelColumn: 'nope' }, 'c'))
    expect(unknown.code).toBe('INVALID_LABEL_COLUMN')
    await putDataset(harness, 'single', ['only'], [['a'], ['b']])
    const lonely = await rejection(harness.service.start({ datasetId: 'single', query: 'q', classes, labelColumn: 'only' }, 'c'))
    expect(lonely.code).toBe('INVALID_LABEL_COLUMN')
  })

  it('treats an empty label column as "no held-out column"', async () => {
    const harness = createHarness()
    const result = await harness.service.start({ datasetId: SAMPLE_DATASET_ID, query: 'q', classes, labelColumn: '' }, 'c')
    expect(result.analysis.labelColumn).toBeUndefined()
  })

  it('rejects a dataset larger than maxRowsPerRun with RUN_TOO_LARGE 413 and creates nothing', async () => {
    const harness = createHarness({ config: { maxRowsPerRun: 70 } })
    const error = await rejection(startSample(harness))
    expect(error).toMatchObject({ code: 'RUN_TOO_LARGE', statusCode: 413 })
    expect(await harness.analyses.listRecent(10)).toEqual([])
    const exact = createHarness({ config: { maxRowsPerRun: 71 } })
    await expect(startSample(exact)).resolves.toBeDefined()
  })

  it('rejects an empty dataset', async () => {
    const harness = createHarness()
    await putDataset(harness, 'empty', ['a', 'b'], [])
    const error = await rejection(harness.service.start({ datasetId: 'empty', query: 'q', classes }, 'c'))
    expect(error.code).toBe('INVALID_DATASET')
  })

  it('fails closed when runs are disabled (503), before touching limits or storage', async () => {
    const harness = createHarness({ config: { runsDisabled: true } })
    const error = await rejection(startSample(harness))
    expect(error).toMatchObject({ code: 'RUNS_DISABLED', statusCode: 503 })
    expect(await harness.analyses.listRecent(10)).toEqual([])
  })

  it('fails closed with no classifier (JEV_NOT_CONFIGURED 503)', async () => {
    const datasets = new DatasetService({})
    const service = new AnalysisService({ store: new InMemoryAnalysisStore(), datasets, config: baseConfig })
    const error = await rejection(service.start({ datasetId: SAMPLE_DATASET_ID, query: 'q', classes }, 'c'))
    expect(error).toMatchObject({ code: 'JEV_NOT_CONFIGURED', statusCode: 503 })
  })

  it('fails closed with no store (STORAGE_NOT_CONFIGURED 503) and never runs anything', async () => {
    const { classifier, calls } = createClassifier()
    const service = new AnalysisService({ datasets: new DatasetService({}), classifier, config: baseConfig })
    const error = await rejection(service.start({ datasetId: SAMPLE_DATASET_ID, query: 'q', classes }, 'c'))
    expect(error).toMatchObject({ code: 'STORAGE_NOT_CONFIGURED', statusCode: 503 })
    expect(await rejection(service.read('anything'))).toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' })
    expect(await rejection(service.runChunk('anything', 1_000))).toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' })
    expect(await service.listRecent(5)).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('AnalysisService rate limit and budget', () => {
  it('rate limits the (runsPerHour + 1)-th start per client, per window', async () => {
    const harness = createHarness({ config: { runsPerHour: 3 } })
    for (let index = 0; index < 3; index += 1) await startSample(harness, { clientKey: 'same' })
    harness.advance(10 * 60_000)
    const error = await rejection(startSample(harness, { clientKey: 'same' }))
    expect(error).toMatchObject({ code: 'RATE_LIMITED', statusCode: 429, retryable: true })
    expect(error.retryAfterMs).toBe(HOUR - 10 * 60_000)
    expect(await harness.analyses.listRecent(10)).toHaveLength(3)

    await expect(startSample(harness, { clientKey: 'someone-else' })).resolves.toBeDefined()

    harness.advance(HOUR - 10 * 60_000)
    await expect(startSample(harness, { clientKey: 'same' })).resolves.toBeDefined()
  })

  it('does not spend rate-limit units on requests that fail validation', async () => {
    const harness = createHarness({ config: { runsPerHour: 1 } })
    await rejection(harness.service.start({ datasetId: SAMPLE_DATASET_ID, query: '', classes }, 'c'))
    await expect(startSample(harness, { clientKey: 'c' })).resolves.toBeDefined()
  })

  it('reserves acceptedRowCount live calls and refuses a run that would exceed the daily budget', async () => {
    const harness = createHarness({ config: { dailyCallBudget: 100 } })
    await startSample(harness)
    const error = await rejection(startSample(harness))
    expect(error).toMatchObject({ code: 'DAILY_BUDGET_EXHAUSTED', statusCode: 429, retryable: true })
    expect(await harness.analyses.listRecent(10)).toHaveLength(1)
    // The refused run did not consume budget, so the remaining 29 calls still fit a small run.
    await putDataset(harness, 'small', ['a', 'b'], Array.from({ length: 29 }, (_, index) => [index, 'x']))
    await expect(harness.service.start({ datasetId: 'small', query: 'q', classes }, 'c')).resolves.toBeDefined()
  })

  it('resets the budget on the next UTC day', async () => {
    const harness = createHarness({ config: { dailyCallBudget: 71 } })
    await startSample(harness)
    await rejection(startSample(harness))
    harness.advance(DAY)
    await expect(startSample(harness)).resolves.toBeDefined()
  })

  it('never charges the budget for a mock-mode classifier', async () => {
    const harness = createHarness({ mode: 'mock', config: { dailyCallBudget: 0 } })
    for (let index = 0; index < 3; index += 1) await startSample(harness)
    const live = createHarness({ mode: 'live', config: { dailyCallBudget: 0 } })
    expect((await rejection(startSample(live))).code).toBe('DAILY_BUDGET_EXHAUSTED')
  })
})

describe('AnalysisService.runChunk', () => {
  it('completes the sample: 71 contiguous rows, progress matches', async () => {
    const harness = createHarness()
    const { analysis } = await startSample(harness)
    expect(await runToEnd(harness, analysis.analysisId)).toEqual(['complete'])
    const { rows, pages } = await readAll(harness, analysis.analysisId)
    expect(rows).toHaveLength(71)
    expect(rows.map((row) => row.rowIndex)).toEqual(Array.from({ length: 71 }, (_, index) => index))
    const meta = pages[pages.length - 1].analysis
    expect(meta.status).toBe('complete')
    expect(meta.progress).toEqual({ totalRows: 71, completedRows: 71, failedRows: 0 })
    expect(meta.startedAt).toBeDefined()
    expect(meta.completedAt).toBeDefined()
    for (const row of rows) {
      expect(['Run', 'Pass']).toContain(row.selectedClass)
      expect(row.probabilities).toHaveLength(2)
      expect(row.error).toBeUndefined()
    }
  })

  it('never sends the held-out column to the classifier', async () => {
    const harness = createHarness()
    const { analysis } = await startSample(harness)
    await runToEnd(harness, analysis.analysisId)
    expect(harness.calls).toHaveLength(71)
    const expectedKeys = ['quarter', 'clock', 'down', 'yards_to_go', 'yards_to_end_zone', 'score_margin']
    const source = sampleRows()
    for (const call of harness.calls) {
      expect(call.input).not.toHaveProperty('play_call')
      expect(Object.keys(call.input)).toEqual(expectedKeys)
      expect(call.input.quarter).toBe(source[call.rowIndex][0])
      expect(call.input.score_margin).toBe(source[call.rowIndex][5])
      expect(call.analysisId).toBe(analysis.analysisId)
      expect(call.query).toBe('Run or pass?')
    }
  })

  it('keeps values aligned when the held-out column is in the middle', async () => {
    const harness = createHarness()
    await putDataset(harness, 'mid', ['a', 'label', 'b'], [[1, 'secret-1', 'x'], [2, 'secret-2', 'y'], [3, 'secret-3', 'z']])
    const { analysis } = await harness.service.start({ datasetId: 'mid', query: 'q', classes, labelColumn: 'label' }, 'c')
    await runToEnd(harness, analysis.analysisId)
    expect(harness.calls.map((call) => call.input)).toEqual([{ a: 1, b: 'x' }, { a: 2, b: 'y' }, { a: 3, b: 'z' }])
    expect(JSON.stringify(harness.calls)).not.toContain('secret')
  })

  it('sends every column when there is no held-out column', async () => {
    const harness = createHarness()
    const { analysis } = await startSample(harness, { labelColumn: undefined })
    await runToEnd(harness, analysis.analysisId)
    expect(Object.keys(harness.calls[0].input)).toHaveLength(7)
    expect(harness.calls[0].input.play_call).toBe('Run')
  })

  it('classifies each row exactly once across a long multi-chunk run', async () => {
    const harness = createHarness({ tick: 1, config: { concurrency: 3 } })
    const { analysis } = await startSample(harness)
    const outcomes = await runToEnd(harness, analysis.analysisId, 1)
    expect(outcomes.filter((outcome) => outcome === 'continue').length).toBeGreaterThan(5)
    expect(outcomes[outcomes.length - 1]).toBe('complete')
    const indexes = harness.calls.map((call) => call.rowIndex)
    expect(new Set(indexes).size).toBe(indexes.length)
    expect(harness.calls).toHaveLength(71)
    expect([...indexes].sort((a, b) => a - b)).toEqual(Array.from({ length: 71 }, (_, index) => index))
    const { rows } = await readAll(harness, analysis.analysisId)
    expect(rows.map((row) => row.rowIndex)).toEqual(Array.from({ length: 71 }, (_, index) => index))
  })

  it('records latency from the injected clock', async () => {
    const harness = createHarness({ tick: 5, config: { concurrency: 1 } })
    const { analysis } = await startSample(harness)
    await runToEnd(harness, analysis.analysisId)
    const { rows } = await readAll(harness, analysis.analysisId)
    expect(rows[0].latencyMs).toBe(5)
  })

  it('yields a run that is still "running" with no lease, so a continuation can claim it', async () => {
    const harness = createHarness({ tick: 1 })
    const { analysis } = await startSample(harness)
    expect(await harness.service.runChunk(analysis.analysisId, 1)).toBe('continue')
    const record = await harness.analyses.getRecord(analysis.analysisId)
    expect(record?.status).toBe('running')
    expect(record?.progress.completedRows).toBe(2)
    expect(await harness.analyses.claim(analysis.analysisId, 'someone', RUN_LEASE_MS)).toBe('claimed')
  })

  it('does nothing for an unknown run, a finished run, or a service without a classifier', async () => {
    const harness = createHarness()
    expect(await harness.service.runChunk('missing', 1_000)).toBe('stopped')
    const { analysis } = await startSample(harness)
    await runToEnd(harness, analysis.analysisId)
    const callsAfterRun = harness.calls.length
    expect(await harness.service.runChunk(analysis.analysisId, 1_000)).toBe('stopped')
    expect(await harness.service.runChunk(analysis.analysisId, 1_000, { resumeErrors: true })).toBe('stopped')
    expect(harness.calls).toHaveLength(callsAfterRun)

    const bare = new AnalysisService({ store: harness.analyses, datasets: harness.datasets, config: baseConfig, now: harness.now })
    const fresh = await startSample(harness)
    expect(await bare.runChunk(fresh.analysis.analysisId, 1_000)).toBe('stopped')
  })

  describe('per-row failures', () => {
    it('keeps going when a few scattered rows fail, and stores their errors', async () => {
      const failing = new Map<number, Error>([
        [3, new ApiError('JEV_429', 'slow down', 502, { retryable: true })],
        [17, new Error('boom with sk_live_SECRET')],
        [40, new ApiError('JEV_400', 'bad', 502)],
      ])
      const harness = createHarness({
        onClassify: (request) => {
          const error = failing.get(request.rowIndex)
          if (error) throw error
        },
      })
      const { analysis } = await startSample(harness)
      expect(await runToEnd(harness, analysis.analysisId)).toEqual(['complete'])
      const { rows, pages } = await readAll(harness, analysis.analysisId)
      const meta = pages[pages.length - 1].analysis
      expect(meta.status).toBe('complete')
      expect(meta.progress).toEqual({ totalRows: 71, completedRows: 71, failedRows: 3 })
      expect(rows.filter((row) => row.error).map((row) => row.rowIndex)).toEqual([3, 17, 40])
      expect(rows[3].error).toEqual({ code: 'JEV_429', retryable: true })
      expect(rows[17].error).toEqual({ code: 'CLASSIFIER_ERROR', retryable: false })
      expect(rows[40].error).toEqual({ code: 'JEV_400', retryable: false })
      expect(JSON.stringify(rows)).not.toContain('SECRET')
      for (const row of rows) {
        if (row.error) expect(row.selectedClass).toBeUndefined()
        else expect(row.selectedClass).toBeDefined()
      }
    })

    it('does not trip the circuit breaker when successes interrupt the failure streaks', async () => {
      const failing = new Set([0, 1, 2, 3, 5, 6, 7, 8])
      const harness = createHarness({
        config: { concurrency: 1 },
        onClassify: (request) => {
          if (failing.has(request.rowIndex)) throw new Error('flaky')
        },
      })
      const { analysis } = await startSample(harness)
      expect(MAX_CONSECUTIVE_FAILURES).toBe(5)
      expect(await runToEnd(harness, analysis.analysisId)).toEqual(['complete'])
      expect((await harness.analyses.getRecord(analysis.analysisId))?.progress).toEqual({ totalRows: 71, completedRows: 71, failedRows: 8 })
    })
  })

  describe('circuit breaker', () => {
    it('stops with status error after MAX_CONSECUTIVE_FAILURES rows, keeping the failures', async () => {
      const harness = createHarness({
        config: { concurrency: 1 },
        onClassify: () => { throw new ApiError('JEV_503', 'down', 502, { retryable: true }) },
      })
      const { analysis } = await startSample(harness)
      expect(await runToEnd(harness, analysis.analysisId)).toEqual(['stopped'])
      expect(harness.calls).toHaveLength(MAX_CONSECUTIVE_FAILURES)
      const record = await harness.analyses.getRecord(analysis.analysisId)
      expect(record?.status).toBe('error')
      expect(record?.error).toEqual({ code: 'JEV_503', retryable: true })
      expect(record?.progress).toEqual({ totalRows: 71, completedRows: MAX_CONSECUTIVE_FAILURES, failedRows: MAX_CONSECUTIVE_FAILURES })
      const { rows } = await readAll(harness, analysis.analysisId)
      expect(rows.every((row) => row.error?.code === 'JEV_503')).toBe(true)
    })

    it('stops within one batch of the threshold when rows run concurrently', async () => {
      const harness = createHarness({
        config: { concurrency: 4 },
        onClassify: () => { throw new Error('down') },
      })
      const { analysis } = await startSample(harness)
      expect(await runToEnd(harness, analysis.analysisId)).toEqual(['stopped'])
      expect(harness.calls.length).toBeGreaterThanOrEqual(MAX_CONSECUTIVE_FAILURES)
      expect(harness.calls.length).toBeLessThan(MAX_CONSECUTIVE_FAILURES + 4)
      const record = await harness.analyses.getRecord(analysis.analysisId)
      expect(record?.status).toBe('error')
      expect(record?.error?.code).toBe('CLASSIFIER_ERROR')
    })
  })

  describe('errored runs', () => {
    const failFirstRows = (count: number) => {
      let healthy = false
      return {
        heal: () => { healthy = true },
        onClassify: (request: ClassifyRequest) => {
          if (!healthy && request.rowIndex < count) throw new ApiError('JEV_503', 'down', 502, { retryable: true })
        },
      }
    }

    it('is not restarted by a plain chunk, but is by an explicit resume, from the next unprocessed row', async () => {
      const failures = failFirstRows(MAX_CONSECUTIVE_FAILURES)
      const harness = createHarness({ config: { concurrency: 1 }, onClassify: failures.onClassify })
      const { analysis } = await startSample(harness)
      await runToEnd(harness, analysis.analysisId)
      expect((await harness.analyses.getRecord(analysis.analysisId))?.status).toBe('error')
      const callsAtStop = harness.calls.length

      expect(await harness.service.runChunk(analysis.analysisId, 60_000)).toBe('stopped')
      expect(harness.calls).toHaveLength(callsAtStop)
      expect((await harness.analyses.getRecord(analysis.analysisId))?.status).toBe('error')

      failures.heal()
      expect(await runToEnd(harness, analysis.analysisId, 60_000, { resumeErrors: true })).toEqual(['complete'])
      expect(harness.calls[callsAtStop].rowIndex).toBe(MAX_CONSECUTIVE_FAILURES)
      expect(harness.calls).toHaveLength(71)
      const record = await harness.analyses.getRecord(analysis.analysisId)
      expect(record?.status).toBe('complete')
      expect(record?.error).toBeUndefined()
      expect(record?.progress).toEqual({ totalRows: 71, completedRows: 71, failedRows: MAX_CONSECUTIVE_FAILURES })
    })

    it('can be resumed through authorizeResume (the creator path)', async () => {
      const failures = failFirstRows(MAX_CONSECUTIVE_FAILURES)
      const harness = createHarness({ config: { concurrency: 1 }, onClassify: failures.onClassify })
      const { analysis, controlToken } = await startSample(harness)
      await runToEnd(harness, analysis.analysisId)
      const record = await harness.service.authorizeResume(analysis.analysisId, controlToken)
      expect(record.status).toBe('error')
      failures.heal()
      expect(await harness.service.runChunk(record.analysisId, 60_000, { resumeErrors: true })).toBe('complete')
    })
  })

  describe('cancel and resume authorization', () => {
    it('rejects a wrong or missing token with NOT_RUN_OWNER and an unknown run with 404', async () => {
      const harness = createHarness()
      const { analysis, controlToken } = await startSample(harness)
      for (const bad of ['wrong', '', undefined, 123, controlToken.slice(1)]) {
        expect(await rejection(harness.service.cancel(analysis.analysisId, bad))).toMatchObject({ code: 'NOT_RUN_OWNER', statusCode: 403 })
        expect(await rejection(harness.service.authorizeResume(analysis.analysisId, bad))).toMatchObject({ code: 'NOT_RUN_OWNER', statusCode: 403 })
      }
      expect((await harness.analyses.getRecord(analysis.analysisId))?.status).toBe('queued')
      expect(await rejection(harness.service.cancel('missing', controlToken))).toMatchObject({ code: 'ANALYSIS_NOT_FOUND', statusCode: 404 })
      expect(await rejection(harness.service.authorizeResume(undefined, controlToken))).toMatchObject({ code: 'ANALYSIS_NOT_FOUND', statusCode: 404 })
    })

    it('rejects another run\'s token', async () => {
      const harness = createHarness()
      const first = await startSample(harness)
      const second = await startSample(harness)
      expect((await rejection(harness.service.cancel(first.analysis.analysisId, second.controlToken))).code).toBe('NOT_RUN_OWNER')
    })

    it('cancels with the right token, and a finished run can no longer be resumed', async () => {
      const harness = createHarness()
      const { analysis, controlToken } = await startSample(harness)
      await harness.service.cancel(analysis.analysisId, controlToken)
      expect((await harness.analyses.getRecord(analysis.analysisId))?.status).toBe('cancelled')
      expect(await rejection(harness.service.authorizeResume(analysis.analysisId, controlToken))).toMatchObject({ code: 'RUN_FINISHED', statusCode: 409 })
      expect(await harness.service.runChunk(analysis.analysisId, 60_000)).toBe('stopped')
      expect(harness.calls).toHaveLength(0)
    })

    it('rejects resuming a complete run with RUN_FINISHED', async () => {
      const harness = createHarness()
      const { analysis, controlToken } = await startSample(harness)
      await runToEnd(harness, analysis.analysisId)
      expect(await rejection(harness.service.authorizeResume(analysis.analysisId, controlToken))).toMatchObject({ code: 'RUN_FINISHED', statusCode: 409 })
      // Cancelling a finished run is a harmless no-op that must not change its status.
      await harness.service.cancel(analysis.analysisId, controlToken)
      expect((await harness.analyses.getRecord(analysis.analysisId))?.status).toBe('complete')
    })

    it('refuses to resume while runs are disabled', async () => {
      const harness = createHarness()
      const { analysis, controlToken } = await startSample(harness)
      const paused = new AnalysisService({
        store: harness.analyses,
        datasets: harness.datasets,
        classifier: harness.classifier,
        config: { ...baseConfig, runsDisabled: true },
        now: harness.now,
      })
      expect(await rejection(paused.authorizeResume(analysis.analysisId, controlToken))).toMatchObject({ code: 'RUNS_DISABLED', statusCode: 503 })
    })

    it('stops a worker mid-run at its next append and stores nothing further', async () => {
      let cancelNow: (() => Promise<void>) | undefined
      const harness = createHarness({
        config: { concurrency: 1 },
        onClassify: async (request) => {
          if (request.rowIndex === 10) await cancelNow?.()
        },
      })
      const { analysis, controlToken } = await startSample(harness)
      cancelNow = () => harness.service.cancel(analysis.analysisId, controlToken)
      expect(await harness.service.runChunk(analysis.analysisId, 60_000)).toBe('stopped')
      expect(harness.calls).toHaveLength(11)
      const record = await harness.analyses.getRecord(analysis.analysisId)
      expect(record?.status).toBe('cancelled')
      expect(record?.progress.completedRows).toBe(10)
      const page = await harness.service.read(analysis.analysisId)
      expect(page.rows.map((row) => row.rowIndex)).toEqual(Array.from({ length: 10 }, (_, index) => index))
      expect(page.analysis.status).toBe('cancelled')
    })
  })

  describe('lease', () => {
    it('makes a concurrent runChunk for the same analysis stop without classifying anything', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => { release = resolve })
      const harness = createHarness({ config: { concurrency: 1 }, onClassify: () => gate })
      const { analysis } = await startSample(harness)
      const first = harness.service.runChunk(analysis.analysisId, 60_000)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(harness.calls).toHaveLength(1)

      expect(await harness.service.runChunk(analysis.analysisId, 60_000)).toBe('stopped')
      expect(await harness.service.runChunk(analysis.analysisId, 60_000, { resumeErrors: true })).toBe('stopped')
      expect(harness.calls).toHaveLength(1)

      release()
      expect(await first).toBe('complete')
      expect(harness.calls).toHaveLength(71)
    })

    it('lets another worker take over once an abandoned lease expires', async () => {
      const harness = createHarness({
        config: { concurrency: 1 },
        // Every store write fails, so the dying worker cannot even release its lease.
        wrapStore: (inner) => ({
          create: (record) => inner.create(record),
          getRecord: (id) => inner.getRecord(id),
          readPage: (id, after, limit) => inner.readPage(id, after, limit),
          claim: (id, owner, lease) => inner.claim(id, owner, lease),
          append: () => Promise.reject(new Error('store down')),
          finish: () => Promise.reject(new Error('store down')),
          cancel: (id) => inner.cancel(id),
          listRecent: (limit) => inner.listRecent(limit),
        }),
      })
      const { analysis } = await startSample(harness)
      expect(await harness.service.runChunk(analysis.analysisId, 60_000)).toBe('stopped')
      expect((await harness.analyses.getRecord(analysis.analysisId))?.status).toBe('running')
      expect(await harness.analyses.claim(analysis.analysisId, 'rival', RUN_LEASE_MS)).toBe('busy')
      harness.advance(RUN_LEASE_MS + 1)
      expect(await harness.analyses.claim(analysis.analysisId, 'rival', RUN_LEASE_MS)).toBe('claimed')
    })
  })

  describe('storage failure mid-run', () => {
    const flakyAppend = (failOnCall: number) => {
      let appendCalls = 0
      return (inner: AnalysisStorage): AnalysisStorage => ({
        create: (record) => inner.create(record),
        getRecord: (id) => inner.getRecord(id),
        readPage: (id, after, limit) => inner.readPage(id, after, limit),
        claim: (id, owner, lease) => inner.claim(id, owner, lease),
        append: (id, owner, rows, lease) => {
          appendCalls += 1
          if (appendCalls === failOnCall) return Promise.reject(new Error('convex exploded: sk_live_SECRET'))
          return inner.append(id, owner, rows, lease)
        },
        finish: (id, owner, outcome) => inner.finish(id, owner, outcome),
        cancel: (id) => inner.cancel(id),
        listRecent: (limit) => inner.listRecent(limit),
      })
    }

    it('ends the chunk as RUN_INTERRUPTED (retryable) instead of leaving a stuck running run', async () => {
      const harness = createHarness({ config: { concurrency: 2 }, wrapStore: flakyAppend(4) })
      const { analysis } = await startSample(harness)
      expect(await harness.service.runChunk(analysis.analysisId, 60_000)).toBe('stopped')
      const record = await harness.analyses.getRecord(analysis.analysisId)
      expect(record?.status).toBe('error')
      expect(record?.error).toEqual({ code: 'RUN_INTERRUPTED', retryable: true })
      expect(record?.progress.completedRows).toBe(6)
      expect(JSON.stringify(record)).not.toContain('SECRET')
      // The lease was released: a different owner can claim straight away.
      expect(await harness.analyses.claim(analysis.analysisId, 'other-worker', RUN_LEASE_MS)).toBe('claimed')
    })

    it('can be resumed to completion with every row stored exactly once', async () => {
      const harness = createHarness({ config: { concurrency: 2 }, wrapStore: flakyAppend(4) })
      const { analysis, controlToken } = await startSample(harness)
      expect(await harness.service.runChunk(analysis.analysisId, 60_000)).toBe('stopped')
      // A plain continuation must not restart an errored run...
      expect(await harness.service.runChunk(analysis.analysisId, 60_000)).toBe('stopped')
      // ...but the creator's resume does.
      await harness.service.authorizeResume(analysis.analysisId, controlToken)
      expect(await runToEnd(harness, analysis.analysisId, 60_000, { resumeErrors: true })).toEqual(['complete'])
      const { rows, pages } = await readAll(harness, analysis.analysisId)
      expect(rows.map((row) => row.rowIndex)).toEqual(Array.from({ length: 71 }, (_, index) => index))
      expect(pages[pages.length - 1].analysis.status).toBe('complete')
      expect(pages[pages.length - 1].analysis.progress).toEqual({ totalRows: 71, completedRows: 71, failedRows: 0 })
      expect(pages[pages.length - 1].analysis.error).toBeUndefined()
    })
  })
})

describe('AnalysisService.read', () => {
  const bigRows = (count: number): DatasetRowValues[] => Array.from({ length: count }, (_, index) => [index, `name-${index}`, index % 2 === 0 ? 'even' : 'odd'])

  it('walks every row exactly once, in order, across pages', async () => {
    const harness = createHarness({ config: { concurrency: 8 } })
    await putDataset(harness, 'big', ['n', 'name', 'parity'], bigRows(1_200))
    const { analysis } = await harness.service.start({ datasetId: 'big', query: 'q', classes, labelColumn: 'parity' }, 'c')
    await runToEnd(harness, analysis.analysisId)

    const first = await harness.service.read(analysis.analysisId, -1)
    expect(first.rows).toHaveLength(ANALYSIS_READ_PAGE_ROWS)
    expect(first.hasMore).toBe(true)
    expect(first.nextAfter).toBe(ANALYSIS_READ_PAGE_ROWS - 1)

    const { rows, pages } = await readAll(harness, analysis.analysisId)
    expect(pages).toHaveLength(3)
    expect(rows.map((row) => row.rowIndex)).toEqual(Array.from({ length: 1_200 }, (_, index) => index))
    expect(pages[2].hasMore).toBe(false)
    expect(pages[2].nextAfter).toBe(1_199)
    for (const row of rows) expect(row.values).toEqual([row.rowIndex, `name-${row.rowIndex}`, row.rowIndex % 2 === 0 ? 'even' : 'odd'])
    expect(pages[0].analysis.columns).toEqual(['n', 'name', 'parity'])
    // values include the held-out column (it is shown to the viewer, just never sent to Jev)
    expect(rows[0].values).toHaveLength(pages[0].analysis.columns.length)
  })

  it('joins sample values aligned with analysis.columns', async () => {
    const harness = createHarness()
    const { analysis } = await startSample(harness)
    await runToEnd(harness, analysis.analysisId)
    const page = await harness.service.read(analysis.analysisId)
    const source = sampleRows()
    expect(page.rows).toHaveLength(71)
    page.rows.forEach((row, index) => expect(row.values).toEqual(source[index]))
    expect(page.analysis.columns[page.analysis.columns.indexOf('play_call')]).toBe('play_call')
    expect(page.rows[0].values[page.analysis.columns.indexOf('play_call')]).toBe('Run')
  })

  it('reports hasMore only for rows that are stored right now, and resumes from nextAfter', async () => {
    const harness = createHarness({ tick: 1, config: { concurrency: 5 } })
    const { analysis } = await startSample(harness)
    expect(await harness.service.read(analysis.analysisId)).toMatchObject({ rows: [], nextAfter: -1, hasMore: false })
    await harness.service.runChunk(analysis.analysisId, 1)
    const partial = await harness.service.read(analysis.analysisId)
    expect(partial.rows).toHaveLength(5)
    expect(partial.analysis.status).toBe('running')
    expect(partial.nextAfter).toBe(4)
    expect(partial.hasMore).toBe(false)
    await runToEnd(harness, analysis.analysisId)
    const rest = await harness.service.read(analysis.analysisId, partial.nextAfter)
    expect(rest.rows[0].rowIndex).toBe(5)
    expect(rest.rows).toHaveLength(66)
    const none = await harness.service.read(analysis.analysisId, 70)
    expect(none).toMatchObject({ rows: [], nextAfter: 70, hasMore: false })
  })

  it('treats an invalid cursor as "from the start"', async () => {
    const harness = createHarness()
    const { analysis } = await startSample(harness)
    await runToEnd(harness, analysis.analysisId)
    for (const bad of [-5, 1.5, Number.NaN]) {
      const page = await harness.service.read(analysis.analysisId, bad)
      expect(page.rows[0].rowIndex).toBe(0)
    }
  })

  it('404s for an unknown, empty or oversized id, and takes serverTime from the clock', async () => {
    const harness = createHarness()
    expect(await rejection(harness.service.read('missing'))).toMatchObject({ code: 'ANALYSIS_NOT_FOUND', statusCode: 404 })
    expect(await rejection(harness.service.read(''))).toMatchObject({ code: 'ANALYSIS_NOT_FOUND', statusCode: 404 })
    expect(await rejection(harness.service.read('x'.repeat(65)))).toMatchObject({ code: 'ANALYSIS_NOT_FOUND', statusCode: 404 })
    const { analysis } = await startSample(harness)
    harness.advance(12_345)
    expect((await harness.service.read(analysis.analysisId)).serverTime).toBe(T0 + 12_345)
  })

  it('never exposes the control token hash or lease fields', async () => {
    const harness = createHarness({ tick: 1 })
    const { analysis } = await startSample(harness)
    await harness.service.runChunk(analysis.analysisId, 1)
    const text = JSON.stringify(await harness.service.read(analysis.analysisId))
    const record = await harness.analyses.getRecord(analysis.analysisId)
    expect(text).not.toContain(record!.controlTokenHash)
    expect(text).not.toMatch(/controlTokenHash|ownerToken|leaseExpiresAt/)
  })

  it('cuts a page by the byte budget for very wide rows, but always returns a row and still reaches the end', async () => {
    const harness = createHarness({ config: { concurrency: 8 } })
    const cell = 'w'.repeat(100_000)
    const rows: DatasetRowValues[] = Array.from({ length: 40 }, (_, index) => [index, cell, 'x'])
    await putDataset(harness, 'wide', ['n', 'text', 'tag'], rows)
    const { analysis } = await harness.service.start({ datasetId: 'wide', query: 'q', classes, labelColumn: 'tag' }, 'c')
    await runToEnd(harness, analysis.analysisId)
    const first = await harness.service.read(analysis.analysisId)
    expect(first.rows.length).toBeGreaterThan(1)
    expect(first.rows.length).toBeLessThan(40)
    expect(first.hasMore).toBe(true)
    expect(first.nextAfter).toBe(first.rows.length - 1)
    expect(JSON.stringify(first).length).toBeLessThan(1_700_000)
    const walked = await readAll(harness, analysis.analysisId)
    expect(walked.pages.length).toBeGreaterThan(1)
    expect(walked.rows.map((row) => row.rowIndex)).toEqual(Array.from({ length: 40 }, (_, index) => index))
  })

  it('returns one row per page when a single row exceeds the whole byte budget', async () => {
    const harness = createHarness()
    const huge = 'h'.repeat(2_000_000)
    await putDataset(harness, 'huge', ['text', 'tag'], [[huge, 'x'], [huge, 'y'], [huge, 'z']])
    const { analysis } = await harness.service.start({ datasetId: 'huge', query: 'q', classes, labelColumn: 'tag' }, 'c')
    await runToEnd(harness, analysis.analysisId)
    const walked = await readAll(harness, analysis.analysisId)
    expect(walked.pages.map((page) => page.rows.length)).toEqual([1, 1, 1])
    expect(walked.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2])
  })
})

describe('AnalysisService scale', () => {
  it('stores 5,000 rows with small, constant-size appends (no re-sending of prior rows)', async () => {
    const appendSizes: number[] = []
    const harness = createHarness({
      config: { concurrency: 8 },
      wrapStore: (inner) => ({
        create: (record) => inner.create(record),
        getRecord: (id) => inner.getRecord(id),
        readPage: (id, after, limit) => inner.readPage(id, after, limit),
        claim: (id, owner, lease) => inner.claim(id, owner, lease),
        append: (id, owner, rows, lease) => {
          appendSizes.push(JSON.stringify({ analysisId: id, ownerToken: owner, rows, leaseMs: lease }).length)
          return inner.append(id, owner, rows, lease)
        },
        finish: (id, owner, outcome) => inner.finish(id, owner, outcome),
        cancel: (id) => inner.cancel(id),
        listRecent: (limit) => inner.listRecent(limit),
      }),
    })
    const rows: DatasetRowValues[] = Array.from({ length: 5_000 }, (_, index) => [index, `row ${index}`, index % 2 === 0 ? 'Run' : 'Pass'])
    await putDataset(harness, 'five-thousand', ['n', 'text', 'answer'], rows)
    const { analysis } = await harness.service.start({ datasetId: 'five-thousand', query: 'q', classes, labelColumn: 'answer' }, 'c')

    const startedAt = Date.now()
    expect(await runToEnd(harness, analysis.analysisId)).toEqual(['complete'])
    expect(Date.now() - startedAt).toBeLessThan(10_000)

    const record = await harness.analyses.getRecord(analysis.analysisId)
    expect(record?.progress).toEqual({ totalRows: 5_000, completedRows: 5_000, failedRows: 0 })
    expect(harness.calls).toHaveLength(5_000)
    expect(appendSizes.length).toBeLessThanOrEqual(5_000 / 8 + 5)
    expect(Math.max(...appendSizes)).toBeLessThan(5_000)
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    const early = mean(appendSizes.slice(0, 20))
    const late = mean(appendSizes.slice(-20))
    expect(late).toBeLessThan(early * 2)
    expect(late).toBeGreaterThan(early / 2)
  })
})

describe('AnalysisService.draft', () => {
  const createDraftProvider = (mode: AnalysisMode = 'mock') => {
    const requests: DraftRequest[] = []
    const provider: DraftProvider = {
      mode,
      draft: async (request) => {
        requests.push(request)
        return { query: 'Which one?', classes: [{ name: 'Yes', description: 'y' }, { name: 'No', description: 'n' }], model: 'draft-model' }
      },
    }
    return { provider, requests }
  }

  it('passes only input columns and bounded sample rows, plus the distinct label values', async () => {
    const { provider, requests } = createDraftProvider('live')
    const harness = createHarness({ draftProvider: provider })
    const result = await harness.service.draft({ datasetId: SAMPLE_DATASET_ID, task: '  Predict the play.  ', labelColumn: 'play_call' }, 'c')
    expect(result).toEqual({
      datasetId: SAMPLE_DATASET_ID,
      query: 'Which one?',
      classes: [{ name: 'Yes', description: 'y' }, { name: 'No', description: 'n' }],
      model: 'draft-model',
      mode: 'live',
    })
    const [request] = requests
    expect(request.task).toBe('Predict the play.')
    expect(request.columns).toEqual(['quarter', 'clock', 'down', 'yards_to_go', 'yards_to_end_zone', 'score_margin'])
    expect(request.sampleRows).toHaveLength(5)
    for (const row of request.sampleRows) {
      expect(row).not.toHaveProperty('play_call')
      expect(Object.keys(row)).toEqual(request.columns)
    }
    expect([...(request.labelValues ?? [])].sort()).toEqual(['Pass', 'Run'])
    expect(JSON.stringify(request)).not.toContain('"play_call"')
  })

  it('sends every column and no label values when there is no held-out column', async () => {
    const { provider, requests } = createDraftProvider()
    const harness = createHarness({ draftProvider: provider })
    await harness.service.draft({ datasetId: SAMPLE_DATASET_ID, task: 'Anything' }, 'c')
    expect(requests[0].columns).toHaveLength(7)
    expect(requests[0].labelValues).toBeUndefined()
  })

  it('includes label values for up to 12 distinct values and omits them above that', async () => {
    const { provider, requests } = createDraftProvider()
    const harness = createHarness({ draftProvider: provider })
    const labelled = (distinct: number): DatasetRowValues[] => Array.from({ length: 60 }, (_, index) => [index, `label-${index % distinct}`])
    await putDataset(harness, 'twelve', ['n', 'label'], labelled(12))
    await putDataset(harness, 'thirteen', ['n', 'label'], labelled(13))
    await putDataset(harness, 'one', ['n', 'label'], labelled(1))
    await harness.service.draft({ datasetId: 'twelve', task: 't', labelColumn: 'label' }, 'c')
    await harness.service.draft({ datasetId: 'thirteen', task: 't', labelColumn: 'label' }, 'c')
    await harness.service.draft({ datasetId: 'one', task: 't', labelColumn: 'label' }, 'c')
    expect(requests[0].labelValues).toHaveLength(12)
    expect(requests[1].labelValues).toBeUndefined()
    // A single distinct value cannot be a label set.
    expect(requests[2].labelValues).toBeUndefined()
  })

  // SOURCE BUG: draft() only scans the first 500 rows (LABEL_SCAN_ROWS), so a label column that grows past 12
  // distinct values later in the file is reported as a small, incomplete class set instead of being omitted.
  it.fails('omits label values when the 13th distinct value only appears after the first 500 rows', async () => {
    const { provider, requests } = createDraftProvider()
    const harness = createHarness({ draftProvider: provider })
    const rows: DatasetRowValues[] = Array.from({ length: 600 }, (_, index) => [index, index < 500 ? `label-${index % 3}` : `label-${index % 20}`])
    await putDataset(harness, 'late', ['n', 'label'], rows)
    await harness.service.draft({ datasetId: 'late', task: 't', labelColumn: 'label' }, 'c')
    expect(requests[0].labelValues).toBeUndefined()
  })

  it('validates the task, dataset and label column, and fails closed without a provider', async () => {
    const { provider, requests } = createDraftProvider()
    const harness = createHarness({ draftProvider: provider })
    expect((await rejection(harness.service.draft({ datasetId: SAMPLE_DATASET_ID, task: '  ' }, 'c'))).code).toBe('INVALID_TASK')
    expect((await rejection(harness.service.draft({ datasetId: SAMPLE_DATASET_ID, task: 'x'.repeat(2_001) }, 'c'))).code).toBe('INVALID_TASK')
    expect(await rejection(harness.service.draft({ datasetId: 'nope', task: 't' }, 'c'))).toMatchObject({ code: 'DATASET_NOT_FOUND', statusCode: 404 })
    expect((await rejection(harness.service.draft({ datasetId: SAMPLE_DATASET_ID, task: 't', labelColumn: 'nope' }, 'c'))).code).toBe('INVALID_LABEL_COLUMN')
    expect(requests).toHaveLength(0)

    const none = createHarness()
    expect(await rejection(none.service.draft({ datasetId: SAMPLE_DATASET_ID, task: 't' }, 'c'))).toMatchObject({ code: 'DRAFTING_NOT_CONFIGURED', statusCode: 503 })
  })

  it('rate limits drafts per client and does not charge for an unconfigured provider', async () => {
    const { provider, requests } = createDraftProvider()
    const harness = createHarness({ draftProvider: provider, config: { draftsPerHour: 2 } })
    await harness.service.draft({ datasetId: SAMPLE_DATASET_ID, task: 't' }, 'a')
    await harness.service.draft({ datasetId: SAMPLE_DATASET_ID, task: 't' }, 'a')
    const error = await rejection(harness.service.draft({ datasetId: SAMPLE_DATASET_ID, task: 't' }, 'a'))
    expect(error).toMatchObject({ code: 'RATE_LIMITED', statusCode: 429 })
    expect(error.retryAfterMs).toBe(HOUR)
    expect(requests).toHaveLength(2)
    await expect(harness.service.draft({ datasetId: SAMPLE_DATASET_ID, task: 't' }, 'b')).resolves.toBeDefined()
    // Drafts and runs are limited independently.
    await expect(startSample(harness, { clientKey: 'a' })).resolves.toBeDefined()
  })
})

describe('AnalysisService.listRecent', () => {
  it('lists newest first with a clipped query', async () => {
    const harness = createHarness()
    await harness.service.start({ datasetId: SAMPLE_DATASET_ID, query: 'first', classes }, 'c')
    harness.advance(1_000)
    await harness.service.start({ datasetId: SAMPLE_DATASET_ID, query: 'q'.repeat(500), classes }, 'c')
    const items = await harness.service.listRecent(10)
    expect(items).toHaveLength(2)
    expect(items[0].query).toHaveLength(160)
    expect(items[1].query).toBe('first')
    expect(items[0]).toMatchObject({ status: 'queued', completedRows: 0, totalRows: 71 })
    expect(items[0]).not.toHaveProperty('controlTokenHash')
  })
})
