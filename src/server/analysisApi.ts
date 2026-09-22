import { DatasetError } from '../dataset/csvTypes.js'
import { AnalysisError, type AnalysisService } from './analysis.js'
import type { AnalysisSnapshot } from '../shared/analysis.js'

export interface AnalysisApiRequest {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
  query?: Record<string, string | string[] | undefined>
}

export interface AnalysisApiResponse {
  status: (code: number) => AnalysisApiResponse
  json: (body: unknown) => AnalysisApiResponse
  setHeader: (name: string, value: string) => AnalysisApiResponse
  end: () => void
}

export type AnalysisApiHandler = (request: AnalysisApiRequest, response: AnalysisApiResponse) => Promise<void>

const queryValue = (request: AnalysisApiRequest, name: string): string | undefined => {
  const value = request.query?.[name]
  return Array.isArray(value) ? value[0] : value
}

const parseBody = (body: unknown): Record<string, unknown> | undefined => {
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { return undefined }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  return body as Record<string, unknown>
}

const applyHeaders = (response: AnalysisApiResponse): void => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json')
}

const errorShape = (error: unknown): { statusCode: number; code: string } | undefined => {
  if (error instanceof DatasetError || error instanceof AnalysisError) {
    return { statusCode: error.statusCode, code: error.code }
  }
  if (typeof error === 'object' && error !== null && 'statusCode' in error && 'code' in error) {
    const statusCode = error.statusCode
    const code = error.code
    if (typeof statusCode === 'number' && typeof code === 'string') return { statusCode, code }
  }
  return undefined
}

const errorResponse = (response: AnalysisApiResponse, error: unknown): void => {
  const shaped = errorShape(error)
  response.status(shaped?.statusCode ?? 500).json({ error: shaped?.code ?? 'ANALYSIS_UNAVAILABLE' })
}

const snapshotBody = (snapshot: AnalysisSnapshot): AnalysisSnapshot => snapshot

export const createAnalysisDraftHandler = (service: AnalysisService): AnalysisApiHandler => async (request, response) => {
  applyHeaders(response)
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const body = parseBody(request.body)
  if (!body) {
    response.status(400).json({ error: typeof request.body === 'string' ? 'INVALID_JSON' : 'INVALID_BODY' })
    return
  }
  try {
    const result = await service.draft({
      fixtureId: typeof body.fixtureId === 'string' ? body.fixtureId : undefined,
      datasetId: typeof body.datasetId === 'string' ? body.datasetId : undefined,
      task: body.task as string,
    })
    if (result.metadata.cacheWrite === 'ok' || result.metadata.cacheWrite === 'skipped') {
      response.setHeader('X-Analysis-Cache-Write', result.metadata.cacheWrite)
    }
    response.status(200).json(result)
  } catch (error) {
    errorResponse(response, error)
  }
}

export const createAnalysisProposeHandler = (service: AnalysisService): AnalysisApiHandler => async (request, response) => {
  applyHeaders(response)
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const body = parseBody(request.body)
  if (!body) {
    response.status(400).json({ error: typeof request.body === 'string' ? 'INVALID_JSON' : 'INVALID_BODY' })
    return
  }
  try {
    const result = await service.propose({
      fixtureId: typeof body.fixtureId === 'string' ? body.fixtureId : undefined,
      datasetId: typeof body.datasetId === 'string' ? body.datasetId : undefined,
    })
    response.status(200).json(result)
  } catch (error) {
    errorResponse(response, error)
  }
}

export const createAnalysisRunHandler = (service: AnalysisService, options: { schedule?: (task: Promise<unknown>) => void } = {}): AnalysisApiHandler => async (request, response) => {
  applyHeaders(response)
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const body = parseBody(request.body)
  if (!body) {
    response.status(400).json({ error: typeof request.body === 'string' ? 'INVALID_JSON' : 'INVALID_BODY' })
    return
  }
  try {
    const snapshot = await service.start({
      fixtureId: typeof body.fixtureId === 'string' ? body.fixtureId : undefined,
      datasetId: typeof body.datasetId === 'string' ? body.datasetId : undefined,
      query: body.query as string,
      analysisId: body.analysisId as string | undefined,
      classes: Array.isArray(body.classes) ? body.classes as string[] : undefined,
      questionKind: body.questionKind === 'noul' || body.questionKind === 'score' || body.questionKind === 'choice' ? body.questionKind : undefined,
      forceNew: body.forceNew === true,
      resume: body.resume === true,
    })
    if (snapshot.status === 'complete') {
      response.status(200).json(snapshotBody(snapshot))
      return
    }
    const execution = service.run(snapshot.analysisId)
    if (options.schedule) {
      try {
        options.schedule(execution.catch(() => undefined))
      } catch {
        await execution
      }
    } else {
      await execution
    }
    response.status(202).json(snapshotBody(snapshot))
  } catch (error) {
    errorResponse(response, error)
  }
}

export const createAnalysisReadHandler = (service: AnalysisService, options: { share?: boolean } = {}): AnalysisApiHandler => async (request, response) => {
  applyHeaders(response)
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' })
    return
  }
  const analysisId = queryValue(request, 'analysisId') ?? queryValue(request, 'id')
  if (!analysisId) {
    response.status(400).json({ error: 'INVALID_ANALYSIS_ID' })
    return
  }
  try {
    const snapshot = options.share ? await service.share(analysisId) : await service.get(analysisId)
    response.status(200).json(snapshotBody(snapshot))
  } catch (error) {
    errorResponse(response, error)
  }
}
