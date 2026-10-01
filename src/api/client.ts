import type {
  AnalysisBrowseItem,
  AnalysisClass,
  AnalysisDraftResult,
  AnalysisPage,
  AnalysisStartResult,
} from '../shared/analysis'
import type { DatasetBrowseItem, DatasetPreview, PlaygroundStatus } from '../shared/dataset'

/** An API failure with a message that is safe and useful to show. */
export class ApiClientError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean

  constructor(code: string, message: string, status: number, retryable: boolean) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

const FALLBACK: Record<number, string> = {
  413: 'That file is too large for this playground.',
  429: 'Too many requests. Please wait a moment and try again.',
}

const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new ApiClientError('NETWORK', 'Could not reach the server. Check your connection and try again.', 0, true)
  }
  let body: unknown
  try { body = await response.json() } catch { body = undefined }
  if (!response.ok) {
    const record = (typeof body === 'object' && body !== null ? body : {}) as { error?: unknown; message?: unknown; retryable?: unknown }
    const code = typeof record.error === 'string' && /^[A-Z0-9_]{2,64}$/.test(record.error) ? record.error : 'REQUEST_FAILED'
    const message = typeof record.message === 'string' && record.message.trim() && record.message.length <= 300
      ? record.message.trim()
      : FALLBACK[response.status] ?? 'Something went wrong. Please try again.'
    throw new ApiClientError(code, message, response.status, record.retryable === true || response.status >= 500)
  }
  if (body === undefined) throw new ApiClientError('BAD_RESPONSE', 'The server sent an unreadable response. Please try again.', response.status, true)
  return body as T
}

const post = <T,>(url: string, body: unknown): Promise<T> => request<T>(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export interface PlaygroundApi {
  status(): Promise<PlaygroundStatus>
  uploadCsv(file: Blob, filename: string): Promise<DatasetPreview>
  datasetFromUrl(url: string): Promise<DatasetPreview>
  draft(input: { datasetId: string; task: string; labelColumn?: string }): Promise<AnalysisDraftResult>
  start(input: { datasetId: string; query: string; classes: AnalysisClass[]; labelColumn?: string }): Promise<AnalysisStartResult>
  read(analysisId: string, after: number): Promise<AnalysisPage>
  cancel(analysisId: string, controlToken: string): Promise<void>
  resume(analysisId: string, controlToken: string): Promise<void>
  browse(): Promise<{ analyses: AnalysisBrowseItem[]; datasets: DatasetBrowseItem[] }>
}

export const playgroundApi: PlaygroundApi = {
  status: () => request('/api/status'),
  uploadCsv: (file, filename) => request(`/api/datasets/upload?filename=${encodeURIComponent(filename)}`, {
    method: 'POST',
    // Raw bytes: no JSON inflation, and the platform hands the function a Buffer.
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  }),
  datasetFromUrl: (url) => post('/api/datasets/from-url', { url }),
  draft: (input) => post('/api/analysis/draft', input),
  start: (input) => post('/api/analysis/run', input),
  read: (analysisId, after) => request(`/api/analysis/${encodeURIComponent(analysisId)}?after=${after}`),
  cancel: async (analysisId, controlToken) => { await post('/api/analysis/cancel', { analysisId, controlToken }) },
  resume: async (analysisId, controlToken) => { await post('/api/analysis/resume', { analysisId, controlToken }) },
  browse: () => request('/api/browse'),
}
