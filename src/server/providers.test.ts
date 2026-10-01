// @vitest-environment node
import { APIConnectionError, APIError, APITimeoutError } from '@typesafe-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisClass } from '../shared/analysis'
import { ApiError } from './errors'
import {
  JEV_MODEL,
  JevClassifier,
  MOCK_MODEL,
  MockClassifier,
  MockDraftProvider,
  OPENROUTER_ENDPOINT,
  OpenRouterDraftProvider,
  boundedSampleRows,
  normalizeClasses,
  parseJevAnswer,
  type ClassifyRequest,
  type DraftRequest,
  type JevClient,
} from './providers'

const API_KEY = 'sk-or-v1-TOP-SECRET-KEY'

const draftRequest = (overrides: Partial<DraftRequest> = {}): DraftRequest => ({
  task: 'Find urgent tickets',
  datasetName: 'Tickets',
  columns: ['subject', 'body'],
  sampleRows: [{ subject: 'Help', body: 'Server down' }],
  ...overrides,
})

const goodDraft = { query: 'Is this urgent?', classes: [{ name: 'Urgent', description: 'Needs action now.' }, { name: 'Later', description: 'Can wait.' }] }

const completion = (content: unknown, extra: Record<string, unknown> = {}) => ({ model: 'openai/gpt-4o-mini-2024', choices: [{ message: { content } }], ...extra })

interface Recorded { url: string; init: RequestInit }

const fakeFetch = (respond: (call: Recorded) => Response | Promise<Response>) => {
  const calls: Recorded[] = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} }
    calls.push(call)
    return respond(call)
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const provider = (fetchImpl: typeof fetch, extra: { timeoutMs?: number } = {}) => new OpenRouterDraftProvider({ apiKey: API_KEY, model: 'openai/gpt-4o-mini', fetch: fetchImpl, ...extra })

const failure = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('expected a rejection')
}

const expectNoKey = (error: ApiError) => {
  for (const text of [error.message, error.code, error.name, String(error), JSON.stringify({ ...error })]) expect(text).not.toContain('TOP-SECRET')
}

const requestBody = (call: Recorded): { model: string; response_format: unknown; messages: Array<{ role: string; content: string }> } => JSON.parse(String(call.init.body))
const userPayload = (call: Recorded): { task: string; dataset: string; columns: string[]; sampleRows: Array<Record<string, unknown>>; labelValues?: string[] } => (
  JSON.parse(requestBody(call).messages[1].content)
)

describe('OpenRouterDraftProvider', () => {
  it('sends the bearer key, JSON mode and the configured model to the OpenRouter endpoint', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(completion(JSON.stringify(goodDraft))))
    const result = await provider(fetch).draft(draftRequest({ labelValues: ['Urgent', 'Later'] }))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(OPENROUTER_ENDPOINT)
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`)
    const body = requestBody(calls[0])
    expect(body.model).toBe('openai/gpt-4o-mini')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(userPayload(calls[0])).toMatchObject({ task: 'Find urgent tickets', dataset: 'Tickets', labelValues: ['Urgent', 'Later'] })
    expect(result.query).toBe('Is this urgent?')
    expect(result.classes).toEqual(goodDraft.classes)
    expect(result.model).toBe('openai/gpt-4o-mini-2024')
  })

  it('falls back to the configured model name when the reply does not name one, and omits absent label values', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({ choices: [{ message: { content: JSON.stringify(goodDraft) } }] }))
    const result = await provider(fetch).draft(draftRequest())
    expect(result.model).toBe('openai/gpt-4o-mini')
    expect(userPayload(calls[0])).not.toHaveProperty('labelValues')
  })

  it('never sends more than 5 rows, 40 columns or 200 characters of a cell', async () => {
    const wideRow = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`col${index}`, 'z'.repeat(5_000)]))
    const { fetch, calls } = fakeFetch(() => jsonResponse(completion(JSON.stringify(goodDraft))))
    await provider(fetch).draft(draftRequest({
      columns: Object.keys(wideRow),
      sampleRows: Array.from({ length: 30 }, () => wideRow),
    }))
    const payload = userPayload(calls[0])
    expect(payload.columns).toHaveLength(40)
    expect(payload.sampleRows).toHaveLength(5)
    for (const row of payload.sampleRows) {
      expect(Object.keys(row)).toHaveLength(40)
      for (const value of Object.values(row)) {
        expect(String(value).startsWith('z'.repeat(200))).toBe(true)
        // 200 characters of content plus a one-character ellipsis marker.
        expect(String(value).length).toBeLessThanOrEqual(201)
      }
    }
    expect(calls[0].init.body as string).not.toContain('z'.repeat(250))
    expect(String(calls[0].init.body).length).toBeLessThan(60_000)
  })

  it('leaves short cells and non-string values untouched', () => {
    expect(boundedSampleRows([{ a: 'short', b: 3, c: null, d: false }])).toEqual([{ a: 'short', b: 3, c: null, d: false }])
    expect(boundedSampleRows(Array.from({ length: 9 }, (_, index) => ({ n: index })))).toHaveLength(5)
  })

  it('parses a fenced ```json reply', async () => {
    const fenced = `\`\`\`json\n${JSON.stringify(goodDraft)}\n\`\`\``
    const { fetch } = fakeFetch(() => jsonResponse(completion(fenced)))
    expect((await provider(fetch).draft(draftRequest())).query).toBe('Is this urgent?')
    const bare = fakeFetch(() => jsonResponse(completion(`\`\`\`\n${JSON.stringify(goodDraft)}\n\`\`\``)))
    expect((await provider(bare.fetch).draft(draftRequest())).classes).toHaveLength(2)
  })

  it('accepts a reply whose content is already an object', async () => {
    const { fetch } = fakeFetch(() => jsonResponse(completion(goodDraft)))
    expect((await provider(fetch).draft(draftRequest())).query).toBe('Is this urgent?')
  })

  it.each([
    ['plain prose', 'Is this ticket urgent or can it wait?'],
    ['prose around json', `Sure! Here you go: ${JSON.stringify(goodDraft)}`],
    ['empty content', ''],
    ['null content', null],
    ['a JSON array', JSON.stringify([goodDraft])],
    ['a JSON string', JSON.stringify('Is this urgent?')],
    ['no query', JSON.stringify({ classes: goodDraft.classes })],
    ['a blank query', JSON.stringify({ ...goodDraft, query: '   ' })],
    ['a non-string query', JSON.stringify({ ...goodDraft, query: 5 })],
    ['an over-long query', JSON.stringify({ ...goodDraft, query: 'q'.repeat(4_001) })],
    ['one class', JSON.stringify({ query: 'q?', classes: [{ name: 'Only', description: 'x' }] })],
    ['two classes that collapse into one', JSON.stringify({ query: 'q?', classes: [{ name: 'Same' }, { name: ' same ' }] })],
    ['no classes', JSON.stringify({ query: 'q?' })],
  ])('rejects %s as DRAFT_MALFORMED (retryable, never used as the query)', async (_label, content) => {
    const { fetch } = fakeFetch(() => jsonResponse(completion(content)))
    const error = await failure(provider(fetch).draft(draftRequest()))
    expect(error).toMatchObject({ code: 'DRAFT_MALFORMED', statusCode: 502, retryable: true })
  })

  it('rejects an unusable response envelope as DRAFT_MALFORMED', async () => {
    for (const body of [{}, { choices: [] }, { choices: [{}] }, { choices: [{ message: {} }] }, 'not json at all']) {
      const { fetch } = fakeFetch(() => (typeof body === 'string' ? new Response(body, { status: 200 }) : jsonResponse(body)))
      expect((await failure(provider(fetch).draft(draftRequest()))).code).toBe('DRAFT_MALFORMED')
    }
  })

  it.each([
    [429, 503, true],
    [500, 503, true],
    [502, 503, true],
    [503, 503, true],
    [401, 502, false],
    [403, 502, false],
    [400, 502, false],
  ])('maps HTTP %i to status %i (retryable: %s) without leaking the key', async (httpStatus, publicStatus, retryable) => {
    const { fetch } = fakeFetch(() => new Response(`upstream said: ${API_KEY}`, { status: httpStatus }))
    const error = await failure(provider(fetch).draft(draftRequest()))
    expect(error.statusCode).toBe(publicStatus)
    expect(error.retryable).toBe(retryable)
    expect(error.code).toBe(`OPENROUTER_${httpStatus}`)
    expectNoKey(error)
  })

  it('times out with OPENROUTER_TIMEOUT 504 when the request is aborted', async () => {
    const { fetch } = fakeFetch(({ init }) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    }))
    const error = await failure(provider(fetch, { timeoutMs: 15 }).draft(draftRequest()))
    expect(error).toMatchObject({ code: 'OPENROUTER_TIMEOUT', statusCode: 504, retryable: true })
    expectNoKey(error)
  })

  it('maps an abort thrown by fetch itself to OPENROUTER_TIMEOUT', async () => {
    const { fetch } = fakeFetch(() => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) })
    expect((await failure(provider(fetch).draft(draftRequest()))).code).toBe('OPENROUTER_TIMEOUT')
  })

  it('maps a thrown fetch to OPENROUTER_CONNECTION and never echoes the thrown text', async () => {
    const { fetch } = fakeFetch(() => { throw new TypeError(`connect ECONNREFUSED while sending Authorization: Bearer ${API_KEY}`) })
    const error = await failure(provider(fetch).draft(draftRequest()))
    expect(error).toMatchObject({ code: 'OPENROUTER_CONNECTION', statusCode: 502, retryable: true })
    expectNoKey(error)
  })

  it('passes an abort signal so a hung provider cannot hold the request open', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(completion(JSON.stringify(goodDraft))))
    await provider(fetch).draft(draftRequest())
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })
})

const abClasses: AnalysisClass[] = [
  { name: 'Run', description: 'A rushing play.' },
  { name: 'Pass', description: 'A passing play.' },
]

const answer = (classification: unknown, extra: Record<string, unknown> = {}) => ({ model: 'jev-2026-01', answers: { classification }, ...extra })

describe('parseJevAnswer', () => {
  it('returns probabilities aligned with class order, whatever order the provider used', () => {
    const parsed = parseJevAnswer(answer({ type: 'choice', choice: 'Pass', probabilities: { Pass: 0.8, Run: 0.2 }, confidence: 0.8 }), abClasses)
    expect(parsed).toEqual({ model: 'jev-2026-01', selectedClass: 'Pass', probabilities: [0.2, 0.8], confidence: 0.8 })
  })

  it('uses the default model name when the response names none', () => {
    expect(parseJevAnswer({ answers: { classification: { type: 'choice', choice: 'Run' } } }, abClasses).model).toBe(JEV_MODEL)
  })

  it.each([
    ['a choice outside the labels', { type: 'choice', choice: 'Fumble' }],
    ['a differently-cased label', { type: 'choice', choice: 'run' }],
    ['a non-string choice', { type: 'choice', choice: 1 }],
    ['the wrong answer type', { type: 'yes_no', choice: 'Run' }],
    ['a missing answer', undefined],
    ['a non-object answer', 'Run'],
  ])('rejects %s as JEV_MALFORMED_RESPONSE', (_label, classification) => {
    expect(() => parseJevAnswer(answer(classification), abClasses)).toThrowError(expect.objectContaining({ code: 'JEV_MALFORMED_RESPONSE', statusCode: 502 }))
  })

  it.each([undefined, null, 'x', [], { answers: null }, { answers: {} }])('rejects a malformed envelope %j', (response) => {
    expect(() => parseJevAnswer(response, abClasses)).toThrowError(expect.objectContaining({ code: 'JEV_MALFORMED_RESPONSE' }))
  })

  it.each([0.9999999, 1.0000001, 1])('accepts probabilities that sum to %s', (sum) => {
    const parsed = parseJevAnswer(answer({ type: 'choice', choice: 'Run', probabilities: { Run: sum - 0.3, Pass: 0.3 } }), abClasses)
    expect(parsed.probabilities).toEqual([sum - 0.3, 0.3])
  })

  it.each([
    ['missing', undefined],
    ['not an object', [0.5, 0.5]],
    ['summing to 0.7', { Run: 0.4, Pass: 0.3 }],
    ['summing to 1.3', { Run: 0.8, Pass: 0.5 }],
    ['missing a class', { Run: 1 }],
    ['containing a negative value', { Run: 1.2, Pass: -0.2 }],
    ['containing a non-number', { Run: '0.5', Pass: 0.5 }],
    ['containing NaN', { Run: Number.NaN, Pass: 1 }],
  ])('still accepts the answer but drops probabilities that are %s', (_label, probabilities) => {
    const parsed = parseJevAnswer(answer({ type: 'choice', choice: 'Run', probabilities }), abClasses)
    expect(parsed.selectedClass).toBe('Run')
    expect(parsed.probabilities).toBeUndefined()
    expect(parsed).not.toHaveProperty('probabilities')
  })

  it.each([1.5, -0.1, Number.NaN, '0.9', null, Infinity])('drops an out-of-range confidence (%s)', (confidence) => {
    const parsed = parseJevAnswer(answer({ type: 'choice', choice: 'Run', confidence }), abClasses)
    expect(parsed.selectedClass).toBe('Run')
    expect(parsed.confidence).toBeUndefined()
  })

  it('keeps confidence at the inclusive bounds', () => {
    expect(parseJevAnswer(answer({ type: 'choice', choice: 'Run', confidence: 0 }), abClasses).confidence).toBe(0)
    expect(parseJevAnswer(answer({ type: 'choice', choice: 'Run', confidence: 1 }), abClasses).confidence).toBe(1)
  })
})

const classifyRequest = (overrides: Partial<ClassifyRequest> = {}): ClassifyRequest => ({
  analysisId: 'run-123',
  rowIndex: 7,
  query: 'Run or pass?',
  classes: abClasses,
  input: { down: 3, yards_to_go: 8, note: 'x' },
  ...overrides,
})

const jevClient = (respond: () => unknown) => {
  const calls: Array<{ request: any; options: any }> = []
  const client: JevClient = {
    systemOne: async (request, options) => {
      calls.push({ request, options })
      return respond()
    },
  }
  return { client, calls }
}

const classifierWith = (client: JevClient) => new JevClassifier({ apiKey: API_KEY, client })

describe('JevClassifier', () => {
  it('is a live classifier that sends the row input as state and the labels as criteria', async () => {
    const { client, calls } = jevClient(() => answer({ type: 'choice', choice: 'Pass', probabilities: { Run: 0.1, Pass: 0.9 }, confidence: 0.9 }))
    const classifier = classifierWith(client)
    expect(classifier.mode).toBe('live')
    const result = await classifier.classify(classifyRequest())
    expect(result).toEqual({ model: 'jev-2026-01', selectedClass: 'Pass', probabilities: [0.1, 0.9], confidence: 0.9 })
    expect(calls).toHaveLength(1)
    expect(calls[0].request.state).toEqual({ down: 3, yards_to_go: 8, note: 'x' })
    expect(Object.keys(calls[0].request.state)).toEqual(['down', 'yards_to_go', 'note'])
    expect(calls[0].request.model).toBe(JEV_MODEL)
    expect(calls[0].request.questions.classification).toEqual({
      type: 'choice',
      instructions: 'Run or pass?',
      criteria: { Run: 'A rushing play.', Pass: 'A passing play.' },
    })
  })

  it('falls back to the class name when a class has no description', async () => {
    const { client, calls } = jevClient(() => answer({ type: 'choice', choice: 'Run' }))
    await classifierWith(client).classify(classifyRequest({ classes: [{ name: 'Run', description: '' }, { name: 'Pass', description: 'Throws it.' }] }))
    expect(calls[0].request.questions.classification.criteria).toEqual({ Run: 'Run', Pass: 'Throws it.' })
  })

  it('sends an Idempotency-Key of analysis:<id>:<rowIndex>', async () => {
    const { client, calls } = jevClient(() => answer({ type: 'choice', choice: 'Run' }))
    const classifier = classifierWith(client)
    await classifier.classify(classifyRequest({ analysisId: 'abc', rowIndex: 0 }))
    await classifier.classify(classifyRequest({ analysisId: 'abc', rowIndex: 41 }))
    await classifier.classify(classifyRequest({ analysisId: 'abc', rowIndex: 41 }))
    expect(calls.map((call) => call.options.headers['Idempotency-Key'])).toEqual(['analysis:abc:0', 'analysis:abc:41', 'analysis:abc:41'])
  })

  it.each([
    ['timeout', () => new APITimeoutError(10_000), 'JEV_TIMEOUT', 504, true],
    ['connection', () => new APIConnectionError('socket hang up'), 'JEV_CONNECTION', 502, true],
    ['429', () => new APIError(429, {}, new Headers()), 'JEV_429', 502, true],
    ['500', () => new APIError(500, {}, new Headers()), 'JEV_500', 502, true],
    ['503', () => new APIError(503, {}, new Headers()), 'JEV_503', 502, true],
    ['400', () => new APIError(400, {}, new Headers()), 'JEV_400', 502, false],
    ['401', () => new APIError(401, {}, new Headers()), 'JEV_401', 502, false],
    ['404', () => new APIError(404, {}, new Headers()), 'JEV_404', 502, false],
    ['422', () => new APIError(422, {}, new Headers()), 'JEV_422', 502, false],
    ['an unknown error', () => new Error(`kaboom ${API_KEY}`), 'JEV_ERROR', 502, false],
  ])('maps a %s from the SDK to %s', async (_label, makeError, code, statusCode, retryable) => {
    const client: JevClient = { systemOne: async () => { throw makeError() } }
    const error = await failure(classifierWith(client).classify(classifyRequest()))
    expect(error).toMatchObject({ code, statusCode, retryable })
    expectNoKey(error)
  })

  it('does not leak an upstream error body', async () => {
    const client: JevClient = { systemOne: async () => { throw new APIError(400, { echoed: API_KEY }, new Headers(), `bad request ${API_KEY}`) } }
    expectNoKey(await failure(classifierWith(client).classify(classifyRequest())))
  })

  it('surfaces an answer outside the labels as a non-retryable JEV_MALFORMED_RESPONSE', async () => {
    const { client } = jevClient(() => answer({ type: 'choice', choice: 'Punt' }))
    expect(await failure(classifierWith(client).classify(classifyRequest()))).toMatchObject({ code: 'JEV_MALFORMED_RESPONSE', statusCode: 502, retryable: false })
  })
})

describe('normalizeClasses', () => {
  it('trims, collapses whitespace and accepts plain strings', () => {
    expect(normalizeClasses(['  Very   urgent ', 'Low\tpriority\n'])).toEqual([
      { name: 'Very urgent', description: '' },
      { name: 'Low priority', description: '' },
    ])
  })

  it('de-duplicates case-insensitively, keeping the first spelling and description', () => {
    expect(normalizeClasses([{ name: 'Run', description: 'first' }, { name: 'RUN', description: 'second' }, 'run', 'Pass'])).toEqual([
      { name: 'Run', description: 'first' },
      { name: 'Pass', description: '' },
    ])
  })

  it('drops empty, over-long, NUL-containing and non-class entries without failing the rest', () => {
    const result = normalizeClasses(['A', '', '   ', 'x'.repeat(81), 'bad\u0000name', 42, null, undefined, ['nested'], { description: 'no name' }, { name: 5 }, 'B'])
    expect(result?.map((item) => item.name)).toEqual(['A', 'B'])
  })

  it('keeps a name of exactly 80 characters', () => {
    expect(normalizeClasses(['y'.repeat(80), 'z'])?.[0].name).toHaveLength(80)
  })

  it('collapses whitespace in descriptions, strips NUL, and clips to 300 characters', () => {
    const result = normalizeClasses([{ name: 'A', description: `  lots   of\n space ${'d'.repeat(400)}` }, { name: 'B', description: 'a\u0000b' }, { name: 'C', description: 7 }])
    expect(result?.[0].description).toHaveLength(300)
    expect(result?.[0].description.startsWith('lots of space d')).toBe(true)
    expect(result?.[1].description).toBe('ab')
    expect(result?.[2].description).toBe('')
  })

  it('returns undefined for fewer than 2 or more than 32 usable classes, or a non-array', () => {
    expect(normalizeClasses([])).toBeUndefined()
    expect(normalizeClasses(['only'])).toBeUndefined()
    expect(normalizeClasses(['a', 'A'])).toBeUndefined()
    expect(normalizeClasses(Array.from({ length: 33 }, (_, index) => `c${index}`))).toBeUndefined()
    expect(normalizeClasses(Array.from({ length: 32 }, (_, index) => `c${index}`))).toHaveLength(32)
    expect(normalizeClasses(Array.from({ length: 2 }, (_, index) => `c${index}`))).toHaveLength(2)
    for (const value of [undefined, null, 'a,b', { 0: 'a', 1: 'b' }, 7]) expect(normalizeClasses(value)).toBeUndefined()
  })
})

describe('MockClassifier', () => {
  const fast = () => new MockClassifier({ latencyMs: 0 })
  const abc: AnalysisClass[] = [{ name: 'Alpha', description: '' }, { name: 'Beta', description: '' }, { name: 'Gamma', description: '' }]

  it('is in mock mode and labels its output as simulated', async () => {
    const classifier = fast()
    expect(classifier.mode).toBe('mock')
    expect((await classifier.classify(classifyRequest())).model).toBe(MOCK_MODEL)
  })

  it('is deterministic for the same input, across instances', async () => {
    const request = classifyRequest({ classes: abc, input: { text: 'hello' } })
    const first = await fast().classify(request)
    expect(await fast().classify(request)).toEqual(first)
    expect(await fast().classify({ ...request })).toEqual(first)
  })

  it('always picks one of the given labels, with probabilities that sum to about 1 and match the pick', async () => {
    const classifier = fast()
    const sets: AnalysisClass[][] = [
      abClasses,
      abc,
      Array.from({ length: 9 }, (_, index) => ({ name: `label ${index}`, description: '' })),
      [{ name: 'Yes', description: '' }, { name: 'No', description: '' }],
    ]
    for (const classes of sets) {
      for (let rowIndex = 0; rowIndex < 40; rowIndex += 1) {
        const result = await classifier.classify(classifyRequest({ classes, rowIndex, input: { down: rowIndex % 4, yards_to_go: (rowIndex * 3) % 15, text: `row ${rowIndex}` } }))
        const names = classes.map((item) => item.name)
        expect(names).toContain(result.selectedClass)
        expect(result.probabilities).toHaveLength(classes.length)
        expect(result.probabilities!.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6)
        expect(result.probabilities!.every((value) => value >= 0 && value <= 1)).toBe(true)
        expect(result.probabilities![names.indexOf(result.selectedClass)]).toBe(Math.max(...result.probabilities!))
        expect(result.confidence).toBe(Math.max(...result.probabilities!))
      }
    }
  })

  it('does not always choose the same label', async () => {
    const picks = new Set<string>()
    for (let rowIndex = 0; rowIndex < 60; rowIndex += 1) picks.add((await fast().classify(classifyRequest({ classes: abc, rowIndex, input: { n: rowIndex } }))).selectedClass)
    expect(picks.size).toBeGreaterThan(1)
  })
})

describe('MockDraftProvider', () => {
  afterEach(() => { vi.useRealTimers() })

  const draft = async (request: DraftRequest) => {
    vi.useFakeTimers()
    const pending = new MockDraftProvider().draft(request)
    await vi.advanceTimersByTimeAsync(1_000)
    return pending
  }

  it('is in mock mode and labels its model as simulated', async () => {
    expect(new MockDraftProvider().mode).toBe('mock')
    expect((await draft(draftRequest())).model).toMatch(/simulated/i)
  })

  it('is deterministic and produces something the real validators accept', async () => {
    const first = await draft(draftRequest({ task: 'Find urgent tickets.' }))
    expect(await draft(draftRequest({ task: 'Find urgent tickets.' }))).toEqual(first)
    expect(first.query).toContain('Find urgent tickets')
    expect(first.query).not.toContain('tickets..')
    expect(normalizeClasses(first.classes)).toEqual(first.classes)
  })

  it('uses the held-out label values as class names when there are at least two', async () => {
    const result = await draft(draftRequest({ labelValues: ['Run', 'Pass'] }))
    expect(result.classes.map((item) => item.name)).toEqual(['Run', 'Pass'])
    const generic = await draft(draftRequest({ labelValues: ['Only'] }))
    expect(generic.classes.length).toBeGreaterThanOrEqual(2)
    expect(generic.classes.map((item) => item.name)).not.toContain('Only')
  })
})
