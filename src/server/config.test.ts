// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ANALYSIS_MAX_ROWS } from '../shared/analysis'
import { readConvexUrl, readRuntimeConfig } from './config'

const URL_OK = 'https://happy-animal-123.convex.cloud'
const config = (env: Record<string, string | undefined>) => readRuntimeConfig(env as NodeJS.ProcessEnv)
const convexUrl = (env: Record<string, string | undefined>) => readConvexUrl(env as NodeJS.ProcessEnv)

describe('readRuntimeConfig defaults', () => {
  it('is fully closed and conservative with an empty environment', () => {
    expect(config({})).toEqual({
      convex: undefined,
      localStorage: false,
      allowMock: false,
      jevApiKey: undefined,
      jevBaseUrl: undefined,
      openRouterKey: undefined,
      openRouterModel: 'openai/gpt-4o-mini',
      runsDisabled: false,
      maxRowsPerRun: ANALYSIS_MAX_ROWS,
      dailyCallBudget: 20_000,
      runsPerHour: 10,
      draftsPerHour: 30,
      uploadsPerHour: 20,
      concurrency: 2,
      chunkBudgetMs: 40_000,
    })
    expect(config({})).not.toHaveProperty('convex')
  })

  it('reads provider settings, trimming whitespace and treating blanks as unset', () => {
    const result = config({
      JEV_API_KEY: '  jev-key  ',
      TYPESAFE_BASE_URL: ' https://typesafe.test ',
      OPENROUTER_KEY: 'or-key',
      OPENROUTER_MODEL: ' anthropic/claude-x ',
    })
    expect(result).toMatchObject({ jevApiKey: 'jev-key', jevBaseUrl: 'https://typesafe.test', openRouterKey: 'or-key', openRouterModel: 'anthropic/claude-x' })
    const blank = config({ JEV_API_KEY: '   ', OPENROUTER_KEY: '', OPENROUTER_MODEL: ' ', TYPESAFE_BASE_URL: '' })
    expect(blank).toMatchObject({ jevApiKey: undefined, openRouterKey: undefined, jevBaseUrl: undefined, openRouterModel: 'openai/gpt-4o-mini' })
  })
})

describe('Convex configuration', () => {
  it('needs BOTH a valid *.convex.cloud URL and the write secret', () => {
    expect(config({ CONVEX_URL: URL_OK, CONVEX_WRITE_SECRET: 's3cret' }).convex).toEqual({ url: URL_OK, writeSecret: 's3cret' })
    expect(config({ CONVEX_URL: URL_OK }).convex).toBeUndefined()
    expect(config({ CONVEX_WRITE_SECRET: 's3cret' }).convex).toBeUndefined()
    expect(config({ CONVEX_URL: URL_OK, CONVEX_WRITE_SECRET: '   ' }).convex).toBeUndefined()
    expect(config({ CONVEX_URL: 'https://evil.example', CONVEX_WRITE_SECRET: 's3cret' }).convex).toBeUndefined()
  })

  it('accepts VITE_CONVEX_URL as an alias, preferring CONVEX_URL', () => {
    expect(config({ VITE_CONVEX_URL: URL_OK, CONVEX_WRITE_SECRET: 's' }).convex?.url).toBe(URL_OK)
    expect(convexUrl({ CONVEX_URL: 'https://first-one-1.convex.cloud', VITE_CONVEX_URL: 'https://second-one-2.convex.cloud' })).toBe('https://first-one-1.convex.cloud')
  })

  it('trims whitespace and trailing slashes', () => {
    expect(convexUrl({ CONVEX_URL: `  ${URL_OK}/  ` })).toBe(URL_OK)
    expect(convexUrl({ CONVEX_URL: `${URL_OK}///` })).toBe(URL_OK)
    expect(convexUrl({ CONVEX_URL: 'https://UPPER-case-1.CONVEX.CLOUD' })).toBe('https://UPPER-case-1.CONVEX.CLOUD')
  })

  it.each([
    ['plain http', 'http://happy-animal-123.convex.cloud'],
    ['a different host', 'https://happy-animal-123.example.com'],
    ['the .site host', 'https://happy-animal-123.convex.site'],
    ['a look-alike suffix', 'https://happy-animal-123.convex.cloud.evil.com'],
    ['a look-alike prefix', 'https://evil.com/happy.convex.cloud'],
    ['a path', 'https://happy-animal-123.convex.cloud/api'],
    ['a query string', 'https://happy-animal-123.convex.cloud?x=1'],
    ['a port', 'https://happy-animal-123.convex.cloud:8443'],
    ['credentials', 'https://user:pw@happy-animal-123.convex.cloud'],
    ['no deployment name', 'https://convex.cloud'],
    ['an empty subdomain', 'https://.convex.cloud'],
    ['a subdomain starting with a dash', 'https://-bad.convex.cloud'],
    ['no scheme', 'happy-animal-123.convex.cloud'],
    ['a nested subdomain', 'https://a.b.convex.cloud'],
    ['an embedded newline', 'https://happy-animal-123.convex.cloud\n.evil.com'],
  ])('rejects %s', (_label, value) => {
    expect(convexUrl({ CONVEX_URL: value })).toBeUndefined()
    expect(convexUrl({ VITE_CONVEX_URL: value })).toBeUndefined()
    expect(config({ CONVEX_URL: value, CONVEX_WRITE_SECRET: 's' }).convex).toBeUndefined()
  })

  it('falls back to the alias when CONVEX_URL itself is unusable', () => {
    expect(convexUrl({ CONVEX_URL: 'http://nope.convex.cloud', VITE_CONVEX_URL: URL_OK })).toBe(URL_OK)
  })
})

describe('process-local storage', () => {
  it('is enabled only by JEV_PLAYGROUND_STORAGE=local', () => {
    expect(config({ JEV_PLAYGROUND_STORAGE: 'local' }).localStorage).toBe(true)
    for (const value of ['', 'memory', 'true', '1', 'convex']) expect(config({ JEV_PLAYGROUND_STORAGE: value }).localStorage).toBe(false)
  })

  it('is ignored on Vercel', () => {
    expect(config({ JEV_PLAYGROUND_STORAGE: 'local', VERCEL: '1' }).localStorage).toBe(false)
    expect(config({ JEV_PLAYGROUND_STORAGE: 'local', VERCEL: '' }).localStorage).toBe(true)
  })

  it('is ignored when Convex is fully configured, but not when it is only half configured', () => {
    expect(config({ JEV_PLAYGROUND_STORAGE: 'local', CONVEX_URL: URL_OK, CONVEX_WRITE_SECRET: 's' })).toMatchObject({ localStorage: false, convex: { url: URL_OK } })
    expect(config({ JEV_PLAYGROUND_STORAGE: 'local', CONVEX_URL: URL_OK }).localStorage).toBe(true)
    expect(config({ JEV_PLAYGROUND_STORAGE: 'local', CONVEX_WRITE_SECRET: 's' }).localStorage).toBe(true)
  })
})

describe('mock providers', () => {
  it('are enabled only by an explicit truthy flag', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' On ']) expect(config({ JEV_PLAYGROUND_MOCK: value }).allowMock).toBe(true)
    for (const value of [undefined, '', '0', 'false', 'no', 'off', '2', 'enabled', 'truthy']) expect(config({ JEV_PLAYGROUND_MOCK: value }).allowMock).toBe(false)
  })

  it('are not implied by missing keys or local storage', () => {
    expect(config({ JEV_PLAYGROUND_STORAGE: 'local' }).allowMock).toBe(false)
    expect(config({ JEV_PLAYGROUND_STORAGE: 'local', JEV_API_KEY: '', OPENROUTER_KEY: '' }).allowMock).toBe(false)
  })
})

describe('runs disabled flag', () => {
  it('uses the same strict flag parsing', () => {
    expect(config({ JEV_RUNS_DISABLED: 'true' }).runsDisabled).toBe(true)
    expect(config({ JEV_RUNS_DISABLED: '0' }).runsDisabled).toBe(false)
    expect(config({}).runsDisabled).toBe(false)
  })
})

describe('integer settings', () => {
  const cases: Array<[string, keyof ReturnType<typeof config>, number, number, number]> = [
    ['JEV_MAX_ROWS_PER_RUN', 'maxRowsPerRun', ANALYSIS_MAX_ROWS, 1, ANALYSIS_MAX_ROWS],
    ['JEV_DAILY_CALL_BUDGET', 'dailyCallBudget', 20_000, 0, 10_000_000],
    ['JEV_RUNS_PER_HOUR', 'runsPerHour', 10, 1, 10_000],
    ['JEV_DRAFTS_PER_HOUR', 'draftsPerHour', 30, 1, 10_000],
    ['JEV_CONCURRENCY', 'concurrency', 2, 1, 8],
    ['JEV_CHUNK_BUDGET_MS', 'chunkBudgetMs', 40_000, 500, 600_000],
  ]

  it.each(cases)('%s accepts its inclusive bounds, trims, and falls back on garbage or out-of-range', (name, key, fallback, minimum, maximum) => {
    const read = (value: string | undefined) => config({ [name]: value })[key]
    expect(read(String(minimum))).toBe(minimum)
    expect(read(String(maximum))).toBe(maximum)
    expect(read(`  ${maximum}  `)).toBe(maximum)
    expect(read(undefined)).toBe(fallback)
    for (const garbage of ['', '   ', 'abc', '12abc', '1.5', 'NaN', 'Infinity', '-Infinity', '1_000', '--1']) expect(read(garbage)).toBe(fallback)
    expect(read(String(minimum - 1))).toBe(fallback)
    expect(read(String(maximum + 1))).toBe(fallback)
    expect(read('99999999999999999999')).toBe(fallback)
  })

  it('treats a zero daily budget as a valid "no live calls" setting', () => {
    expect(config({ JEV_DAILY_CALL_BUDGET: '0' }).dailyCallBudget).toBe(0)
  })

  it('reads several settings independently', () => {
    expect(config({ JEV_CONCURRENCY: '8', JEV_RUNS_PER_HOUR: 'oops', JEV_MAX_ROWS_PER_RUN: '100' })).toMatchObject({ concurrency: 8, runsPerHour: 10, maxRowsPerRun: 100 })
  })
})
