// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAMPLE_DATASET_ID } from '../dataset/sampleDataset'
import { ApiError } from './errors'
import { createApi, type ApiHandler, type ApiRequest, type ApiResponse, type ApiRuntime } from './http'

const ENV_KEYS = [
  'CONVEX_URL',
  'VITE_CONVEX_URL',
  'CONVEX_WRITE_SECRET',
  'JEV_PLAYGROUND_STORAGE',
  'JEV_PLAYGROUND_MOCK',
  'JEV_API_KEY',
  'TYPESAFE_BASE_URL',
  'OPENROUTER_KEY',
  'OPENROUTER_MODEL',
  'JEV_RUNS_DISABLED',
  'JEV_MAX_ROWS_PER_RUN',
  'JEV_DAILY_CALL_BUDGET',
  'JEV_RUNS_PER_HOUR',
  'JEV_DRAFTS_PER_HOUR',
  'JEV_CONCURRENCY',
  'JEV_CHUNK_BUDGET_MS',
  'JEV_PUBLIC_ORIGIN',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
]

const CONVEX_URL = 'https://happy-animal-123.convex.cloud'

/**
 * `runtime.ts` also builds `createApi(createRuntime())` at import time, so it is
 * imported lazily, after `beforeEach` blanks the real environment. Resetting the
 * module registry would load a second `errors.ts` and break `instanceof ApiError`.
 */
const loadRuntime = () => import('./runtime')

const build = async (env: Record<string, string>): Promise<ApiRuntime> => {
  const { createRuntime } = await loadRuntime()
  return createRuntime(env as NodeJS.ProcessEnv)
}

const invoke = async (handler: ApiHandler, request: Partial<ApiRequest>): Promise<{ status: number; headers: Record<string, string>; body: any }> => {
  const captured = { status: 200, headers: {} as Record<string, string>, body: undefined as any }
  const response: ApiResponse = {
    status(code) { captured.status = code; return response },
    setHeader(name, value) { captured.headers[name.toLowerCase()] = value },
    json(body) { captured.body = JSON.parse(JSON.stringify(body)) },
  }
  await handler({ headers: {}, ...request } as ApiRequest, response)
  return captured
}

const post = (body: unknown): Partial<ApiRequest> => ({ method: 'POST', body })
const get = (query: ApiRequest['query'] = {}): Partial<ApiRequest> => ({ method: 'GET', query })
const runSample = { datasetId: SAMPLE_DATASET_ID, query: 'Run or pass?', classes: [{ name: 'Run', description: 'r' }, { name: 'Pass', description: 'p' }], labelColumn: 'play_call' }

beforeEach(() => {
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('the module-scope api', () => {
  it('is built from the real environment and is closed when that environment is empty', async () => {
    const { api } = await loadRuntime()
    const status = await invoke(api.status, get())
    expect(status.body).toMatchObject({ storage: false, drafting: 'off', classifier: 'off' })
  })
})

describe('createRuntime with no configuration', () => {
  it('reports storage, drafting and classifier as unavailable', async () => {
    const runtime = await build({})
    const status = await invoke(createApi(runtime).status, get())
    expect(status.body).toEqual({
      storage: false,
      drafting: 'off',
      classifier: 'off',
      runsEnabled: true,
      limits: { maxRows: 5_000, maxBytes: 4 * 1024 * 1024, maxColumns: 100 },
    })
    expect(runtime.limits).toBeUndefined()
    expect(runtime.datasets.storageReady).toBe(false)
  })

  it('fails closed with STORAGE_NOT_CONFIGURED 503 for run, upload and read, never falling back to memory', async () => {
    const api = createApi(await build({}))
    const run = await invoke(api.run, post(runSample))
    expect(run).toMatchObject({ status: 503, body: { error: 'STORAGE_NOT_CONFIGURED' } })
    const upload = await invoke(api.upload, { method: 'POST', body: Buffer.from('a,b\n1,2\n') })
    expect(upload).toMatchObject({ status: 503, body: { error: 'STORAGE_NOT_CONFIGURED' } })
    expect(await invoke(api.fromUrl, post({ url: 'https://example.com/a.csv' }))).toMatchObject({ status: 503, body: { error: 'STORAGE_NOT_CONFIGURED' } })
    expect(await invoke(api.read, get({ analysisId: 'anything' }))).toMatchObject({ status: 503, body: { error: 'STORAGE_NOT_CONFIGURED' } })
    // Nothing was silently stored: a retry still fails the same way.
    expect((await invoke(api.run, post(runSample))).status).toBe(503)
    expect(await invoke(api.browse, get())).toMatchObject({ status: 200, body: { analyses: [], datasets: [] } })
  })

  it('still serves the sample dataset preview', async () => {
    const api = createApi(await build({}))
    const result = await invoke(api.dataset, get({ datasetId: SAMPLE_DATASET_ID }))
    expect(result).toMatchObject({ status: 200, body: { datasetId: SAMPLE_DATASET_ID, acceptedRowCount: 71 } })
  })

  it('does not start a run even with mock providers enabled, because there is nowhere durable to put it', async () => {
    const runtime = await build({ JEV_PLAYGROUND_MOCK: '1' })
    const api = createApi(runtime)
    expect((await invoke(api.status, get())).body).toMatchObject({ storage: false, drafting: 'mock', classifier: 'mock' })
    expect(await invoke(api.run, post(runSample))).toMatchObject({ status: 503, body: { error: 'STORAGE_NOT_CONFIGURED' } })
  })

  it('ignores local storage on Vercel and a Convex URL without its write secret', async () => {
    const envs: Record<string, string>[] = [
      { JEV_PLAYGROUND_STORAGE: 'local', VERCEL: '1', JEV_PLAYGROUND_MOCK: '1' },
      { CONVEX_URL, JEV_PLAYGROUND_MOCK: '1' },
      { CONVEX_WRITE_SECRET: 'only-secret', JEV_PLAYGROUND_MOCK: '1' },
      { CONVEX_URL: 'http://happy-animal-123.convex.cloud', CONVEX_WRITE_SECRET: 's', JEV_PLAYGROUND_MOCK: '1' },
    ]
    for (const env of envs) {
      const api = createApi(await build(env))
      expect((await invoke(api.status, get())).body.storage).toBe(false)
      expect((await invoke(api.run, post(runSample))).body.error).toBe('STORAGE_NOT_CONFIGURED')
    }
  })
})

describe('createRuntime with local storage', () => {
  it('has storage but no providers unless mock or keys are configured', async () => {
    const api = createApi(await build({ JEV_PLAYGROUND_STORAGE: 'local' }))
    expect((await invoke(api.status, get())).body).toMatchObject({ storage: true, drafting: 'off', classifier: 'off' })
    expect(await invoke(api.run, post(runSample))).toMatchObject({ status: 503, body: { error: 'JEV_NOT_CONFIGURED' } })
    expect(await invoke(api.draft, post({ datasetId: SAMPLE_DATASET_ID, task: 't' }))).toMatchObject({ status: 503, body: { error: 'DRAFTING_NOT_CONFIGURED' } })
  })

  it('completes a full sample run with the mock classifier', async () => {
    const runtime = await build({ JEV_PLAYGROUND_STORAGE: 'local', JEV_PLAYGROUND_MOCK: '1', JEV_CONCURRENCY: '8' })
    expect(runtime.config).toMatchObject({ localStorage: true, allowMock: true, concurrency: 8 })
    const started = await runtime.analysis.start(runSample, 'client')
    expect(started.analysis).toMatchObject({ mode: 'mock', status: 'queued' })
    expect(await runtime.analysis.runChunk(started.analysis.analysisId, runtime.config.chunkBudgetMs)).toBe('complete')
    const page = await runtime.analysis.read(started.analysis.analysisId)
    expect(page.analysis).toMatchObject({ status: 'complete', progress: { totalRows: 71, completedRows: 71, failedRows: 0 } })
    expect(page.rows).toHaveLength(71)
    for (const row of page.rows) {
      expect(['Run', 'Pass']).toContain(row.selectedClass)
      expect(row.model).toMatch(/simulated/)
    }
  })

  it('stores uploads and shares them across handlers of the same runtime', async () => {
    const api = createApi(await build({ JEV_PLAYGROUND_STORAGE: 'local' }))
    const upload = await invoke(api.upload, { method: 'POST', body: Buffer.from('a,b\n1,x\n2,y\n'), query: { filename: 'tiny.csv' } })
    expect(upload.status).toBe(201)
    const read = await invoke(api.dataset, get({ datasetId: upload.body.datasetId }))
    expect(read).toMatchObject({ status: 200, body: { displayName: 'tiny.csv', acceptedRowCount: 2 } })
    // A different runtime is a different process: it must not see this dataset.
    const other = createApi(await build({ JEV_PLAYGROUND_STORAGE: 'local' }))
    expect((await invoke(other.dataset, get({ datasetId: upload.body.datasetId }))).status).toBe(404)
  })

  it('uses a fresh random internal secret per runtime', async () => {
    const first = await build({ JEV_PLAYGROUND_STORAGE: 'local' })
    const second = await build({ JEV_PLAYGROUND_STORAGE: 'local' })
    expect(first.internalSecret).toMatch(/^[0-9a-f]{64}$/)
    expect(first.internalSecret).not.toBe(second.internalSecret)
  })

  it('honours JEV_RUNS_DISABLED', async () => {
    const api = createApi(await build({ JEV_PLAYGROUND_STORAGE: 'local', JEV_PLAYGROUND_MOCK: '1', JEV_RUNS_DISABLED: '1' }))
    expect((await invoke(api.status, get())).body.runsEnabled).toBe(false)
    expect(await invoke(api.run, post(runSample))).toMatchObject({ status: 503, body: { error: 'RUNS_DISABLED' } })
  })
})

describe('createRuntime with Convex', () => {
  it('uses durable storage and signs continuations with the write secret', async () => {
    const runtime = await build({ CONVEX_URL, CONVEX_WRITE_SECRET: 'write-secret-123', JEV_PLAYGROUND_MOCK: '1' })
    expect(runtime.config.convex).toEqual({ url: CONVEX_URL, writeSecret: 'write-secret-123' })
    expect(runtime.internalSecret).toBe('write-secret-123')
    expect(runtime.limits).toBeDefined()
    expect((await invoke(createApi(runtime).status, get())).body).toMatchObject({ storage: true, classifier: 'mock' })
  })

  it('selects live providers when keys are present, and mock only for what has no key', async () => {
    const live = await build({ JEV_PLAYGROUND_STORAGE: 'local', JEV_API_KEY: 'jev', OPENROUTER_KEY: 'or' })
    expect((await invoke(createApi(live).status, get())).body).toMatchObject({ drafting: 'live', classifier: 'live' })
    const mixed = await build({ JEV_PLAYGROUND_STORAGE: 'local', JEV_API_KEY: 'jev', JEV_PLAYGROUND_MOCK: '1' })
    expect((await invoke(createApi(mixed).status, get())).body).toMatchObject({ drafting: 'mock', classifier: 'live' })
    const keyless = await build({ JEV_PLAYGROUND_STORAGE: 'local' })
    expect(await keyless.analysis.listRecent(1)).toEqual([])
  })
})

describe('selfOrigin', () => {
  const origin = async (env: Record<string, string>, headers: ApiRequest['headers'] = {}) => (await build(env)).selfOrigin({ headers } as ApiRequest)
  const vercel = { VERCEL: '1', VERCEL_URL: 'jev-git-feature-abc123.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'jev.example.com' }

  it('on Vercel production uses the production domain and ignores a spoofed Host header', async () => {
    expect(await origin({ ...vercel, VERCEL_ENV: 'production' }, { host: 'evil.example' })).toBe('https://jev.example.com')
    expect(await origin({ ...vercel, VERCEL_ENV: 'production' }, { host: 'localhost:3000', 'x-forwarded-host': 'evil.example' })).toBe('https://jev.example.com')
  })

  it('on Vercel production falls back to VERCEL_URL when there is no production URL', async () => {
    expect(await origin({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: 'only-deployment.vercel.app' })).toBe('https://only-deployment.vercel.app')
  })

  it('on Vercel preview and development uses the deployment URL, not the production domain', async () => {
    expect(await origin({ ...vercel, VERCEL_ENV: 'preview' }, { host: 'evil.example' })).toBe('https://jev-git-feature-abc123.vercel.app')
    expect(await origin({ ...vercel, VERCEL_ENV: 'development' })).toBe('https://jev-git-feature-abc123.vercel.app')
    expect(await origin({ ...vercel })).toBe('https://jev-git-feature-abc123.vercel.app')
  })

  it('on Vercel with no URL variables has no origin, rather than trusting Host', async () => {
    expect(await origin({ VERCEL: '1' }, { host: 'localhost:3000' })).toBeUndefined()
    expect(await origin({ VERCEL: '1', VERCEL_ENV: 'production' }, { host: 'evil.example' })).toBeUndefined()
  })

  it('lets JEV_PUBLIC_ORIGIN override, trimming trailing slashes', async () => {
    expect(await origin({ ...vercel, VERCEL_ENV: 'production', JEV_PUBLIC_ORIGIN: 'https://playground.example.org/' }, { host: 'evil.example' })).toBe('https://playground.example.org')
    expect(await origin({ JEV_PUBLIC_ORIGIN: 'http://localhost:8080' })).toBe('http://localhost:8080')
  })

  it.each(['playground.example.org', 'https://example.org/with/path', 'ftp://example.org', 'javascript:alert(1)', 'https://exa mple.org', 'https://'])(
    'ignores an unusable JEV_PUBLIC_ORIGIN (%s)',
    async (value) => {
      expect(await origin({ ...vercel, VERCEL_ENV: 'production', JEV_PUBLIC_ORIGIN: value })).toBe('https://jev.example.com')
      expect(await origin({ JEV_PUBLIC_ORIGIN: value }, { host: 'evil.example' })).toBeUndefined()
    },
  )

  it.each([
    ['localhost', 'http://localhost'],
    ['localhost:3000', 'http://localhost:3000'],
    ['127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['127.0.0.1', 'http://127.0.0.1'],
    ['[::1]:3000', 'http://[::1]:3000'],
  ])('off Vercel trusts the local Host %s', async (host, expected) => {
    expect(await origin({}, { host })).toBe(expected)
  })

  it.each([
    'evil.example',
    'evil.example:3000',
    'localhost.evil.example',
    'localhost:3000.evil.example',
    'localhost@evil.example',
    'localhost:3000@evil.example',
    'evil.example/localhost',
    'localhost:abc',
    '127.0.0.1.evil.example',
    '10.0.0.5:3000',
    '0.0.0.0:3000',
    'LOCALHOST.evil.example',
    '',
  ])('off Vercel does not trust Host %j', async (host) => {
    expect(await origin({}, { host })).toBeUndefined()
  })

  it('off Vercel with no Host header has no origin, and takes the first of repeated Host headers', async () => {
    expect(await origin({}, {})).toBeUndefined()
    expect(await origin({}, { host: ['localhost:3000', 'evil.example'] })).toBe('http://localhost:3000')
    expect(await origin({}, { host: ['evil.example', 'localhost:3000'] })).toBeUndefined()
  })

  it('is exposed on the runtime and reads the env given to createRuntime, not process.env', async () => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_URL', 'from-process-env.vercel.app')
    const runtime = await build({ JEV_PLAYGROUND_STORAGE: 'local' })
    expect(runtime.selfOrigin({ headers: { host: 'localhost:3000' } } as ApiRequest)).toBe('http://localhost:3000')
  })
})

describe('error text', () => {
  it('uses ApiError for the fail-closed answers, so the message is user-safe', async () => {
    const runtime = await build({})
    await expect(runtime.analysis.start(runSample, 'c')).rejects.toBeInstanceOf(ApiError)
  })
})
