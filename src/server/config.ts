import { ANALYSIS_MAX_ROWS } from '../shared/analysis.js'

const CONVEX_CLOUD_URL = /^https:\/\/[a-z0-9][a-z0-9-]*\.convex\.cloud$/i

type Env = NodeJS.ProcessEnv

const text = (env: Env, name: string): string | undefined => {
  const value = env[name]?.trim()
  return value || undefined
}

const flag = (env: Env, name: string): boolean => /^(1|true|yes|on)$/i.test(env[name]?.trim() ?? '')

const integer = (env: Env, name: string, fallback: number, minimum: number, maximum: number): number => {
  const raw = text(env, name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) return fallback
  return value
}

export interface RuntimeConfig {
  convex?: { url: string; writeSecret: string }
  /** Process-local stores. Only for a single local dev process; never honoured on Vercel. */
  localStorage: boolean
  /** Simulated drafting and classification when a provider key is absent. Explicit opt-in. */
  allowMock: boolean
  jevApiKey?: string
  jevBaseUrl?: string
  openRouterKey?: string
  openRouterModel: string
  runsDisabled: boolean
  maxRowsPerRun: number
  dailyCallBudget: number
  runsPerHour: number
  draftsPerHour: number
  uploadsPerHour: number
  concurrency: number
  /** How long one function invocation keeps classifying before handing off. */
  chunkBudgetMs: number
}

/**
 * `CONVEX_URL` is preferred; Convex's Vite/Vercel integration provisions
 * `VITE_CONVEX_URL`, so that is accepted as an alias. The URL is not a secret.
 */
export const readConvexUrl = (env: Env = process.env): string | undefined => {
  for (const name of ['CONVEX_URL', 'VITE_CONVEX_URL']) {
    const value = text(env, name)?.replace(/\/+$/, '')
    if (value && CONVEX_CLOUD_URL.test(value)) return value
  }
  return undefined
}

export const readRuntimeConfig = (env: Env = process.env): RuntimeConfig => {
  const convexUrl = readConvexUrl(env)
  const writeSecret = text(env, 'CONVEX_WRITE_SECRET')
  const onVercel = Boolean(text(env, 'VERCEL'))
  const local = text(env, 'JEV_PLAYGROUND_STORAGE') === 'local' && !onVercel
  return {
    ...(convexUrl && writeSecret ? { convex: { url: convexUrl, writeSecret } } : {}),
    localStorage: local && !(convexUrl && writeSecret),
    allowMock: flag(env, 'JEV_PLAYGROUND_MOCK'),
    jevApiKey: text(env, 'JEV_API_KEY'),
    jevBaseUrl: text(env, 'TYPESAFE_BASE_URL'),
    openRouterKey: text(env, 'OPENROUTER_KEY'),
    openRouterModel: text(env, 'OPENROUTER_MODEL') ?? 'openai/gpt-4o-mini',
    runsDisabled: flag(env, 'JEV_RUNS_DISABLED'),
    maxRowsPerRun: integer(env, 'JEV_MAX_ROWS_PER_RUN', ANALYSIS_MAX_ROWS, 1, ANALYSIS_MAX_ROWS),
    dailyCallBudget: integer(env, 'JEV_DAILY_CALL_BUDGET', 20_000, 0, 10_000_000),
    runsPerHour: integer(env, 'JEV_RUNS_PER_HOUR', 10, 1, 10_000),
    draftsPerHour: integer(env, 'JEV_DRAFTS_PER_HOUR', 30, 1, 10_000),
    uploadsPerHour: integer(env, 'JEV_UPLOADS_PER_HOUR', 20, 1, 10_000),
    concurrency: integer(env, 'JEV_CONCURRENCY', 2, 1, 8),
    chunkBudgetMs: integer(env, 'JEV_CHUNK_BUDGET_MS', 40_000, 500, 600_000),
  }
}
