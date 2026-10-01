// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CSV_MAX_BYTES } from '../dataset/csvTypes'
import { SAMPLE_DATASET_ID } from '../dataset/sampleDataset'
import type { LimitsStorage } from '../shared/analysis'
import { AnalysisService } from './analysis'
import type { RuntimeConfig } from './config'
import { DatasetService, type PublicCsvFetcher } from './datasets'
import { ApiError } from './errors'
import { continuationToken, createApi, type ApiHandler, type ApiRequest, type ApiResponse, type ApiRuntime } from './http'
import { InMemoryAnalysisStore, InMemoryDatasetStore, InMemoryLimitsStore } from './memoryStores'
import type { Classifier, DraftProvider, DraftRequest } from './providers'

const T0 = 1_700_000_000_000
const SECRET = 'test-internal-secret'
const ORIGIN = 'https://jev.test'
const GENERIC_500 = 'Something went wrong on our side. Please try again.'
const FINISHED_CACHE = 'public, max-age=60, s-maxage=86400'

interface Captured {
  status: number
  headers: Record<string, string>
  body: any
}

/** Runs a handler against a fake response and returns what went over the wire (JSON round-tripped). */
const invoke = async (handler: ApiHandler, request: Partial<ApiRequest> & { method?: string }): Promise<Captured> => {
  const captured: Captured = { status: 200, headers: {}, body: undefined }
  let sends = 0
  const response: ApiResponse = {
    status(code) { captured.status = code; return response },
    setHeader(name, value) { captured.headers[name.toLowerCase()] = value },
    json(body) { sends += 1; captured.body = JSON.parse(JSON.stringify(body)) },
  }
  await handler({ headers: {}, ...request } as ApiRequest, response)
  expect(sends).toBe(1)
  return captured
}

const post = (body: unknown, headers: Record<string, string> = {}, query?: ApiRequest['query']): Partial<ApiRequest> => ({ method: 'POST', headers, body, query })

interface RuntimeOptions {
  storage?: boolean
  tick?: number
  config?: Partial<RuntimeConfig>
  drafting?: boolean
  origin?: string | undefined
  fetchCsv?: PublicCsvFetcher
  limits?: (inner: LimitsStorage) => LimitsStorage
  fetchStatus?: number
}

const defaultConfig: RuntimeConfig = {
  localStorage: true,
  allowMock: true,
  openRouterModel: 'm',
  runsDisabled: false,
  maxRowsPerRun: 5_000,
  dailyCallBudget: 1_000_000,
  runsPerHour: 100,
  draftsPerHour: 100,
  uploadsPerHour: 100,
  concurrency: 2,
  chunkBudgetMs: 60_000,
}

const createFixture = (options: RuntimeOptions = {}) => {
  let clock = T0
  const now = () => clock
  const storage = options.storage ?? true
  const analysisStore = new InMemoryAnalysisStore(now)
  const datasetStore = new InMemoryDatasetStore(now)
  const limitsStore = new InMemoryLimitsStore(now)
  const limits = options.limits ? options.limits(limitsStore) : limitsStore
  const datasets = new DatasetService({ store: storage ? datasetStore : undefined, now, fetchCsv: options.fetchCsv })
  const state = { failing: false, calls: [] as number[] }
  const classifier: Classifier = {
    mode: 'live',
    classify: async (request) => {
      state.calls.push(request.rowIndex)
      clock += options.tick ?? 0
      if (state.failing) throw new ApiError('JEV_503', 'down', 502, { retryable: true })
      return { model: 'fake', selectedClass: request.classes[request.rowIndex % request.classes.length].name }
    },
  }
  const draftRequests: DraftRequest[] = []
  const draftProvider: DraftProvider | undefined = options.drafting === false ? undefined : {
    mode: 'mock',
    draft: async (request) => {
      draftRequests.push(request)
      return { query: 'Is it yes?', classes: [{ name: 'Yes', description: 'y' }, { name: 'No', description: 'n' }], model: 'draft-model' }
    },
  }
  const config = { ...defaultConfig, ...options.config }
  const analysis = new AnalysisService({
    store: storage ? analysisStore : undefined,
    limits: storage ? limits : undefined,
    datasets,
    classifier,
    draftProvider,
    config,
    now,
  })
  const pending: Promise<unknown>[] = []
  const fetchCalls: Array<{ url: string; init: RequestInit; body: { analysisId: string } }> = []
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response('{}', { status: options.fetchStatus ?? 202 })
  }) as typeof fetch
  const runtime: ApiRuntime = {
    config,
    datasets,
    analysis,
    limits: storage ? limits : undefined,
    internalSecret: SECRET,
    schedule: (task) => { pending.push(task) },
    selfOrigin: () => ('origin' in options ? options.origin : ORIGIN),
    fetch: fakeFetch,
  }
  return {
    api: createApi(runtime),
    runtime,
    analysis,
    datasets,
    analysisStore,
    state,
    draftRequests,
    fetchCalls,
    pendingCount: () => pending.length,
    settle: async () => { await Promise.all(pending.splice(0)) },
    advance: (ms: number) => { clock += ms },
  }
}

type Fixture = ReturnType<typeof createFixture>

const csvOf = (rows: number): string => `text,label\n${Array.from({ length: rows }, (_, index) => `row ${index},${index % 2 === 0 ? 'Yes' : 'No'}`).join('\n')}\n`

const uploadCsv = async (fixture: Fixture, rows = 30): Promise<string> => {
  const result = await invoke(fixture.api.upload, post(Buffer.from(csvOf(rows)), {}, { filename: 'flow.csv' }))
  expect(result.status).toBe(201)
  return result.body.datasetId
}

const startRun = async (fixture: Fixture, datasetId = SAMPLE_DATASET_ID, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => (
  invoke(fixture.api.run, post({ datasetId, query: 'Yes or no?', classes: [{ name: 'Yes', description: 'y' }, { name: 'No', description: 'n' }], ...extra }, headers))
)

const readRun = (fixture: Fixture, analysisId: string, after?: number) => (
  invoke(fixture.api.read, { method: 'GET', query: { analysisId, ...(after === undefined ? {} : { after: String(after) }) } })
)

beforeEach(() => {
  vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', '')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('methods and caching', () => {
  const routes: Array<[string, 'GET' | 'POST']> = [
    ['status', 'GET'],
    ['dataset', 'GET'],
    ['read', 'GET'],
    ['browse', 'GET'],
    ['upload', 'POST'],
    ['fromUrl', 'POST'],
    ['draft', 'POST'],
    ['run', 'POST'],
    ['cancel', 'POST'],
    ['resume', 'POST'],
    ['continue', 'POST'],
  ]

  it('exposes exactly the expected handlers', () => {
    expect(Object.keys(createFixture().api).sort()).toEqual(routes.map(([name]) => name).sort())
  })

  it.each(routes)('%s answers the wrong method with 405 and an Allow header, doing no work', async (name, method) => {
    const fixture = createFixture()
    const handler = fixture.api[name as keyof typeof fixture.api]
    const wrong = method === 'GET' ? 'POST' : 'GET'
    for (const attempt of [wrong, 'DELETE', 'PUT', undefined]) {
      const result = await invoke(handler, { method: attempt, body: {} })
      expect(result.status).toBe(405)
      expect(result.headers.allow).toBe(method)
      expect(result.headers['cache-control']).toBe('no-store')
      expect(result.body.error).toBe('METHOD_NOT_ALLOWED')
    }
    expect(fixture.pendingCount()).toBe(0)
  })

  it('sets Cache-Control and nosniff on every response, success or error', async () => {
    const fixture = createFixture()
    const responses = [
      await invoke(fixture.api.status, { method: 'GET' }),
      await invoke(fixture.api.browse, { method: 'GET' }),
      await invoke(fixture.api.dataset, { method: 'GET', query: { datasetId: SAMPLE_DATASET_ID } }),
      await invoke(fixture.api.dataset, { method: 'GET', query: { datasetId: 'nope' } }),
      await invoke(fixture.api.read, { method: 'GET', query: { analysisId: 'nope' } }),
      await invoke(fixture.api.run, post('not json')),
      await invoke(fixture.api.upload, post(Buffer.alloc(0))),
    ]
    for (const result of responses) {
      expect(result.headers['cache-control']).toBeTruthy()
      expect(result.headers['x-content-type-options']).toBe('nosniff')
    }
  })

  it('never lets a CDN cache an error', async () => {
    const fixture = createFixture()
    const errors = [
      await invoke(fixture.api.dataset, { method: 'GET', query: { datasetId: 'nope' } }),
      await invoke(fixture.api.read, { method: 'GET', query: { analysisId: 'nope' } }),
      await invoke(fixture.api.run, post({ datasetId: SAMPLE_DATASET_ID, query: '', classes: [] })),
      await invoke(fixture.api.cancel, post({ analysisId: 'nope', controlToken: 'x' })),
    ]
    for (const result of errors) {
      expect(result.status).toBeGreaterThanOrEqual(400)
      expect(result.headers['cache-control']).toBe('no-store')
    }
  })

  it('serves status as no-store, derived from config, without secrets', async () => {
    const fixture = createFixture({ config: { jevApiKey: 'jev-secret-key', openRouterKey: 'or-secret-key', allowMock: false, runsDisabled: true } })
    const result = await invoke(fixture.api.status, { method: 'GET' })
    expect(result.headers['cache-control']).toBe('no-store')
    expect(result.body).toEqual({
      storage: true,
      drafting: 'live',
      classifier: 'live',
      runsEnabled: false,
      limits: { maxRows: 5_000, maxBytes: CSV_MAX_BYTES, maxColumns: 100 },
    })
    expect(JSON.stringify(result.body)).not.toContain('secret')
    const bare = createFixture({ storage: false, config: { allowMock: false } })
    expect((await invoke(bare.api.status, { method: 'GET' })).body).toMatchObject({ storage: false, drafting: 'off', classifier: 'off' })
  })

  it('makes an in-flight run no-store and a complete run publicly cacheable', async () => {
    const fixture = createFixture()
    const started = await startRun(fixture)
    expect(started.status).toBe(202)
    expect(started.headers['cache-control']).toBe('no-store')
    const id = started.body.analysis.analysisId
    const queued = await readRun(fixture, id)
    expect(['queued', 'running']).toContain(queued.body.analysis.status)
    expect(queued.headers['cache-control']).toBe('no-store')

    await fixture.settle()
    const done = await readRun(fixture, id)
    expect(done.body.analysis.status).toBe('complete')
    expect(done.headers['cache-control']).toBe(FINISHED_CACHE)
  })

  it('keeps an errored run no-store, because it can be resumed', async () => {
    const fixture = createFixture({ config: { concurrency: 1 } })
    fixture.state.failing = true
    const started = await startRun(fixture)
    await fixture.settle()
    const result = await readRun(fixture, started.body.analysis.analysisId)
    expect(result.body.analysis.status).toBe('error')
    expect(result.headers['cache-control']).toBe('no-store')
  })

  it('caches datasets and the browse list publicly', async () => {
    const fixture = createFixture()
    expect((await invoke(fixture.api.dataset, { method: 'GET', query: { datasetId: SAMPLE_DATASET_ID } })).headers['cache-control']).toContain('public')
    expect((await invoke(fixture.api.browse, { method: 'GET' })).headers['cache-control']).toContain('public')
  })

  it('lists recent runs and datasets without any control token material', async () => {
    const fixture = createFixture()
    const datasetId = await uploadCsv(fixture)
    await startRun(fixture, datasetId)
    const result = await invoke(fixture.api.browse, { method: 'GET' })
    expect(result.body.analyses).toHaveLength(1)
    expect(result.body.datasets).toHaveLength(1)
    expect(JSON.stringify(result.body)).not.toMatch(/controlToken|controlTokenHash/)
  })
})

describe('upload', () => {
  const csv = csvOf(3)

  it('accepts a Buffer body', async () => {
    const fixture = createFixture()
    const result = await invoke(fixture.api.upload, post(Buffer.from(csv), {}, { filename: 'a.csv' }))
    expect(result.status).toBe(201)
    expect(result.body).toMatchObject({ acceptedRowCount: 3, displayName: 'a.csv', sourceType: 'upload' })
  })

  it('accepts a Uint8Array body', async () => {
    const fixture = createFixture()
    expect((await invoke(fixture.api.upload, post(new TextEncoder().encode(csv)))).status).toBe(201)
  })

  it('accepts a string body', async () => {
    const fixture = createFixture()
    const result = await invoke(fixture.api.upload, post(csv, {}, { filename: ['first.csv', 'second.csv'] }))
    expect(result.status).toBe(201)
    expect(result.body.acceptedRowCount).toBe(3)
    expect(result.body.displayName).toBe('first.csv')
  })

  it('accepts a body delivered only through async iteration, in mixed chunk types', async () => {
    const fixture = createFixture()
    const bytes = Buffer.from(csv)
    const request = {
      method: 'POST',
      headers: {},
      query: { filename: 'streamed.csv' },
      async *[Symbol.asyncIterator]() {
        yield bytes.subarray(0, 7)
        yield new Uint8Array(bytes.subarray(7, 15))
        yield bytes.subarray(15).toString('utf8')
      },
    }
    const result = await invoke(fixture.api.upload, request as unknown as Partial<ApiRequest>)
    expect(result.status).toBe(201)
    expect(result.body).toMatchObject({ acceptedRowCount: 3, displayName: 'streamed.csv' })
    expect(Object.prototype.hasOwnProperty.call(request, 'body')).toBe(false)
  })

  it('rejects an oversize content-length without reading the stream', async () => {
    const fixture = createFixture()
    let consumed = 0
    const request = {
      method: 'POST',
      headers: { 'content-length': String(CSV_MAX_BYTES + 1) },
      async *[Symbol.asyncIterator]() { consumed += 1; yield Buffer.from('x') },
    }
    const result = await invoke(fixture.api.upload, request as unknown as Partial<ApiRequest>)
    expect(result.status).toBe(413)
    expect(result.body.error).toBe('CSV_TOO_LARGE')
    expect(consumed).toBe(0)
  })

  it('rejects an oversize streamed body even when content-length is missing or lies, and stops reading', async () => {
    const fixture = createFixture()
    let chunks = 0
    const chunk = Buffer.alloc(1024 * 1024, 97)
    const request = {
      method: 'POST',
      headers: { 'content-length': '10' },
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 50; index += 1) { chunks += 1; yield chunk }
      },
    }
    const result = await invoke(fixture.api.upload, request as unknown as Partial<ApiRequest>)
    expect(result.status).toBe(413)
    expect(result.body.error).toBe('CSV_TOO_LARGE')
    expect(chunks).toBeLessThanOrEqual(6)
  })

  it('rejects an oversize Buffer or string body', async () => {
    const fixture = createFixture()
    for (const body of [Buffer.alloc(CSV_MAX_BYTES + 1, 97), 'a'.repeat(CSV_MAX_BYTES + 1)]) {
      const result = await invoke(fixture.api.upload, post(body))
      expect(result.status).toBe(413)
      expect(result.body.error).toBe('CSV_TOO_LARGE')
    }
  })

  it('rejects an empty body with CSV_EMPTY however it is empty', async () => {
    const fixture = createFixture()
    const emptyStream = { method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { /* nothing */ } }
    for (const request of [post(Buffer.alloc(0)), post(''), post(undefined), emptyStream as unknown as Partial<ApiRequest>]) {
      const result = await invoke(fixture.api.upload, request)
      expect(result.status).toBe(400)
      expect(result.body.error).toBe('CSV_EMPTY')
    }
  })

  it('fails closed with STORAGE_NOT_CONFIGURED when there is no storage', async () => {
    const fixture = createFixture({ storage: false })
    const result = await invoke(fixture.api.upload, post(Buffer.from(csv)))
    expect(result.status).toBe(503)
    expect(result.body.error).toBe('STORAGE_NOT_CONFIGURED')
    expect((await invoke(fixture.api.fromUrl, post({ url: 'https://example.com/a.csv' }))).body.error).toBe('STORAGE_NOT_CONFIGURED')
  })

  it('rate limits uploads per client with a Retry-After header, and not other clients', async () => {
    const fixture = createFixture({ config: { uploadsPerHour: 2 } })
    const mine = { 'x-forwarded-for': '203.0.113.9' }
    for (let index = 0; index < 2; index += 1) expect((await invoke(fixture.api.upload, post(Buffer.from(csv), mine))).status).toBe(201)
    fixture.advance(30 * 60_000)
    const limited = await invoke(fixture.api.upload, post(Buffer.from(csv), mine))
    expect(limited.status).toBe(429)
    expect(limited.body).toMatchObject({ error: 'RATE_LIMITED', retryable: true })
    expect(limited.headers['retry-after']).toBe(String(30 * 60))
    expect(limited.headers['cache-control']).toBe('no-store')
    expect((await invoke(fixture.api.upload, post(Buffer.from(csv), { 'x-forwarded-for': '203.0.113.10' }))).status).toBe(201)
  })

  it('shares the upload limit with from-url, and validates the url body', async () => {
    const fetchCsv: PublicCsvFetcher = async () => ({ bytes: new TextEncoder().encode(csv), finalUrl: 'https://example.com/d.csv', contentType: 'text/csv' })
    const fixture = createFixture({ fetchCsv, config: { uploadsPerHour: 1 } })
    const first = await invoke(fixture.api.fromUrl, post({ url: 'https://example.com/d.csv' }))
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ sourceType: 'public_url', displayName: 'd.csv' })
    expect((await invoke(fixture.api.fromUrl, post({ url: 'https://example.com/d.csv' }))).status).toBe(429)
    expect((await invoke(fixture.api.upload, post(Buffer.from(csv)))).status).toBe(429)

    const other = createFixture({ fetchCsv })
    expect((await invoke(other.api.fromUrl, post({ url: 5 }))).body.error).toBe('URL_NOT_PUBLIC')
    expect((await invoke(other.api.fromUrl, post('{bad json'))).body.error).toBe('INVALID_JSON')
    expect((await invoke(other.api.fromUrl, post([1, 2]))).body.error).toBe('INVALID_BODY')
    expect((await invoke(other.api.fromUrl, post(undefined))).body.error).toBe('INVALID_BODY')
    expect((await invoke(other.api.fromUrl, post('{"url":"https://example.com/d.csv"}'))).status).toBe(201)
  })
})

describe('client key', () => {
  const keysFor = async (headers: Record<string, string | string[]>[]): Promise<string[]> => {
    const keys: string[] = []
    const fixture = createFixture({
      limits: (inner) => ({
        consumeRate: (key, limit, windowMs) => { keys.push(key); return inner.consumeRate(key, limit, windowMs) },
        reserveBudget: (scope, amount, max) => inner.reserveBudget(scope, amount, max),
      }),
    })
    for (const header of headers) await invoke(fixture.api.upload, post(Buffer.from(csvOf(2)), header as Record<string, string>))
    return keys
  }

  it('derives from the first x-forwarded-for hop and is not the raw address', async () => {
    const [a, sameFirstHop, other, viaArray] = await keysFor([
      { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' },
      { 'x-forwarded-for': ' 198.51.100.7 ,172.16.0.9, 10.1.1.1' },
      { 'x-forwarded-for': '198.51.100.8, 10.0.0.1' },
      { 'x-forwarded-for': ['198.51.100.7, 1.1.1.1', 'ignored'] },
    ])
    expect(a).toBe(sameFirstHop)
    expect(a).toBe(viaArray)
    expect(a).not.toBe(other)
    expect(a).toMatch(/^upload:[0-9a-f]{24}$/)
    expect(a).not.toContain('198.51.100.7')
    expect(a).not.toContain('10.0.0.1')
  })

  it('falls back to x-real-ip, then to a shared "unknown" bucket', async () => {
    const [real, sameReal, none, none2] = await keysFor([{ 'x-real-ip': '192.0.2.44' }, { 'x-real-ip': '192.0.2.44' }, {}, {}])
    expect(real).toBe(sameReal)
    expect(real).not.toContain('192.0.2.44')
    expect(none).toBe(none2)
    expect(none).not.toBe(real)
  })

  it('is salted by the server secret, so keys are not guessable from an address', async () => {
    const [key] = await keysFor([{ 'x-forwarded-for': '198.51.100.7' }])
    const { createHash } = await import('node:crypto')
    expect(key).not.toBe(`upload:${createHash('sha256').update('198.51.100.7').digest('hex').slice(0, 24)}`)
  })
})

describe('full flow', () => {
  it('uploads, drafts, runs, and pages through a completed run', async () => {
    const fixture = createFixture()
    const datasetId = await uploadCsv(fixture, 30)

    const draft = await invoke(fixture.api.draft, post({ datasetId, task: 'Is it yes?', labelColumn: 'label' }))
    expect(draft.status).toBe(200)
    expect(draft.body).toMatchObject({ datasetId, query: 'Is it yes?', model: 'draft-model', mode: 'mock' })
    expect(fixture.draftRequests[0].columns).toEqual(['text'])
    expect(fixture.draftRequests[0].labelValues?.slice().sort()).toEqual(['No', 'Yes'])

    const started = await startRun(fixture, datasetId, { labelColumn: 'label' })
    expect(started.status).toBe(202)
    expect(started.body.controlToken).toMatch(/^[0-9a-f]{48}$/)
    expect(started.body.analysis).toMatchObject({ status: 'queued', datasetId })
    expect(started.body.analysis).not.toHaveProperty('controlTokenHash')
    expect(fixture.pendingCount()).toBe(1)
    await fixture.settle()

    const id = started.body.analysis.analysisId
    const first = await readRun(fixture, id)
    expect(first.status).toBe(200)
    expect(first.body.analysis).toMatchObject({ status: 'complete', progress: { totalRows: 30, completedRows: 30, failedRows: 0 } })
    expect(first.body.rows).toHaveLength(30)
    expect(first.body.rows[4].values).toEqual(['row 4', 'Yes'])
    expect(first.body.hasMore).toBe(false)
    expect(first.body.nextAfter).toBe(29)
    expect(JSON.stringify(first.body)).not.toMatch(/controlToken|ownerToken/)

    const tail = await readRun(fixture, id, 24)
    expect(tail.body.rows.map((row: { rowIndex: number }) => row.rowIndex)).toEqual([25, 26, 27, 28, 29])
    const garbage = await invoke(fixture.api.read, { method: 'GET', query: { analysisId: id, after: 'abc' } })
    expect(garbage.body.rows).toHaveLength(30)
    expect(fixture.state.calls).toHaveLength(30)
  })

  it('answers unknown ids and bad bodies with the right status and schedules nothing', async () => {
    const fixture = createFixture()
    expect((await invoke(fixture.api.read, { method: 'GET', query: {} })).status).toBe(404)
    expect((await invoke(fixture.api.read, { method: 'GET', query: { analysisId: 'nope' } })).body.error).toBe('ANALYSIS_NOT_FOUND')
    expect((await startRun(fixture, 'nope')).status).toBe(404)
    expect((await invoke(fixture.api.run, post({ datasetId: SAMPLE_DATASET_ID, query: 'q', classes: 'Yes,No' }))).body.error).toBe('INVALID_CLASSES')
    expect((await invoke(fixture.api.run, post(undefined))).body.error).toBe('INVALID_BODY')
    expect((await invoke(fixture.api.draft, post({ datasetId: SAMPLE_DATASET_ID }))).body.error).toBe('INVALID_TASK')
    expect((await invoke(fixture.api.dataset, { method: 'GET', query: {} })).status).toBe(404)
    expect(fixture.pendingCount()).toBe(0)
    expect(fixture.state.calls).toHaveLength(0)
  })

  it('fails closed on draft without a provider and on run without storage', async () => {
    const noDraft = createFixture({ drafting: false })
    expect((await invoke(noDraft.api.draft, post({ datasetId: SAMPLE_DATASET_ID, task: 't' }))).status).toBe(503)
    const noStorage = createFixture({ storage: false })
    const result = await startRun(noStorage)
    expect(result.status).toBe(503)
    expect(result.body.error).toBe('STORAGE_NOT_CONFIGURED')
    expect(noStorage.pendingCount()).toBe(0)
  })

  it('rate limits runs with a Retry-After header and schedules no work for the refused run', async () => {
    const fixture = createFixture({ config: { runsPerHour: 1 } })
    expect((await startRun(fixture)).status).toBe(202)
    const limited = await startRun(fixture)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
    expect(fixture.pendingCount()).toBe(1)
  })
})

describe('continuation', () => {
  const continueRequest = (analysisId: string, token: string | undefined): Partial<ApiRequest> => (
    post({ analysisId }, token === undefined ? {} : { 'x-jev-internal': token })
  )

  it('hands a long run to a fresh invocation by POSTing a signed call to <origin>/api/analysis/continue', async () => {
    const fixture = createFixture({ tick: 1, config: { chunkBudgetMs: 1 } })
    const started = await startRun(fixture)
    const id = started.body.analysis.analysisId
    await fixture.settle()

    expect(fixture.fetchCalls).toHaveLength(1)
    const [call] = fixture.fetchCalls
    expect(call.url).toBe(`${ORIGIN}/api/analysis/continue`)
    expect(call.init.method).toBe('POST')
    expect((call.init.headers as Record<string, string>)['x-jev-internal']).toBe(continuationToken(SECRET, id))
    expect((call.init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(call.body).toEqual({ analysisId: id })
    expect(JSON.stringify(call.init.headers)).not.toContain(started.body.controlToken)
    const mid = await readRun(fixture, id)
    expect(mid.body.analysis.status).toBe('running')
    expect(mid.body.analysis.progress.completedRows).toBeLessThan(71)
    expect(mid.headers['cache-control']).toBe('no-store')
  })

  it('completes a run by feeding every recorded continuation back into the continue handler', async () => {
    const fixture = createFixture({ tick: 1, config: { chunkBudgetMs: 1 } })
    const started = await startRun(fixture)
    const id = started.body.analysis.analysisId
    await fixture.settle()

    let hops = 0
    while (fixture.fetchCalls.length > 0) {
      const call = fixture.fetchCalls.shift()!
      hops += 1
      expect(hops).toBeLessThan(200)
      const result = await invoke(fixture.api.continue, post(call.body, call.init.headers as Record<string, string>))
      expect(result.status).toBe(202)
      await fixture.settle()
    }
    expect(hops).toBeGreaterThan(5)
    const finished = await readRun(fixture, id)
    expect(finished.body.analysis).toMatchObject({ status: 'complete', progress: { totalRows: 71, completedRows: 71, failedRows: 0 } })
    expect(finished.body.rows).toHaveLength(71)
    expect(fixture.state.calls).toHaveLength(71)
    expect(new Set(fixture.state.calls).size).toBe(71)
  })

  it('rejects a missing or wrong token with 403 and does no work', async () => {
    const fixture = createFixture()
    const started = await startRun(fixture)
    const id = started.body.analysis.analysisId
    await fixture.settle()
    const callsBefore = fixture.state.calls.length
    const other = (await startRun(fixture)).body.analysis.analysisId
    fixture.state.calls.length = 0

    const forged = [
      continueRequest(other, undefined),
      continueRequest(other, ''),
      continueRequest(other, 'nope'),
      continueRequest(other, continuationToken(SECRET, id)),
      continueRequest(other, continuationToken('another-secret', other)),
      continueRequest(other, started.body.controlToken),
      continueRequest('', continuationToken(SECRET, '')),
      post({}, { 'x-jev-internal': continuationToken(SECRET, 'undefined') }),
      post({ analysisId: 7 }, { 'x-jev-internal': continuationToken(SECRET, '7') }),
    ]
    for (const request of forged) {
      const result = await invoke(fixture.api.continue, request)
      expect(result.status).toBe(403)
      expect(result.body.error).toBe('FORBIDDEN')
    }
    expect(callsBefore).toBeGreaterThan(0)
    expect(fixture.pendingCount()).toBe(1)
    await fixture.settle()
    // Only the legitimately started run (the second one) ever classified rows.
    expect(fixture.state.calls).toHaveLength(71)
  })

  it('accepts a correctly signed call and does the work asynchronously', async () => {
    const fixture = createFixture({ tick: 1, config: { chunkBudgetMs: 1 } })
    const started = await startRun(fixture)
    const id = started.body.analysis.analysisId
    await fixture.settle()
    const before = (await readRun(fixture, id)).body.analysis.progress.completedRows
    const result = await invoke(fixture.api.continue, continueRequest(id, continuationToken(SECRET, id)))
    expect(result.status).toBe(202)
    expect(fixture.pendingCount()).toBe(1)
    await fixture.settle()
    expect((await readRun(fixture, id)).body.analysis.progress.completedRows).toBeGreaterThan(before)
  })

  it('never resumes a run in error status, while resume with the control token does', async () => {
    const fixture = createFixture({ config: { concurrency: 1 } })
    fixture.state.failing = true
    const started = await startRun(fixture)
    const id = started.body.analysis.analysisId
    await fixture.settle()
    expect((await readRun(fixture, id)).body.analysis).toMatchObject({ status: 'error', error: { code: 'JEV_503', retryable: true } })
    const callsAtStop = fixture.state.calls.length
    fixture.state.failing = false

    const continued = await invoke(fixture.api.continue, continueRequest(id, continuationToken(SECRET, id)))
    expect(continued.status).toBe(202)
    await fixture.settle()
    expect(fixture.state.calls).toHaveLength(callsAtStop)
    expect((await readRun(fixture, id)).body.analysis.status).toBe('error')

    const resumed = await invoke(fixture.api.resume, post({ analysisId: id, controlToken: started.body.controlToken }))
    expect(resumed.status).toBe(202)
    await fixture.settle()
    const done = await readRun(fixture, id)
    expect(done.body.analysis).toMatchObject({ status: 'complete', progress: { completedRows: 71, failedRows: callsAtStop } })
    expect(done.body.analysis.error).toBeUndefined()
  })

  it('leaves the run waiting for a manual resume when the deployment has no self origin', async () => {
    const fixture = createFixture({ tick: 1, origin: undefined, config: { chunkBudgetMs: 1 } })
    const started = await startRun(fixture)
    const id = started.body.analysis.analysisId
    await fixture.settle()
    expect(fixture.fetchCalls).toHaveLength(0)
    const stalled = await readRun(fixture, id)
    expect(stalled.body.analysis.status).toBe('running')
    const before = stalled.body.analysis.progress.completedRows
    expect((await invoke(fixture.api.resume, post({ analysisId: id, controlToken: started.body.controlToken }))).status).toBe(202)
    await fixture.settle()
    expect((await readRun(fixture, id)).body.analysis.progress.completedRows).toBeGreaterThan(before)
  })

  it('retries a failed continuation three times, then gives up quietly', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const fixture = createFixture({ tick: 1, fetchStatus: 500, config: { chunkBudgetMs: 1 } })
    await startRun(fixture)
    const settled = fixture.settle()
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(settled).resolves.toBeUndefined()
    expect(fixture.fetchCalls).toHaveLength(3)
  })

  it('forwards the deployment-protection bypass secret when one is configured', async () => {
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'bypass-me')
    const fixture = createFixture({ tick: 1, config: { chunkBudgetMs: 1 } })
    await startRun(fixture)
    await fixture.settle()
    expect((fixture.fetchCalls[0].init.headers as Record<string, string>)['x-vercel-protection-bypass']).toBe('bypass-me')
  })

  it('derives a different token per run and per secret', () => {
    expect(continuationToken('s', 'a')).toMatch(/^[0-9a-f]{64}$/)
    expect(continuationToken('s', 'a')).not.toBe(continuationToken('s', 'b'))
    expect(continuationToken('s', 'a')).not.toBe(continuationToken('t', 'a'))
    expect(continuationToken('s', 'a')).toBe(continuationToken('s', 'a'))
  })
})

describe('cancel and resume', () => {
  it('rejects a wrong token with 403 NOT_RUN_OWNER and an unknown run with 404', async () => {
    const fixture = createFixture({ tick: 1, config: { chunkBudgetMs: 1 } })
    const started = await startRun(fixture)
    const id = started.body.analysis.analysisId
    await fixture.settle()
    for (const handler of [fixture.api.cancel, fixture.api.resume]) {
      for (const token of ['wrong', '', undefined, 5]) {
        const result = await invoke(handler, post({ analysisId: id, controlToken: token }))
        expect(result).toMatchObject({ status: 403, body: { error: 'NOT_RUN_OWNER' } })
      }
      const missing = await invoke(handler, post({ analysisId: 'nope', controlToken: started.body.controlToken }))
      expect(missing).toMatchObject({ status: 404, body: { error: 'ANALYSIS_NOT_FOUND' } })
    }
    expect(fixture.pendingCount()).toBe(0)
    expect((await readRun(fixture, id)).body.analysis.status).toBe('running')
  })

  it('cancels with the right token; a cancelled run is final, cacheable, and cannot be resumed', async () => {
    const fixture = createFixture({ tick: 1, config: { chunkBudgetMs: 1 } })
    const started = await startRun(fixture)
    const id = started.body.analysis.analysisId
    await fixture.settle()
    const cancelled = await invoke(fixture.api.cancel, post({ analysisId: id, controlToken: started.body.controlToken }))
    expect(cancelled).toMatchObject({ status: 200, body: { ok: true } })
    const resumed = await invoke(fixture.api.resume, post({ analysisId: id, controlToken: started.body.controlToken }))
    expect(resumed).toMatchObject({ status: 409, body: { error: 'RUN_FINISHED' } })
    expect(fixture.pendingCount()).toBe(0)

    // A continuation already in flight must not revive it.
    const callsBefore = fixture.state.calls.length
    await invoke(fixture.api.continue, post({ analysisId: id }, { 'x-jev-internal': continuationToken(SECRET, id) }))
    await fixture.settle()
    expect(fixture.state.calls).toHaveLength(callsBefore)
    const page = await readRun(fixture, id)
    expect(page.body.analysis.status).toBe('cancelled')
    expect(page.headers['cache-control']).toBe(FINISHED_CACHE)
  })
})

describe('unexpected failures', () => {
  it('turns a thrown error into a generic 500 INTERNAL_ERROR with no trace of its message', async () => {
    const thrown = new Error('db exploded: authToken=sk_live_SECRET at /srv/app/convex.ts:12')
    const fixture = createFixture()
    vi.spyOn(fixture.datasets, 'getPreview').mockRejectedValue(thrown)
    vi.spyOn(fixture.analysis, 'start').mockRejectedValue(thrown)
    vi.spyOn(fixture.analysis, 'read').mockRejectedValue(thrown)
    const results = [
      await invoke(fixture.api.dataset, { method: 'GET', query: { datasetId: 'x' } }),
      await startRun(fixture),
      await readRun(fixture, 'x'),
    ]
    for (const result of results) {
      expect(result.status).toBe(500)
      expect(result.body).toEqual({ error: 'INTERNAL_ERROR', message: GENERIC_500, retryable: true })
      expect(result.headers['cache-control']).toBe('no-store')
      expect(JSON.stringify(result)).not.toContain('SECRET')
      expect(JSON.stringify(result)).not.toContain('exploded')
    }
    expect(fixture.pendingCount()).toBe(0)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('SECRET')
  })

  it('does not leak a non-Error throw either', async () => {
    const fixture = createFixture()
    vi.spyOn(fixture.analysis, 'listRecent').mockRejectedValue('sk_live_SECRET')
    const result = await invoke(fixture.api.browse, { method: 'GET' })
    expect(result.status).toBe(500)
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it('keeps the specific message of an ApiError (those are written for users)', async () => {
    const fixture = createFixture()
    vi.spyOn(fixture.analysis, 'read').mockRejectedValue(new ApiError('SOME_CODE', 'Friendly words.', 418))
    expect(await readRun(fixture, 'x')).toMatchObject({ status: 418, body: { error: 'SOME_CODE', message: 'Friendly words.' } })
  })

  it('does not let a failing background run crash the scheduler', async () => {
    const fixture = createFixture()
    vi.spyOn(fixture.analysis, 'runChunk').mockRejectedValue(new Error('worker blew up sk_live_SECRET'))
    const started = await startRun(fixture)
    expect(started.status).toBe(202)
    await expect(fixture.settle()).resolves.toBeUndefined()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('SECRET')
  })
})
