import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { CSV_MAX_BYTES, CSV_MAX_COLUMNS, DatasetError } from '../dataset/csvTypes.js'
import { isTerminalStatus } from '../shared/analysis.js'
import type { PlaygroundStatus } from '../shared/dataset.js'
import type { AnalysisService } from './analysis.js'
import type { RuntimeConfig } from './config.js'
import type { DatasetService } from './datasets.js'
import { ApiError, errorName, toPublicError } from './errors.js'
import type { LimitsStorage } from '../shared/analysis.js'

type HeaderValue = string | string[] | undefined

/** The subset of Vercel's Node request/response that the handlers rely on. */
export interface ApiRequest {
  method?: string
  headers: Record<string, HeaderValue>
  query?: Record<string, HeaderValue>
  body?: unknown
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>
}

export interface ApiResponse {
  status(code: number): ApiResponse
  setHeader(name: string, value: string): unknown
  json(body: unknown): unknown
}

export type ApiHandler = (request: ApiRequest, response: ApiResponse) => Promise<void>

export interface ApiRuntime {
  config: RuntimeConfig
  datasets: DatasetService
  analysis: AnalysisService
  limits?: LimitsStorage
  /** Secret for signing internal continuation calls and hashing client addresses. */
  internalSecret: string
  /** Keep work alive after the response (Vercel `waitUntil`). */
  schedule(task: Promise<unknown>): void
  /** Origin this deployment can call itself on, or undefined when it cannot. */
  selfOrigin(request: ApiRequest): string | undefined
  fetch?: typeof fetch
}

const HOUR_MS = 60 * 60_000
const INTERNAL_HEADER = 'x-jev-internal'
const BYPASS_HEADER = 'x-vercel-protection-bypass'

const header = (request: ApiRequest, name: string): string | undefined => {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

const queryValue = (request: ApiRequest, name: string): string | undefined => {
  const value = request.query?.[name]
  return Array.isArray(value) ? value[0] : value
}

const jsonBody = (request: ApiRequest): Record<string, unknown> => {
  let body = request.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { throw new ApiError('INVALID_JSON', 'The request body is not valid JSON.') }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body) || Buffer.isBuffer(body)) throw new ApiError('INVALID_BODY', 'The request body must be a JSON object.')
  return body as Record<string, unknown>
}

/** Raw upload bytes, whether the platform pre-read the body or left it on the stream. Capped while reading. */
const rawBody = async (request: ApiRequest): Promise<Uint8Array> => {
  const tooLarge = () => new DatasetError('CSV_TOO_LARGE', 'That file is over the 4 MB limit.', 413)
  const declared = Number(header(request, 'content-length') ?? '0')
  if (Number.isFinite(declared) && declared > CSV_MAX_BYTES) throw tooLarge()
  const body = request.body
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    if (body.byteLength > CSV_MAX_BYTES) throw tooLarge()
    return body
  }
  if (typeof body === 'string') {
    const bytes = Buffer.from(body, 'utf8')
    if (bytes.byteLength > CSV_MAX_BYTES) throw tooLarge()
    return bytes
  }
  if (typeof request[Symbol.asyncIterator] !== 'function') return new Uint8Array()
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<unknown>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array | string)
    size += buffer.byteLength
    if (size > CSV_MAX_BYTES) throw tooLarge()
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

const send = (response: ApiResponse, statusCode: number, body: unknown, cacheControl = 'no-store'): void => {
  response.setHeader('Cache-Control', cacheControl)
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.status(statusCode).json(body)
}

const fail = (response: ApiResponse, error: unknown, route: string): void => {
  const shaped = toPublicError(error)
  if (shaped.statusCode >= 500) console.error(`[api] ${route} failed`, { code: shaped.body.error, name: errorName(error) })
  if (shaped.retryAfterSeconds) response.setHeader('Retry-After', String(shaped.retryAfterSeconds))
  send(response, shaped.statusCode, shaped.body)
}

const route = (name: string, method: 'GET' | 'POST', handle: ApiHandler): ApiHandler => async (request, response) => {
  if (request.method !== method) {
    response.setHeader('Allow', method)
    send(response, 405, { error: 'METHOD_NOT_ALLOWED', message: `Use ${method}.` })
    return
  }
  try {
    await handle(request, response)
  } catch (error) {
    fail(response, error, name)
  }
}

export const continuationToken = (secret: string, analysisId: string): string => createHmac('sha256', secret).update(`continue:${analysisId}`).digest('hex')

const sameToken = (left: string, right: string): boolean => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const createApi = (runtime: ApiRuntime) => {
  const { config, datasets, analysis } = runtime

  /** A stable, non-reversible key per client address for rate limiting. */
  const clientKey = (request: ApiRequest): string => {
    const forwarded = header(request, 'x-forwarded-for')?.split(',')[0]?.trim()
    const address = forwarded || header(request, 'x-real-ip') || 'unknown'
    return createHash('sha256').update(`${runtime.internalSecret}:${address}`).digest('hex').slice(0, 24)
  }

  const status = (): PlaygroundStatus => ({
    storage: datasets.storageReady,
    drafting: config.openRouterKey ? 'live' : config.allowMock ? 'mock' : 'off',
    classifier: config.jevApiKey ? 'live' : config.allowMock ? 'mock' : 'off',
    runsEnabled: !config.runsDisabled,
    limits: { maxRows: config.maxRowsPerRun, maxBytes: CSV_MAX_BYTES, maxColumns: CSV_MAX_COLUMNS },
  })

  const requestContinuation = async (analysisId: string, origin: string | undefined): Promise<void> => {
    if (!origin) {
      console.error('[analysis] no self origin; run will wait for a manual resume', { analysisId })
      return
    }
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await (runtime.fetch ?? fetch)(`${origin}/api/analysis/continue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [INTERNAL_HEADER]: continuationToken(runtime.internalSecret, analysisId),
            ...(bypass ? { [BYPASS_HEADER]: bypass } : {}),
          },
          body: JSON.stringify({ analysisId }),
        })
        if (result.ok) return
        console.error('[analysis] continuation rejected', { analysisId, status: result.status, attempt })
      } catch (error) {
        console.error('[analysis] continuation failed', { analysisId, name: errorName(error), attempt })
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }

  /** Run one bounded chunk, then ask a fresh invocation to carry on. */
  const drive = (analysisId: string, origin: string | undefined, resumeErrors = false): Promise<void> => (
    analysis.runChunk(analysisId, config.chunkBudgetMs, { resumeErrors })
      .then((outcome) => (outcome === 'continue' ? requestContinuation(analysisId, origin) : undefined))
      .catch((error) => { console.error('[analysis] drive failed', { analysisId, name: errorName(error) }) })
  )

  const rateLimitUpload = async (request: ApiRequest): Promise<void> => {
    if (!runtime.limits) return
    const result = await runtime.limits.consumeRate(`upload:${clientKey(request)}`, config.uploadsPerHour, HOUR_MS)
    if (!result.allowed) throw new ApiError('RATE_LIMITED', 'You have reached this playground\'s hourly upload limit. Please try again later.', 429, { retryable: true, retryAfterMs: result.retryAfterMs })
  }

  return {
    status: route('status', 'GET', async (_request, response) => {
      send(response, 200, status())
    }),

    upload: route('datasets/upload', 'POST', async (request, response) => {
      if (!datasets.storageReady) throw new ApiError('STORAGE_NOT_CONFIGURED', 'This deployment has no storage configured, so only the sample dataset is available.', 503)
      await rateLimitUpload(request)
      const bytes = await rawBody(request)
      if (bytes.byteLength === 0) throw new DatasetError('CSV_EMPTY', 'That file is empty.')
      send(response, 201, await datasets.fromCsvBytes(bytes, queryValue(request, 'filename')))
    }),

    fromUrl: route('datasets/from-url', 'POST', async (request, response) => {
      if (!datasets.storageReady) throw new ApiError('STORAGE_NOT_CONFIGURED', 'This deployment has no storage configured, so only the sample dataset is available.', 503)
      const body = jsonBody(request)
      if (typeof body.url !== 'string') throw new DatasetError('URL_NOT_PUBLIC', 'Paste a public https:// link to a CSV file.')
      await rateLimitUpload(request)
      send(response, 201, await datasets.fromPublicUrl(body.url))
    }),

    dataset: route('datasets/read', 'GET', async (request, response) => {
      const datasetId = queryValue(request, 'datasetId')
      if (!datasetId) throw new DatasetError('DATASET_NOT_FOUND', 'That dataset was not found.', 404)
      // Datasets are immutable once stored.
      send(response, 200, await datasets.getPreview(datasetId), 'public, max-age=300, s-maxage=86400')
    }),

    draft: route('analysis/draft', 'POST', async (request, response) => {
      const body = jsonBody(request)
      send(response, 200, await analysis.draft({
        datasetId: body.datasetId as string,
        task: body.task as string,
        labelColumn: body.labelColumn as string | undefined,
      }, clientKey(request)))
    }),

    run: route('analysis/run', 'POST', async (request, response) => {
      const body = jsonBody(request)
      const started = await analysis.start({
        datasetId: body.datasetId as string,
        query: body.query as string,
        classes: body.classes as never,
        labelColumn: body.labelColumn as string | undefined,
      }, clientKey(request))
      runtime.schedule(drive(started.analysis.analysisId, runtime.selfOrigin(request)))
      send(response, 202, started)
    }),

    read: route('analysis/read', 'GET', async (request, response) => {
      const analysisId = queryValue(request, 'analysisId') ?? ''
      const afterRaw = queryValue(request, 'after')
      const after = afterRaw === undefined ? -1 : Number(afterRaw)
      const page = await analysis.read(analysisId, after)
      // A finished run's pages never change, so let the CDN absorb share traffic.
      send(response, 200, page, isTerminalStatus(page.analysis.status) ? 'public, max-age=60, s-maxage=86400' : 'no-store')
    }),

    cancel: route('analysis/cancel', 'POST', async (request, response) => {
      const body = jsonBody(request)
      await analysis.cancel(body.analysisId, body.controlToken)
      send(response, 200, { ok: true })
    }),

    resume: route('analysis/resume', 'POST', async (request, response) => {
      const body = jsonBody(request)
      const record = await analysis.authorizeResume(body.analysisId, body.controlToken)
      runtime.schedule(drive(record.analysisId, runtime.selfOrigin(request), true))
      send(response, 202, { ok: true })
    }),

    /** Internal: one invocation hands the run to the next. Never resumes a stopped run. */
    continue: route('analysis/continue', 'POST', async (request, response) => {
      const body = jsonBody(request)
      const analysisId = typeof body.analysisId === 'string' ? body.analysisId : ''
      const token = header(request, INTERNAL_HEADER) ?? ''
      if (!analysisId || !sameToken(token, continuationToken(runtime.internalSecret, analysisId))) throw new ApiError('FORBIDDEN', 'Not allowed.', 403)
      runtime.schedule(drive(analysisId, runtime.selfOrigin(request)))
      send(response, 202, { ok: true })
    }),

    browse: route('browse', 'GET', async (_request, response) => {
      const [analyses, recentDatasets] = await Promise.all([analysis.listRecent(24), datasets.listRecent(24)])
      send(response, 200, { analyses, datasets: recentDatasets }, 'public, max-age=15, s-maxage=30')
    }),
  }
}

export type Api = ReturnType<typeof createApi>
