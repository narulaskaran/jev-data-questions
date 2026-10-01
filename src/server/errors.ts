import { DatasetError } from '../dataset/csvTypes.js'

/** An error that is safe to show to a browser: a stable code plus a plain sentence. */
export class ApiError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(code: string, message: string, statusCode = 400, options: { retryable?: boolean; retryAfterMs?: number } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = statusCode
    this.retryable = options.retryable ?? false
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs
  }
}

export interface PublicError {
  statusCode: number
  body: { error: string; message: string; retryable?: boolean }
  retryAfterSeconds?: number
}

const STABLE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/

/**
 * Only `ApiError` and `DatasetError` carry text written for users. Anything
 * else (provider SDK errors, Convex dumps) is replaced wholesale so a secret
 * embedded in an upstream message can never be echoed.
 */
export const toPublicError = (error: unknown): PublicError => {
  if (error instanceof ApiError && STABLE_CODE.test(error.code)) {
    return {
      statusCode: error.statusCode,
      body: { error: error.code, message: error.message, ...(error.retryable ? { retryable: true } : {}) },
      ...(error.retryAfterMs !== undefined ? { retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterMs / 1000)) } : {}),
    }
  }
  if (error instanceof DatasetError && STABLE_CODE.test(error.code)) {
    return { statusCode: error.statusCode, body: { error: error.code, message: error.message } }
  }
  return { statusCode: 500, body: { error: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.', retryable: true } }
}

export const errorName = (error: unknown): string => (
  error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(error.name) ? error.name : 'Error'
)
