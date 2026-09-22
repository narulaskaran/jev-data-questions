import { describe, expect, it } from 'vitest'
import { FOOTBALL_FIXTURE_ID } from '../fixtures/footballTimeline'
import { SAMPLE_WIN_NOUL_QUERY } from '../shared/questionKind'
import { AnalysisService, InMemoryAnalysisStore, InMemoryDatasetSource, type AnalysisClassifier, type AnalysisDraftProvider } from './analysis'
import { createAnalysisDraftHandler, createAnalysisProposeHandler, createAnalysisReadHandler, createAnalysisRunHandler } from './analysisApi'

type ResponseState = { code?: number; body?: unknown; headers: Record<string, string> }
const response = (state: ResponseState) => ({
  status(code: number) { state.code = code; return this },
  json(body: unknown) { state.body = body; return this },
  setHeader(name: string, value: string) { state.headers[name] = value; return this },
  end() { return this },
})
const query = 'Classify H1 rows.'
const choiceClasses = ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie']
const service = () => new AnalysisService({
  store: new InMemoryAnalysisStore(),
  draftProvider: { async draft() { return { query, model: 'openrouter/test' } } } satisfies AnalysisDraftProvider,
  classifier: { async classify() { return { model: 'jev-latest', selectedClass: 'K.Walker', probabilities: { 'K.Walker': 0.7, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 }, confidence: 0.7 } } } satisfies AnalysisClassifier,
  idFactory: () => 'analysis-api-1',
  now: () => 1_800_000_000_000,
})

describe('analysis API contract', () => {
  it('rejects malformed draft bodies and does not include provider details', async () => {
    const state: ResponseState = { headers: {} }
    await createAnalysisDraftHandler(service())({ method: 'POST', headers: {}, body: '{"fixtureId":' }, response(state))
    expect(state.code).toBe(400)
    expect(state.body).toEqual({ error: 'INVALID_JSON' })
  })

  it('drafts through OpenRouter boundary only', async () => {
    const state: ResponseState = { headers: {} }
    await createAnalysisDraftHandler(service())({ method: 'POST', headers: {}, body: { fixtureId: FOOTBALL_FIXTURE_ID, task: 'draft' } }, response(state))
    expect(state.code).toBe(200)
    expect(state.body).toEqual(expect.objectContaining({ fixtureId: FOOTBALL_FIXTURE_ID, metadata: expect.objectContaining({ inputHalf: 'H1', labelHalf: 'H2' }) }))
    expect(JSON.parse((state.body as { query: string }).query)).toEqual(expect.objectContaining({ type: expect.any(String), instructions: query }))
  })

  it('drafts the sample win-likelihood path without the H1-only contract', async () => {
    const state: ResponseState = { headers: {} }
    await createAnalysisDraftHandler(service())({ method: 'POST', headers: {}, body: { fixtureId: FOOTBALL_FIXTURE_ID, task: 'Win likelihood of the game per play.' } }, response(state))
    expect(state.code).toBe(200)
    const body = state.body as { metadata: { rowCount: number; columns: string[]; inputHalf?: string; labelHalf?: string } }
    expect(body.metadata.rowCount).toBe(71)
    expect(body.metadata.columns).toEqual(expect.arrayContaining(['posteam_score', 'defteam_score', 'score_differential']))
    expect(body.metadata.inputHalf).toBeUndefined()
    expect(body.metadata.labelHalf).toBeUndefined()
  })

  it('drafts play-quality Score over the full game without the H1-only contract', async () => {
    const state: ResponseState = { headers: {} }
    await createAnalysisDraftHandler(service())({ method: 'POST', headers: {}, body: { fixtureId: FOOTBALL_FIXTURE_ID, task: 'Evaluate the quality of the plays.' } }, response(state))
    expect(state.code).toBe(200)
    const body = state.body as { query: string; metadata: { rowCount: number; questionKind?: string; inputHalf?: string; classes: string[] } }
    expect(JSON.parse(body.query)).toEqual({
      type: 'score',
      instructions: 'Rate the quality of this play given this play state.',
      criteria: ['Low', 'Medium', 'High'],
    })
    expect(body.metadata.questionKind).toBe('score')
    expect(body.metadata.rowCount).toBe(71)
    expect(body.metadata.inputHalf).toBeUndefined()
    expect(body.metadata.classes).toEqual(['Low', 'Medium', 'High'])
  })

  it('returns a cached draft for the same dataset and task without calling the provider again', async () => {
    const draftCalls: unknown[] = []
    const instance = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      datasets: new InMemoryDatasetSource([{
        datasetId: 'tickets',
        fixtureId: 'tickets',
        sourceType: 'upload',
        displayName: 'tickets.csv',
        columns: ['message'],
        rows: [{ message: 'one' }, { message: 'two' }],
        classes: ['urgent', 'routine'],
      }]),
      draftProvider: {
        async draft(input) {
          draftCalls.push(input)
          return { query: JSON.stringify({ type: 'choice', instructions: 'Classify each ticket.', criteria: { urgent: 'urgent', routine: 'routine' } }), model: 'openrouter/test' }
        },
      } satisfies AnalysisDraftProvider,
      classifier: { async classify() { return { model: 'jev-latest', selectedClass: 'urgent', probabilities: { urgent: 0.7, routine: 0.3 } } } } satisfies AnalysisClassifier,
      idFactory: () => 'draft-api-1',
      now: () => 1_800_000_000_000,
    })
    const task = 'Classify each ticket as urgent or routine using the message.'
    const first: ResponseState = { headers: {} }
    await createAnalysisDraftHandler(instance)({ method: 'POST', headers: {}, body: { datasetId: 'tickets', task } }, response(first))
    const second: ResponseState = { headers: {} }
    await createAnalysisDraftHandler(instance)({ method: 'POST', headers: {}, body: { datasetId: 'tickets', task: `  ${task}  ` } }, response(second))
    expect(first.code).toBe(200)
    expect(second.code).toBe(200)
    expect(first.headers['X-Analysis-Cache-Write']).toBe('ok')
    expect(second.headers['X-Analysis-Cache-Write']).toBe('ok')
    expect(second.body).toEqual(first.body)
    expect((second.body as { metadata: { cacheWrite?: string } }).metadata.cacheWrite).toBe('ok')
    expect(draftCalls).toHaveLength(1)
  })

  it('skips the provider and dataset load on a second draft with a known datasetId', async () => {
    const draftCalls: unknown[] = []
    let loads = 0
    const instance = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      datasets: {
        async get(datasetId: string) {
          loads += 1
          if (datasetId !== 'tickets') return undefined
          return {
            datasetId: 'tickets',
            fixtureId: 'tickets',
            sourceType: 'upload' as const,
            displayName: 'tickets.csv',
            columns: ['message'],
            rows: [{ message: 'one' }, { message: 'two' }],
            classes: ['urgent', 'routine'],
          }
        },
      },
      draftProvider: {
        async draft(input) {
          draftCalls.push(input)
          return { query: JSON.stringify({ type: 'choice', instructions: 'Classify each ticket.', criteria: { urgent: 'urgent', routine: 'routine' } }), model: 'openrouter/test' }
        },
      } satisfies AnalysisDraftProvider,
      classifier: { async classify() { return { model: 'jev-latest', selectedClass: 'urgent', probabilities: { urgent: 0.7, routine: 0.3 } } } } satisfies AnalysisClassifier,
      idFactory: () => 'draft-api-fast-1',
      now: () => 1_800_000_000_000,
    })
    const task = 'Classify each ticket as urgent or routine using the message.'
    const first: ResponseState = { headers: {} }
    await createAnalysisDraftHandler(instance)({ method: 'POST', headers: {}, body: { datasetId: 'tickets', task } }, response(first))
    const second: ResponseState = { headers: {} }
    await createAnalysisDraftHandler(instance)({ method: 'POST', headers: {}, body: { datasetId: 'tickets', task } }, response(second))
    expect(first.code).toBe(200)
    expect(second.code).toBe(200)
    expect(draftCalls).toHaveLength(1)
    expect(loads).toBe(1)
  })

  it('starts a run with queued status and reads it without starting another provider call', async () => {
    const instance = service()
    const runState: ResponseState = { headers: {} }
    await createAnalysisRunHandler(instance)({ method: 'POST', headers: {}, body: { fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses } }, response(runState))
    expect(runState.code).toBe(202)
    const analysisId = (runState.body as { analysisId: string }).analysisId
    const readState: ResponseState = { headers: {} }
    await createAnalysisReadHandler(instance)({ method: 'GET', headers: {}, query: { analysisId } }, response(readState))
    expect(readState.code).toBe(200)
    expect(readState.body).toEqual(expect.objectContaining({ analysisId, status: expect.stringMatching(/queued|running|complete/) }))
  })

  it('supports the public share read path with GET only', async () => {
    const instance = service()
    const runState: ResponseState = { headers: {} }
    await createAnalysisRunHandler(instance)({ method: 'POST', headers: {}, body: { fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses } }, response(runState))
    const analysisId = (runState.body as { analysisId: string }).analysisId
    const shareState: ResponseState = { headers: {} }
    await createAnalysisReadHandler(instance, { share: true })({ method: 'GET', headers: {}, query: { analysisId } }, response(shareState))
    expect(shareState.code).toBe(200)
    expect(shareState.body).toEqual(expect.objectContaining({ analysisId, fixtureId: FOOTBALL_FIXTURE_ID }))
    const postState: ResponseState = { headers: {} }
    await createAnalysisReadHandler(instance, { share: true })({ method: 'POST', headers: {}, query: { analysisId } }, response(postState))
    expect(postState.code).toBe(405)
  })

  it('returns an existing complete sample snapshot without invoking the classifier', async () => {
    const calls: unknown[] = []
    let nextId = 0
    const instance = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      draftProvider: { async draft() { return { query: SAMPLE_WIN_NOUL_QUERY, model: 'openrouter/test' } } } satisfies AnalysisDraftProvider,
      classifier: {
        async classify(input) {
          calls.push(input)
          return { model: 'jev-latest', questionKind: 'noul', value: 0.41 }
        },
      } satisfies AnalysisClassifier,
      idFactory: () => `analysis-api-${++nextId}`,
      now: () => 1_800_000_000_000,
    })
    const first: ResponseState = { headers: {} }
    await createAnalysisRunHandler(instance)({
      method: 'POST',
      headers: {},
      body: { fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' },
    }, response(first))
    expect(first.code).toBe(202)
    expect(calls).toHaveLength(71)
    const analysisId = (first.body as { analysisId: string }).analysisId

    const second: ResponseState = { headers: {} }
    await createAnalysisRunHandler(instance)({
      method: 'POST',
      headers: {},
      body: {
        fixtureId: FOOTBALL_FIXTURE_ID,
        query: JSON.stringify({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY }, null, 2),
        questionKind: 'noul',
      },
    }, response(second))
    expect(second.code).toBe(200)
    expect(second.body).toEqual(expect.objectContaining({ analysisId, status: 'complete' }))
    expect(calls).toHaveLength(71)
  })

  it('starts a new run when the sample query differs', async () => {
    const calls: unknown[] = []
    let nextId = 0
    const instance = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      draftProvider: { async draft() { return { query: SAMPLE_WIN_NOUL_QUERY, model: 'openrouter/test' } } } satisfies AnalysisDraftProvider,
      classifier: {
        async classify(input) {
          calls.push(input)
          return { model: 'jev-latest', questionKind: 'noul', value: 0.41 }
        },
      } satisfies AnalysisClassifier,
      idFactory: () => `analysis-api-${++nextId}`,
      now: () => 1_800_000_000_000,
    })
    const first: ResponseState = { headers: {} }
    await createAnalysisRunHandler(instance)({
      method: 'POST',
      headers: {},
      body: { fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' },
    }, response(first))
    const second: ResponseState = { headers: {} }
    await createAnalysisRunHandler(instance)({
      method: 'POST',
      headers: {},
      body: { fixtureId: FOOTBALL_FIXTURE_ID, query: 'Will the away team cover the spread?', questionKind: 'noul' },
    }, response(second))
    expect(second.code).toBe(202)
    expect((second.body as { analysisId: string }).analysisId).not.toBe((first.body as { analysisId: string }).analysisId)
    expect(calls).toHaveLength(142)
  })

  it('returns an existing complete BYOD snapshot without invoking the classifier', async () => {
    const calls: unknown[] = []
    let nextId = 0
    const byodQuery = 'Classify each ticket as urgent or routine using the message.'
    const instance = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      datasets: new InMemoryDatasetSource([{
        datasetId: 'tickets',
        fixtureId: 'tickets',
        sourceType: 'upload',
        displayName: 'tickets.csv',
        columns: ['message'],
        rows: [{ message: 'one' }, { message: 'two' }, { message: 'three' }],
        classes: ['urgent', 'routine'],
      }]),
      draftProvider: { async draft() { return { query: byodQuery, model: 'openrouter/test' } } } satisfies AnalysisDraftProvider,
      classifier: {
        async classify(input) {
          calls.push(input)
          return { model: 'jev-latest', selectedClass: 'urgent', probabilities: { urgent: 0.7, routine: 0.3 } }
        },
      } satisfies AnalysisClassifier,
      idFactory: () => `byod-api-${++nextId}`,
      now: () => 1_800_000_000_000,
    })
    const first: ResponseState = { headers: {} }
    await createAnalysisRunHandler(instance)({
      method: 'POST',
      headers: {},
      body: { datasetId: 'tickets', query: byodQuery, classes: ['urgent', 'routine'] },
    }, response(first))
    expect(first.code).toBe(202)
    expect(calls).toHaveLength(3)
    const analysisId = (first.body as { analysisId: string }).analysisId

    const second: ResponseState = { headers: {} }
    await createAnalysisRunHandler(instance)({
      method: 'POST',
      headers: {},
      body: { datasetId: 'tickets', query: byodQuery, classes: ['routine', 'urgent'] },
    }, response(second))
    expect(second.code).toBe(200)
    expect(second.body).toEqual(expect.objectContaining({ analysisId, status: 'complete' }))
    expect(calls).toHaveLength(3)
  })

  it('proposes named fixture insights without calling the LLM', async () => {
    const draftCalls: unknown[] = []
    const proposeCalls: unknown[] = []
    const instance = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      draftProvider: {
        async draft(input) { draftCalls.push(input); return { query, model: 'openrouter/test' } },
        async propose(input) { proposeCalls.push(input); return { insights: [], model: 'openrouter/test' } },
      } satisfies AnalysisDraftProvider,
      classifier: { async classify() { return { model: 'jev-latest', selectedClass: 'K.Walker', probabilities: { 'K.Walker': 0.7, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 }, confidence: 0.7 } } } satisfies AnalysisClassifier,
      idFactory: () => 'propose-api-1',
      now: () => 1_800_000_000_000,
    })
    const state: ResponseState = { headers: {} }
    await createAnalysisProposeHandler(instance)({ method: 'POST', headers: {}, body: { fixtureId: FOOTBALL_FIXTURE_ID } }, response(state))
    expect(state.code).toBe(200)
    expect(state.body).toEqual(expect.objectContaining({
      source: 'heuristic',
      insights: expect.arrayContaining([
        expect.objectContaining({ id: 'series-win', title: 'SEA win probability' }),
        expect.objectContaining({ id: 'series-play-quality', title: 'SEA play quality' }),
      ]),
    }))
    expect(proposeCalls).toHaveLength(0)
    expect(draftCalls).toHaveLength(0)
  })

  it('sanitizes LLM BYOD proposals and returns empty when they are junk', async () => {
    const instance = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      datasets: new InMemoryDatasetSource([{
        datasetId: 'tickets',
        fixtureId: 'tickets',
        sourceType: 'upload',
        displayName: 'tickets.csv',
        columns: ['message', 'tier'],
        rows: [{ message: 'one', tier: 'gold' }, { message: 'two', tier: 'silver' }],
      }]),
      draftProvider: {
        async draft() { return { query, model: 'openrouter/test' } },
        async propose() {
          return {
            insights: [
              { title: 'Classify by shift', question: 'AM or PM?', visual: 'bars', reason: 'Labels in this table.', classes: ['AM', 'PM'] },
            ],
            model: 'openrouter/test',
          }
        },
      } satisfies AnalysisDraftProvider,
      classifier: { async classify() { return { model: 'jev-latest', selectedClass: 'urgent', probabilities: { urgent: 0.7, routine: 0.3 } } } } satisfies AnalysisClassifier,
      idFactory: () => 'propose-api-2',
      now: () => 1_800_000_000_000,
    })
    const junk: ResponseState = { headers: {} }
    await createAnalysisProposeHandler(instance)({ method: 'POST', headers: {}, body: { datasetId: 'tickets' } }, response(junk))
    expect(junk.code).toBe(200)
    expect(junk.body).toEqual(expect.objectContaining({ source: 'empty', insights: [] }))

    const valid = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      datasets: new InMemoryDatasetSource([{
        datasetId: 'tickets',
        fixtureId: 'tickets',
        sourceType: 'upload',
        displayName: 'tickets.csv',
        columns: ['message', 'tier'],
        rows: [{ message: 'one', tier: 'gold' }, { message: 'two', tier: 'silver' }],
      }]),
      draftProvider: {
        async draft() { return { query, model: 'openrouter/test' } },
        async propose() {
          return {
            insights: [
              { title: 'Urgent tickets', question: 'Is this ticket urgent given the message?', visual: 'series', reason: 'Support load.', questionKind: 'noul' },
              { title: 'Frustrated customers', question: 'Is this message frustrated?', visual: 'series', reason: 'Tone.', questionKind: 'noul' },
            ],
            model: 'openrouter/test',
          }
        },
      } satisfies AnalysisDraftProvider,
      classifier: { async classify() { return { model: 'jev-latest', selectedClass: 'urgent', probabilities: { urgent: 0.7, routine: 0.3 } } } } satisfies AnalysisClassifier,
      idFactory: () => 'propose-api-3',
      now: () => 1_800_000_000_000,
    })
    const ok: ResponseState = { headers: {} }
    await createAnalysisProposeHandler(valid)({ method: 'POST', headers: {}, body: { datasetId: 'tickets' } }, response(ok))
    expect(ok.code).toBe(200)
    const body = ok.body as { source: string; insights: Array<{ title: string; visual: string; question: string }> }
    expect(body.source).toBe('llm')
    expect(body.insights.length).toBeGreaterThanOrEqual(2)
    expect(body.insights.every((item) => item.visual === 'series')).toBe(true)
    expect(body.insights.map((item) => item.title)).toEqual(expect.arrayContaining(['Urgent tickets', 'Frustrated customers']))

    const failed = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      datasets: new InMemoryDatasetSource([{
        datasetId: 'tickets',
        fixtureId: 'tickets',
        sourceType: 'upload',
        displayName: 'tickets.csv',
        columns: ['message'],
        rows: [{ message: 'one' }, { message: 'two' }],
      }]),
      draftProvider: {
        async draft() { return { query, model: 'openrouter/test' } },
        async propose() { throw new Error('provider down') },
      } satisfies AnalysisDraftProvider,
      classifier: { async classify() { return { model: 'jev-latest', selectedClass: 'urgent', probabilities: { urgent: 0.7, routine: 0.3 } } } } satisfies AnalysisClassifier,
      idFactory: () => 'propose-api-4',
      now: () => 1_800_000_000_000,
    })
    const empty: ResponseState = { headers: {} }
    await createAnalysisProposeHandler(failed)({ method: 'POST', headers: {}, body: { datasetId: 'tickets' } }, response(empty))
    expect(empty.code).toBe(200)
    expect(empty.body).toEqual(expect.objectContaining({ source: 'empty', insights: [] }))
  })
})
