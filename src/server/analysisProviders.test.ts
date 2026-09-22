import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPENROUTER_ENDPOINT,
  OpenRouterConfigurationError,
  OpenRouterDraftProvider,
  TypeSafeClassifierProvider,
  parseClassifierResponse,
  type ClassifierClientBoundary,
} from './analysisProviders'
import { FOOTBALL_FIXTURE_ID, getHalftimeModelInput, getWinLikelihoodModelInput } from '../fixtures/footballTimeline'
import { asAnalysisRow } from '../shared/dataset'
import { AnalysisService, InMemoryAnalysisStore } from './analysis'

const input = asAnalysisRow(getHalftimeModelInput()[0])
const winLikelihoodInput = asAnalysisRow(getWinLikelihoodModelInput()[0])
const draftBody = (content: unknown) => ({ choices: [{ message: { content } }], model: 'openrouter/test' })
const fetchResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => vi.unstubAllEnvs())

describe('OpenRouter analysis draft adapter', () => {
  it('uses OPENROUTER_KEY server-side and returns only an editable query', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init })
      return fetchResponse(draftBody('{"query":"Classify the H1 rows.","notes":"ignore me"}'))
    }
    const result = await new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: fetcher }).draft({
      fixtureId: FOOTBALL_FIXTURE_ID,
      datasetId: FOOTBALL_FIXTURE_ID,
      task: 'Find a useful classification.',
      classes: ['K.Walker', 'Other/Tie'],
    })
    expect(result).toEqual({ query: 'Classify the H1 rows.', model: 'openrouter/test' })
    expect(calls[0]?.url).toBe(OPENROUTER_ENDPOINT)
    expect(String(calls[0]?.init?.headers)).not.toContain('test-openrouter-key')
    expect(JSON.stringify(calls[0]?.init?.body)).toContain('Find a useful classification.')
  })

  it('does not send leftover fixture player classes for a win-likelihood draft', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init })
      return fetchResponse(draftBody('{"query":"Classify K.Walker vs C.Kupp.","questionKind":"choice","classes":["K.Walker","C.Kupp","J.Smith-Njigba","Other/Tie"]}'))
    }
    const result = await new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: fetcher }).draft({
      fixtureId: FOOTBALL_FIXTURE_ID,
      datasetId: FOOTBALL_FIXTURE_ID,
      task: 'Win likelihood of the game per play.',
      classes: [],
      questionKindHint: 'noul',
    })
    const payload = JSON.parse(String(calls[0]?.init?.body ?? '{}')) as { messages?: Array<{ role?: string; content?: string }> }
    const user = JSON.parse(payload.messages?.find((message) => message.role === 'user')?.content ?? '{}') as Record<string, unknown>
    expect(user.task).toBe('Win likelihood of the game per play.')
    expect(user.questionKindHint).toBe('noul')
    expect(user).not.toHaveProperty('classes')
    expect(JSON.stringify(user)).not.toContain('K.Walker')
    expect(result.query).toContain('K.Walker')
  })

  it('fails closed when the OpenRouter key is missing', async () => {
    vi.stubEnv('OPENROUTER_KEY', '')
    await expect(new OpenRouterDraftProvider().draft({ fixtureId: FOOTBALL_FIXTURE_ID, datasetId: FOOTBALL_FIXTURE_ID, task: 'task', classes: ['A', 'B'] })).rejects.toBeInstanceOf(OpenRouterConfigurationError)
  })

  it.each([401, 429, 500])('maps OpenRouter HTTP %s without exposing provider bodies', async (status) => {
    const fetcher: typeof fetch = async () => fetchResponse({ error: { message: 'secret provider body' } }, status)
    await expect(new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: fetcher }).draft({ fixtureId: FOOTBALL_FIXTURE_ID, datasetId: FOOTBALL_FIXTURE_ID, task: 'task', classes: ['A', 'B'] })).rejects.toMatchObject({ code: `OPENROUTER_${status}`, statusCode: status === 401 ? 502 : status === 429 ? 503 : 502 })
    await expect(new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: fetcher }).draft({ fixtureId: FOOTBALL_FIXTURE_ID, datasetId: FOOTBALL_FIXTURE_ID, task: 'task', classes: ['A', 'B'] })).rejects.not.toThrow('secret provider body')
  })

  it('rejects malformed output and timeouts truthfully', async () => {
    const malformed: typeof fetch = async () => fetchResponse({ choices: [] })
    await expect(new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: malformed }).draft({ fixtureId: FOOTBALL_FIXTURE_ID, datasetId: FOOTBALL_FIXTURE_ID, task: 'task', classes: ['A', 'B'] })).rejects.toMatchObject({ code: 'OPENROUTER_MALFORMED', statusCode: 502 })
    const timeout: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
    await expect(new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: timeout, timeoutMs: 5 }).draft({ fixtureId: FOOTBALL_FIXTURE_ID, datasetId: FOOTBALL_FIXTURE_ID, task: 'task', classes: ['A', 'B'] })).rejects.toMatchObject({ code: 'OPENROUTER_TIMEOUT', statusCode: 504 })
  })

  it('parses a structured insight list for BYOD proposals', async () => {
    const fetcher: typeof fetch = async () => fetchResponse(draftBody({
      insights: [
        { title: 'Urgent tickets', question: 'Is this ticket urgent given the message?', visual: 'series', reason: 'Support load.' },
        { title: 'Frustrated customers', question: 'Is this message frustrated?', visual: 'series', reason: 'Tone.' },
      ],
    }))
    const result = await new OpenRouterDraftProvider({ apiKey: 'placeholder', fetch: fetcher }).propose({
      fixtureId: 'tickets',
      datasetId: 'tickets',
      columns: ['message'],
      sampleRows: [{ message: 'hello' }],
      sourceType: 'upload',
    })
    expect(result.model).toBe('openrouter/test')
    expect(result.insights).toEqual([
      expect.objectContaining({ title: 'Urgent tickets', question: 'Is this ticket urgent given the message?' }),
      expect.objectContaining({ title: 'Frustrated customers' }),
    ])
  })
})

describe('editable Jev classifier adapter', () => {
  it('fails a run before creating work when JEV_API_KEY is missing', async () => {
    vi.stubEnv('JEV_API_KEY', '')
    const service = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      draftProvider: { async draft() { return { query: 'query', model: 'openrouter/test' } } },
      classifier: new TypeSafeClassifierProvider(),
    })
    await expect(service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: 'query', classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'] })).rejects.toMatchObject({ code: 'JEV_NOT_CONFIGURED', statusCode: 503 })
  })

  it('sends the editable query with one H1 row and parses bounded probabilities', async () => {
    const calls: unknown[] = []
    const client: ClassifierClientBoundary = {
      async systemOne(request) {
        calls.push(request)
        return { model: 'jev-latest', answers: { classification: { type: 'choice', choice: 'K.Walker', probabilities: { 'K.Walker': 0.7, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 }, confidence: 0.7 } } }
      },
    }
    const provider = new TypeSafeClassifierProvider({ client })
    await expect(provider.classify({ analysisId: 'analysis-1', fixtureId: FOOTBALL_FIXTURE_ID, datasetId: FOOTBALL_FIXTURE_ID, query: 'custom query', rowIndex: 0, row: input, classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'] })).resolves.toMatchObject({ selectedClass: 'K.Walker', confidence: 0.7 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(expect.objectContaining({ state: expect.objectContaining({ fixtureId: FOOTBALL_FIXTURE_ID, datasetId: FOOTBALL_FIXTURE_ID, rowIndex: 0, input }), questions: expect.objectContaining({ classification: expect.objectContaining({ instructions: 'custom query' }) }) }))
  })

  it('sends a Noul question for win likelihood and parses P(win)', async () => {
    const calls: unknown[] = []
    const client: ClassifierClientBoundary = {
      async systemOne(request) {
        calls.push(request)
        return { model: 'jev-latest', answers: { classification: { type: 'noul', noul: 0.63 } } }
      },
    }
    const provider = new TypeSafeClassifierProvider({ client })
    await expect(provider.classify({
      analysisId: 'analysis-1',
      fixtureId: FOOTBALL_FIXTURE_ID,
      datasetId: FOOTBALL_FIXTURE_ID,
      query: 'Will SEA win given this play state?',
      rowIndex: 0,
      row: winLikelihoodInput,
      classes: [],
      questionKind: 'noul',
    })).resolves.toMatchObject({ questionKind: 'noul', value: 0.63 })
    expect(calls[0]).toEqual(expect.objectContaining({
      state: expect.objectContaining({ input: expect.objectContaining({ posteam_score: winLikelihoodInput.posteam_score, defteam_score: winLikelihoodInput.defteam_score, score_differential: winLikelihoodInput.score_differential }) }),
      questions: expect.objectContaining({ classification: expect.objectContaining({ type: 'noul', instructions: 'Will SEA win given this play state?' }) }),
    }))
  })

  it('retries an unreadable duplicate-replay body with a fresh idempotency key', async () => {
    const keys: Array<string | undefined> = []
    const client: ClassifierClientBoundary = {
      async systemOne(_request, options) {
        keys.push(options?.headers?.['Idempotency-Key'])
        if (keys.length === 1) return undefined
        return { model: 'jev-latest', answers: { classification: { type: 'noul', noul: 0.41 } } }
      },
    }
    const provider = new TypeSafeClassifierProvider({ client })
    await expect(provider.classify({
      analysisId: 'analysis-dup-1',
      fixtureId: FOOTBALL_FIXTURE_ID,
      datasetId: FOOTBALL_FIXTURE_ID,
      query: 'Will SEA win given this play state?',
      rowIndex: 0,
      row: input,
      classes: [],
      questionKind: 'noul',
    })).resolves.toMatchObject({ questionKind: 'noul', value: 0.41 })
    expect(keys).toEqual(['analysis:analysis-dup-1:0', 'analysis:analysis-dup-1:0:r1'])
  })

  it('exhausts one replay retry and keeps JEV_MALFORMED_RESPONSE retryable', async () => {
    const keys: Array<string | undefined> = []
    const client: ClassifierClientBoundary = {
      async systemOne(_request, options) {
        keys.push(options?.headers?.['Idempotency-Key'])
        return ''
      },
    }
    await expect(new TypeSafeClassifierProvider({ client }).classify({
      analysisId: 'analysis-dup-2',
      fixtureId: FOOTBALL_FIXTURE_ID,
      datasetId: FOOTBALL_FIXTURE_ID,
      query: 'Will SEA win given this play state?',
      rowIndex: 3,
      row: input,
      classes: [],
      questionKind: 'noul',
    })).rejects.toMatchObject({ code: 'JEV_MALFORMED_RESPONSE', retryable: true, statusCode: 502 })
    expect(keys).toEqual(['analysis:analysis-dup-2:3', 'analysis:analysis-dup-2:3:r1'])
  })

  it('does not spend a second Jev call on a semantically invalid answer', async () => {
    let calls = 0
    const client: ClassifierClientBoundary = {
      async systemOne() {
        calls += 1
        return { model: 'jev-latest', answers: { classification: { type: 'noul', noul: 2 } } }
      },
    }
    await expect(new TypeSafeClassifierProvider({ client }).classify({
      analysisId: 'analysis-1',
      fixtureId: FOOTBALL_FIXTURE_ID,
      datasetId: FOOTBALL_FIXTURE_ID,
      query: 'Will SEA win given this play state?',
      rowIndex: 0,
      row: input,
      classes: [],
      questionKind: 'noul',
    })).rejects.toMatchObject({ code: 'JEV_MALFORMED_RESPONSE', retryable: false })
    expect(calls).toBe(1)
  })

  it.each([401, 429, 500])('maps Jev HTTP %s to a truthful stable error', async (status) => {
    const fetcher: typeof fetch = async () => fetchResponse({ error: { message: 'provider details' } }, status)
    const provider = new TypeSafeClassifierProvider({ apiKey: 'placeholder', fetch: fetcher })
    const browserWindow = globalThis.window
    vi.stubGlobal('window', undefined)
    try {
      await expect(provider.classify({ analysisId: 'analysis-1', fixtureId: FOOTBALL_FIXTURE_ID, datasetId: FOOTBALL_FIXTURE_ID, query: 'query', rowIndex: 0, row: input, classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'] })).rejects.toMatchObject({ code: `JEV_${status}`, statusCode: status === 429 ? 503 : 502 })
    } finally {
      vi.stubGlobal('window', browserWindow)
    }
  })
})

describe('Jev classifier response normalize', () => {
  const noulAnswer = { type: 'noul', noul: 0.63 }
  const choiceClasses = ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie']
  const choiceAnswer = {
    type: 'choice',
    choice: 'K.Walker',
    probabilities: { 'K.Walker': 0.7, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 },
    confidence: 0.7,
  }

  it('accepts the documented System One envelope', () => {
    expect(parseClassifierResponse({ model: 'jev-latest', answers: { classification: noulAnswer } }, [], 'noul')).toEqual({
      model: 'jev-latest',
      questionKind: 'noul',
      value: 0.63,
    })
  })

  it.each([
    ['JSON string body', JSON.stringify({ model: 'jev-latest', answers: { classification: noulAnswer } })],
    ['data wrapper', { data: { model: 'jev-latest', answers: { classification: noulAnswer } } }],
    ['stringified answer', { model: 'jev-latest', answers: { classification: JSON.stringify(noulAnswer) } }],
    ['alternate answer key', { model: 'jev-latest', answers: { q0: noulAnswer } }],
    ['bare answer', noulAnswer],
    ['numeric string noul', { model: 'jev-latest', answers: { classification: { type: 'noul', noul: '0.63' } } }],
    ['noul alias value', { model: 'jev-latest', answers: { classification: { type: 'noul', value: 0.63 } } }],
    ['epsilon clamp', { model: 'jev-latest', answers: { classification: { type: 'noul', noul: 1.0000004 } } }],
  ])('normalizes %s without failing closed', (_label, body) => {
    const parsed = parseClassifierResponse(body, [], 'noul')
    expect(parsed.questionKind).toBe('noul')
    expect(parsed.value).toBeGreaterThanOrEqual(0.63)
    expect(parsed.value).toBeLessThanOrEqual(1)
  })

  it('keeps Choice bars parseable after a duplicate-shaped replay', () => {
    expect(parseClassifierResponse({
      result: { model: 'jev-latest', answers: { classification: { ...choiceAnswer, choice: ' K.Walker ', probabilities: { 'K.Walker': '0.7', 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 } } } },
    }, choiceClasses, 'choice')).toMatchObject({
      questionKind: 'choice',
      selectedClass: 'K.Walker',
      probabilities: { 'K.Walker': 0.7, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 },
    })
  })

  it('marks empty or unreadable envelopes as retryable', () => {
    for (const body of [undefined, 'not-json', { model: 'jev-latest', answers: {} }]) {
      try {
        parseClassifierResponse(body, [], 'noul')
        throw new Error('expected malformed response')
      } catch (error) {
        expect(error).toMatchObject({ code: 'JEV_MALFORMED_RESPONSE', retryable: true, statusCode: 502 })
      }
    }
  })

  it('still rejects a noul that is not a unit probability', () => {
    expect(() => parseClassifierResponse({ answers: { classification: { type: 'noul', noul: 2 } } }, [], 'noul')).toThrow(/invalid noul/)
    try {
      parseClassifierResponse({ answers: { classification: { type: 'noul', noul: 2 } } }, [], 'noul')
    } catch (error) {
      expect(error).toMatchObject({ code: 'JEV_MALFORMED_RESPONSE', retryable: false })
    }
  })

  it('still maps a Score answer onto a 0-1 series value', () => {
    expect(parseClassifierResponse({
      model: 'jev-latest',
      answers: { classification: { type: 'score', score: 1.5, legend: { 0: 'Low', 1: 'Medium', 2: 'High' }, confidence: 0.5 } },
    }, ['Low', 'Medium', 'High'], 'score')).toEqual({
      model: 'jev-latest',
      questionKind: 'score',
      value: 0.75,
      confidence: 0.5,
    })
  })
})
