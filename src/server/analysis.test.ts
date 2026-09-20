import { beforeEach, describe, expect, it, vi } from 'vitest'
import { footballFixture, getHalftimeModelInput, getWinLikelihoodModelInput, FOOTBALL_FIXTURE_ID, FOOTBALL_FIXTURE_SCHEMA } from '../fixtures/footballTimeline'
import { SAMPLE_PLAY_QUALITY_LEVELS, SAMPLE_PLAY_QUALITY_QUERY, SAMPLE_WIN_LIKELIHOOD_TASK, SAMPLE_WIN_NOUL_QUERY, SQUIRREL_EATING_NOUL_QUERY, SQUIRREL_EATING_TASK } from '../shared/questionKind'
import { SQUIRREL_FIXTURE_ID } from '../fixtures/squirrelCensus'
import { parseJevQueryJson } from '../shared/jevQuery'
import {
  ANALYSIS_CLASSIFY_CONCURRENCY,
  ANALYSIS_MAX_CALLS,
  ANALYSIS_MAX_ROWS,
  AnalysisError,
  AnalysisService,
  consecutiveCompletedRows,
  createSnapshotWritePipeline,
  InMemoryAnalysisStore,
  InMemoryDatasetSource,
  pendingRowIndexes,
  type AnalysisClassifier,
  type AnalysisDraftProvider,
  type AnalysisSnapshot,
} from './analysis'

const query = 'Classify the most likely leading player from the visible first-half play inputs.'
const choiceClasses = ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie']
const byodTicketQuery = 'Classify each ticket as urgent or routine using the message.'
const ticketsDataset = {
  datasetId: 'tickets',
  fixtureId: 'tickets',
  sourceType: 'upload' as const,
  displayName: 'tickets.csv',
  columns: ['message'],
  rows: [{ message: 'one' }, { message: 'two' }, { message: 'three' }],
  classes: ['urgent', 'routine'],
}
const invoicesDataset = {
  ...ticketsDataset,
  datasetId: 'invoices',
  fixtureId: 'invoices',
  displayName: 'invoices.csv',
}
const byodClassification = () => ({
  model: 'jev-latest',
  selectedClass: 'urgent',
  probabilities: { urgent: 0.7, routine: 0.3 },
})
const classification = (selectedClass = 'K.Walker') => ({
  model: 'jev-latest',
  selectedClass,
  probabilities: { 'K.Walker': 0.7, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.1, 'Other/Tie': 0.1 },
  confidence: 0.7,
})

const makeClassifier = (calls: Array<unknown>, result = classification()): AnalysisClassifier => ({
  async classify(input) {
    calls.push(input)
    return result
  },
})

const makeDraftProvider = (calls: Array<unknown>, result = { query, model: 'openrouter/test' }): AnalysisDraftProvider => ({
  async draft(input) {
    calls.push(input)
    return result
  },
})

const serviceWith = (classifier: AnalysisClassifier, draftProvider = makeDraftProvider([])) => new AnalysisService({
  store: new InMemoryAnalysisStore(),
  classifier,
  draftProvider,
  now: () => 1_800_000_000_000,
  idFactory: () => 'analysis-test-1',
})

describe('analysis domain contract', () => {
  it('drafts without invoking the classifier or Jev', async () => {
    const classifierCalls: unknown[] = []
    const draftCalls: unknown[] = []
    const service = serviceWith(makeClassifier(classifierCalls), makeDraftProvider(draftCalls))

    const drafted = await service.draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: 'Find a useful H1 classifier.' })
    expect(drafted).toEqual({
      fixtureId: FOOTBALL_FIXTURE_ID,
      datasetId: FOOTBALL_FIXTURE_ID,
      sourceType: 'fixture',
      query: expect.any(String),
      metadata: expect.objectContaining({ provider: 'openrouter', rowCount: 39, inputHalf: 'H1', labelHalf: 'H2' }),
    })
    expect(parseJevQueryJson(drafted.query)).toEqual(expect.objectContaining({ type: expect.stringMatching(/^(noul|score|choice)$/), instructions: query }))
    expect(drafted.query.trim().startsWith('{')).toBe(true)
    expect(draftCalls).toHaveLength(1)
    expect(classifierCalls).toHaveLength(0)
  })

  it('honors a win-likelihood prompt instead of the fixture player-class fallback', async () => {
    const draftCalls: Array<{ task: string; classes?: readonly string[]; sampleRows?: Array<Record<string, unknown>> }> = []
    const service = serviceWith(makeClassifier([]), {
      async draft(input) {
        draftCalls.push(input)
        return {
          query: 'Classify the most likely leading player from K.Walker, C.Kupp, J.Smith-Njigba, or Other.',
          model: 'openrouter/test',
          questionKind: 'choice',
          classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'],
        }
      },
    })
    const drafted = await service.draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: SAMPLE_WIN_LIKELIHOOD_TASK })
    expect(parseJevQueryJson(drafted.query)).toEqual({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY })
    expect(drafted.query).not.toBe(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(drafted.metadata.questionKind).toBe('noul')
    expect(drafted.metadata.classes).toEqual([])
    expect(drafted.metadata.rowCount).toBe(71)
    expect(drafted.metadata.inputHalf).toBeUndefined()
    expect(drafted.metadata.labelHalf).toBeUndefined()
    expect(drafted.metadata.columns).toEqual(expect.arrayContaining(['posteam_score', 'defteam_score', 'score_differential']))
    expect(JSON.stringify(drafted)).not.toMatch(/K\.Walker|C\.Kupp|Smith-Njigba|Other\/Tie/)
    expect(drafted.metadata.model).toBe('cached-sample-noul')
    expect(draftCalls).toHaveLength(0)
  })

  it('drafts a play-quality ask as Score over the full game, not Good/Bad Choice on H1', async () => {
    const draftCalls: unknown[] = []
    const service = serviceWith(makeClassifier([]), {
      async draft(input) {
        draftCalls.push(input)
        return {
          query: JSON.stringify({
            type: 'choice',
            instructions: 'Evaluate the quality of the plays.',
            criteria: { 'Good Play': 'a successful play', 'Bad Play': 'an unsuccessful play' },
          }),
          model: 'openrouter/test',
          questionKind: 'choice' as const,
          classes: ['Good Play', 'Bad Play'],
        }
      },
    })
    const drafted = await service.draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: 'Evaluate the quality of the plays.' })
    expect(parseJevQueryJson(drafted.query)).toEqual({
      type: 'score',
      instructions: SAMPLE_PLAY_QUALITY_QUERY,
      criteria: [...SAMPLE_PLAY_QUALITY_LEVELS],
    })
    expect(drafted.metadata.questionKind).toBe('score')
    expect(drafted.metadata.classes).toEqual([...SAMPLE_PLAY_QUALITY_LEVELS])
    expect(drafted.metadata.rowCount).toBe(71)
    expect(drafted.metadata.inputHalf).toBeUndefined()
    expect(drafted.metadata.labelHalf).toBeUndefined()
    expect(drafted.metadata.model).toBe('cached-sample-score')
    expect(JSON.stringify(drafted)).not.toMatch(/Good Play|Bad Play/)
    expect(draftCalls).toHaveLength(0)
  })

  it('short-circuits squirrel where-they-eat into eating Noul, not Location vs Activity', async () => {
    const draftCalls: unknown[] = []
    const service = serviceWith(makeClassifier([]), makeDraftProvider(draftCalls, {
      query: JSON.stringify({
        type: 'choice',
        instructions: 'Identify common locations where squirrels are spotted eating.',
        criteria: { Location: 'specific location where squirrels eat', Activity: 'eating or foraging' },
      }),
      model: 'openrouter/test',
    }))
    const drafted = await service.draft({ fixtureId: SQUIRREL_FIXTURE_ID, task: SQUIRREL_EATING_TASK })
    expect(parseJevQueryJson(drafted.query)).toEqual({ type: 'noul', instructions: SQUIRREL_EATING_NOUL_QUERY })
    expect(drafted.metadata.questionKind).toBe('noul')
    expect(drafted.metadata.classes).toEqual([])
    expect(drafted.metadata.model).toBe('cached-sample-places')
    expect(JSON.stringify(drafted)).not.toMatch(/Location|Activity/)
    expect(draftCalls).toHaveLength(0)
  })

  it('does not return the cached sample noul for an unrelated fixture prompt', async () => {
    const draftCalls: Array<{ task: string }> = []
    const service = serviceWith(makeClassifier([]), {
      async draft(input) {
        draftCalls.push(input)
        return {
          query: JSON.stringify({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY }),
          model: 'openrouter/test',
          questionKind: 'noul',
        }
      },
    })
    const task = 'Classify each play as run or pass using the visible columns.'
    const drafted = await service.draft({ fixtureId: FOOTBALL_FIXTURE_ID, task })
    expect(draftCalls).toEqual([expect.objectContaining({ task })])
    expect(parseJevQueryJson(drafted.query)).toEqual({
      type: 'choice',
      instructions: task,
      criteria: { run: 'the run class', pass: 'the pass class' },
    })
    expect(drafted.metadata.questionKind).toBe('choice')
    expect(drafted.metadata.classes).toEqual(['run', 'pass'])
    expect(drafted.metadata.model).toBe('openrouter/test')
    expect(JSON.stringify(drafted)).not.toContain(SAMPLE_WIN_NOUL_QUERY)
  })

  it('drafts fruit/vehicle Choice classes when the provider returns a single class', async () => {
    const classifyDataset = {
      datasetId: 'classify',
      fixtureId: 'classify',
      sourceType: 'upload' as const,
      displayName: 'classify.csv',
      columns: ['id', 'text', 'label_hint'],
      rows: [
        { id: 1, text: 'apple', label_hint: 'fruit' },
        { id: 2, text: 'truck', label_hint: 'vehicle' },
      ],
    }
    const service = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      classifier: makeClassifier([]),
      draftProvider: {
        async draft() {
          return {
            query: JSON.stringify({ type: 'choice', instructions: 'Classify the row.', criteria: { fruit: '' } }),
            model: 'openrouter/test',
            questionKind: 'choice' as const,
            classes: ['fruit'],
          }
        },
      },
      datasets: new InMemoryDatasetSource([classifyDataset]),
      now: () => 1_800_000_000_000,
      idFactory: () => 'classify-1',
    })
    const drafted = await service.draft({
      datasetId: 'classify',
      task: 'classify each row as fruit or vehicle using text',
    })
    expect(drafted.metadata.questionKind).toBe('choice')
    expect(drafted.metadata.classes).toEqual(['fruit', 'vehicle'])
    expect(parseJevQueryJson(drafted.query)).toEqual({
      type: 'choice',
      instructions: 'Classify the row.',
      criteria: { fruit: 'the fruit class', vehicle: 'the vehicle class' },
    })
  })

  it('recovers Choice classes from label_hint when the task has no class names', async () => {
    const classifyDataset = {
      datasetId: 'classify',
      fixtureId: 'classify',
      sourceType: 'upload' as const,
      displayName: 'classify.csv',
      columns: ['id', 'text', 'label_hint'],
      rows: [
        { id: 1, text: 'apple', label_hint: 'fruit' },
        { id: 2, text: 'truck', label_hint: 'vehicle' },
      ],
    }
    const service = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      classifier: makeClassifier([]),
      draftProvider: {
        async draft() {
          return {
            query: JSON.stringify({ type: 'choice', instructions: 'Classify each row.', criteria: {} }),
            model: 'openrouter/test',
            questionKind: 'choice' as const,
          }
        },
      },
      datasets: new InMemoryDatasetSource([classifyDataset]),
      now: () => 1_800_000_000_000,
      idFactory: () => 'classify-2',
    })
    const drafted = await service.draft({
      datasetId: 'classify',
      task: 'Classify each row using the visible columns.',
    })
    expect(drafted.metadata.questionKind).toBe('choice')
    expect(drafted.metadata.classes).toEqual(['fruit', 'vehicle'])
  })

  it('throws INVALID_CLASSES when a Choice draft has exactly one unrecoverable class', async () => {
    const numbersDataset = {
      datasetId: 'scores',
      fixtureId: 'scores',
      sourceType: 'upload' as const,
      displayName: 'scores.csv',
      columns: ['id', 'value'],
      rows: [{ id: 1, value: 3 }, { id: 2, value: 7 }],
    }
    const service = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      classifier: makeClassifier([]),
      draftProvider: {
        async draft() {
          return {
            query: JSON.stringify({ type: 'choice', instructions: 'Classify the row.', criteria: { odd: 'odd numbers' } }),
            model: 'openrouter/test',
            questionKind: 'choice' as const,
            classes: ['odd'],
          }
        },
      },
      datasets: new InMemoryDatasetSource([numbersDataset]),
      now: () => 1_800_000_000_000,
      idFactory: () => 'scores-1',
    })
    await expect(service.draft({
      datasetId: 'scores',
      task: 'Classify each row using the visible columns.',
    })).rejects.toMatchObject({ code: 'INVALID_CLASSES' })
  })

  it('reuses a successful draft for the same dataset and normalized task without calling the provider', async () => {
    const draftCalls: unknown[] = []
    const store = new InMemoryAnalysisStore()
    const make = () => new AnalysisService({
      store,
      classifier: makeClassifier([]),
      datasets: new InMemoryDatasetSource([ticketsDataset]),
      draftProvider: {
        async draft(input) {
          draftCalls.push(input)
          return {
            query: JSON.stringify({ type: 'choice', instructions: 'Classify each ticket.', criteria: { urgent: 'urgent tickets', routine: 'routine tickets' } }),
            model: 'openrouter/test',
            questionKind: 'choice' as const,
            classes: ['urgent', 'routine'],
          }
        },
      },
      now: () => 1_800_000_000_000,
      idFactory: () => 'draft-cache-1',
    })
    const task = 'Classify each ticket as urgent or routine using the message.'
    const first = await make().draft({ datasetId: 'tickets', task })
    const second = await make().draft({ datasetId: 'tickets', task: `  ${task}  ` })
    const collapsed = await make().draft({ datasetId: 'tickets', task: 'Classify  each   ticket as urgent or routine using the message.' })
    expect(draftCalls).toHaveLength(1)
    expect(second).toEqual(first)
    expect(collapsed).toEqual(first)
    expect(parseJevQueryJson(second.query)).toEqual({
      type: 'choice',
      instructions: 'Classify each ticket.',
      criteria: { urgent: 'urgent tickets', routine: 'routine tickets' },
    })
    expect(first.metadata.cacheWrite).toBe('ok')
    expect(second.metadata.cacheWrite).toBe('ok')
  })

  it('skips the provider and dataset load on a second draft when datasetId is already known', async () => {
    const draftCalls: unknown[] = []
    let loads = 0
    const datasets = {
      async get(datasetId: string) {
        loads += 1
        return datasetId === ticketsDataset.datasetId ? ticketsDataset : undefined
      },
    }
    const store = new InMemoryAnalysisStore()
    const make = () => new AnalysisService({
      store,
      classifier: makeClassifier([]),
      datasets,
      draftProvider: {
        async draft(input) {
          draftCalls.push(input)
          return {
            query: JSON.stringify({ type: 'choice', instructions: 'Classify each ticket.', criteria: { urgent: 'urgent', routine: 'routine' } }),
            model: 'openrouter/test',
            questionKind: 'choice' as const,
            classes: ['urgent', 'routine'],
          }
        },
      },
      now: () => 1_800_000_000_000,
      idFactory: () => 'draft-fast-1',
    })
    const task = 'Classify each ticket as urgent or routine using the message.'
    const first = await make().draft({ datasetId: 'tickets', task })
    expect(loads).toBe(1)
    expect(draftCalls).toHaveLength(1)
    const second = await make().draft({ datasetId: 'tickets', task })
    expect(second.query).toBe(first.query)
    expect(second.metadata.cacheWrite).toBe('ok')
    expect(loads).toBe(1)
    expect(draftCalls).toHaveLength(1)
  })

  it('logs draft cache write failures and still returns the drafted query', async () => {
    const errors: unknown[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args) })
    const store = new InMemoryAnalysisStore()
    store.putDraft = () => { throw new Error('convex draft put failed') }
    const service = new AnalysisService({
      store,
      classifier: makeClassifier([]),
      datasets: new InMemoryDatasetSource([ticketsDataset]),
      draftProvider: {
        async draft() {
          return {
            query: JSON.stringify({ type: 'choice', instructions: 'Classify each ticket.', criteria: { urgent: 'urgent', routine: 'routine' } }),
            model: 'openrouter/test',
            questionKind: 'choice' as const,
            classes: ['urgent', 'routine'],
          }
        },
      },
      now: () => 1_800_000_000_000,
      idFactory: () => 'draft-write-fail',
    })
    try {
      const drafted = await service.draft({ datasetId: 'tickets', task: 'Classify each ticket as urgent or routine using the message.' })
      expect(parseJevQueryJson(drafted.query)).toEqual(expect.objectContaining({ type: 'choice' }))
      expect(drafted.metadata.cacheWrite).toBe('skipped')
      expect(errors.some((entry) => Array.isArray(entry) && entry[0] === '[analysis] draft cache write failed')).toBe(true)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('does not cache failed drafts or INVALID_CLASSES', async () => {
    const draftCalls: unknown[] = []
    let shouldFail = true
    const numbersDataset = {
      datasetId: 'scores',
      fixtureId: 'scores',
      sourceType: 'upload' as const,
      displayName: 'scores.csv',
      columns: ['id', 'value'],
      rows: [{ id: 1, value: 3 }, { id: 2, value: 7 }],
    }
    const service = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      classifier: makeClassifier([]),
      datasets: new InMemoryDatasetSource([numbersDataset]),
      draftProvider: {
        async draft() {
          draftCalls.push({})
          if (shouldFail) {
            return {
              query: JSON.stringify({ type: 'choice', instructions: 'Classify the row.', criteria: { odd: 'odd numbers' } }),
              model: 'openrouter/test',
              questionKind: 'choice' as const,
              classes: ['odd'],
            }
          }
          return {
            query: JSON.stringify({ type: 'choice', instructions: 'Classify the row.', criteria: { odd: 'odd', even: 'even' } }),
            model: 'openrouter/test',
            questionKind: 'choice' as const,
            classes: ['odd', 'even'],
          }
        },
      },
      now: () => 1_800_000_000_000,
      idFactory: () => 'scores-retry',
    })
    const task = 'Classify each row using the visible columns.'
    await expect(service.draft({ datasetId: 'scores', task })).rejects.toMatchObject({ code: 'INVALID_CLASSES' })
    shouldFail = false
    const recovered = await service.draft({ datasetId: 'scores', task })
    expect(draftCalls).toHaveLength(2)
    expect(recovered.metadata.classes).toEqual(['odd', 'even'])
  })

  it('starts a Noul run from edited Jev query JSON', async () => {
    const jsonQuery = JSON.stringify({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY }, null, 2)
    const service = serviceWith(makeClassifier([]))
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: jsonQuery })
    expect(started.questionKind).toBe('noul')
    expect(started.classes).toEqual([])
    expect(started.query).toBe(jsonQuery)
    expect(started.progress.totalRows).toBe(71)
    expect(started.columns).toEqual(expect.arrayContaining(['posteam_score', 'defteam_score', 'score_differential']))
  })

  it('runs a Noul win-likelihood analysis from Jev values, not CSV wpa', async () => {
    const calls: Array<{ questionKind?: string; row: Record<string, unknown> }> = []
    const classifier: AnalysisClassifier = {
      async classify(input) {
        calls.push({ questionKind: input.questionKind, row: input.row })
        return { model: 'jev-latest', questionKind: 'noul', value: 0.41 }
      },
    }
    const service = serviceWith(classifier)
    const started = await service.start({
      fixtureId: FOOTBALL_FIXTURE_ID,
      query: SAMPLE_WIN_NOUL_QUERY,
      questionKind: 'noul',
    })
    const completed = await service.run(started.analysisId)
    const expected = getWinLikelihoodModelInput(footballFixture)
    expect(started.questionKind).toBe('noul')
    expect(started.progress.totalRows).toBe(71)
    expect(completed.resultRows).toHaveLength(71)
    expect(completed.resultRows[0]).toEqual(expect.objectContaining({ value: 0.41 }))
    expect(completed.resultRows[0]?.selectedClass).toBeUndefined()
    expect(calls).toHaveLength(71)
    expect(calls[0]?.questionKind).toBe('noul')
    expect(calls[0]?.row).toHaveProperty('wpa')
    expect(calls[0]?.row).toMatchObject({
      play_id: expected[0]?.play_id,
      posteam_score: expected[0]?.posteam_score,
      defteam_score: expected[0]?.defteam_score,
      score_differential: expected[0]?.score_differential,
    })
    expect(calls.some((call) => Number(call.row.qtr) >= 3)).toBe(true)
    expect(calls.map((call) => call.row.play_id)).toEqual(expected.map((row) => row.play_id))
    expect(calls.every((call) => typeof call.row.posteam_score === 'number' && typeof call.row.defteam_score === 'number')).toBe(true)
    expect(completed.resultRows.every((row) => row.value === 0.41 && row.value !== row.input.wpa)).toBe(true)
    expect(completed.resultRows[0]?.input).toEqual(expected[0])
    expect(completed.resultRows.at(-1)?.input).toEqual(expected.at(-1))
  })

  it('runs play-quality Score over all 71 plays, not the H1 Choice slice', async () => {
    const calls: Array<{ questionKind?: string; row: Record<string, unknown> }> = []
    const classifier: AnalysisClassifier = {
      async classify(input) {
        calls.push({ questionKind: input.questionKind, row: input.row })
        return { model: 'jev-latest', questionKind: 'score', value: 0.62 }
      },
    }
    const service = serviceWith(classifier)
    const query = JSON.stringify({
      type: 'score',
      instructions: SAMPLE_PLAY_QUALITY_QUERY,
      criteria: [...SAMPLE_PLAY_QUALITY_LEVELS],
    }, null, 2)
    const started = await service.start({
      fixtureId: FOOTBALL_FIXTURE_ID,
      query,
      questionKind: 'score',
      classes: [...SAMPLE_PLAY_QUALITY_LEVELS],
    })
    const completed = await service.run(started.analysisId)
    const expected = getWinLikelihoodModelInput(footballFixture)
    expect(started.questionKind).toBe('score')
    expect(started.progress.totalRows).toBe(71)
    expect(completed.resultRows).toHaveLength(71)
    expect(calls).toHaveLength(71)
    expect(calls[0]?.questionKind).toBe('score')
    expect(calls.some((call) => Number(call.row.qtr) >= 3)).toBe(true)
    expect(calls.map((call) => call.row.play_id)).toEqual(expected.map((row) => row.play_id))
  })

  it('runs only H1 rows, reports bounded progress, and sorts replay rows deterministically', async () => {
    const calls: unknown[] = []
    const service = serviceWith(makeClassifier(calls))
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses })
    expect(started.status).toBe('queued')
    expect(started.progress).toEqual({ completedRows: 0, totalRows: 39, completedCalls: 0, totalCalls: 39 })

    const completed = await service.run(started.analysisId)
    expect(completed.status).toBe('complete')
    expect(completed.resultRows).toHaveLength(39)
    expect(completed.resultRows.map((row) => row.rowIndex)).toEqual([...Array(39).keys()])
    expect(completed.progress).toEqual({ completedRows: 39, totalRows: 39, completedCalls: 39, totalCalls: 39 })
    expect(calls).toHaveLength(39)
    for (const call of calls as Array<{ row: Record<string, unknown> }>) {
      expect(call.row).not.toHaveProperty('game_date')
      expect(call.row).not.toHaveProperty('posteam_score')
      expect(call.row).not.toHaveProperty('defteam_score')
      expect(call.row).not.toHaveProperty('final_score')
    }
    expect(completed.resultRows[0]?.input).toEqual(getHalftimeModelInput(footballFixture)[0])
  })

  it('coalesces duplicate runs and never invokes Jev twice', async () => {
    const calls: unknown[] = []
    let resolve: ((value: ReturnType<typeof classification>) => void) | undefined
    let invocation = 0
    const classifier: AnalysisClassifier = {
      classify: vi.fn(() => {
        invocation += 1
        if (invocation === 1) return new Promise<ReturnType<typeof classification>>((done) => { resolve = done })
        return Promise.resolve(classification())
      }),
    }
    const service = serviceWith(classifier)
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses })
    const first = service.run(started.analysisId)
    const second = service.run(started.analysisId)
    await vi.waitFor(() => expect(classifier.classify).toHaveBeenCalled())
    resolve?.(classification())
    await expect(Promise.all([first, second])).resolves.toSatisfy((results: AnalysisSnapshot[]) => results[0] === results[1])
    expect(classifier.classify).toHaveBeenCalledTimes(39)
    expect(calls).toHaveLength(0)
  })

  it('rejects an invalid fixture and invalid query before any provider call', async () => {
    const calls: unknown[] = []
    const service = serviceWith(makeClassifier(calls))
    await expect(service.start({ fixtureId: 'not-the-fixture', query, classes: choiceClasses })).rejects.toMatchObject({ code: 'DATASET_NOT_FOUND', statusCode: 404 })
    await expect(service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: '  ', classes: choiceClasses })).rejects.toMatchObject({ code: 'INVALID_QUERY', statusCode: 400 })
    await expect(service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: 'x'.repeat(20_001), classes: choiceClasses })).rejects.toMatchObject({ code: 'INVALID_QUERY', statusCode: 400 })
    expect(calls).toHaveLength(0)
  })

  it('returns a bounded share snapshot without invoking a provider', async () => {
    const calls: unknown[] = []
    const service = serviceWith(makeClassifier(calls))
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses })
    const shared = await service.share(started.analysisId)
    expect(shared).toEqual(expect.objectContaining({ analysisId: started.analysisId, fixtureId: FOOTBALL_FIXTURE_ID, status: 'queued' }))
    expect(JSON.stringify(shared)).not.toContain('OPENROUTER_KEY')
    expect(calls).toHaveLength(0)
  })

  it('starts the next classify without waiting for the previous Convex put', async () => {
    const store = new InMemoryAnalysisStore()
    const originalPut = store.put.bind(store)
    let releasePuts: (() => void) | undefined
    const holdPuts = new Promise<void>((resolve) => { releasePuts = resolve })
    store.put = (snapshot) => {
      if (snapshot.status === 'running' && snapshot.resultRows.length > 0) {
        return holdPuts.then(() => originalPut(snapshot))
      }
      originalPut(snapshot)
    }
    let inflight = 0
    let peakInflight = 0
    const startedAt: number[] = []
    const classifier: AnalysisClassifier = {
      async classify(input) {
        startedAt.push(input.rowIndex)
        inflight += 1
        peakInflight = Math.max(peakInflight, inflight)
        await Promise.resolve()
        inflight -= 1
        return byodClassification()
      },
    }
    const service = new AnalysisService({
      store,
      classifier,
      draftProvider: makeDraftProvider([]),
      datasets: new InMemoryDatasetSource([ticketsDataset]),
      now: () => 1_800_000_000_000,
      idFactory: () => 'byod-1',
    })
    const started = await service.start({ datasetId: 'tickets', query: byodTicketQuery, classes: ['urgent', 'routine'] })
    expect(started.status).toBe('queued')
    expect(started.progress.totalRows).toBe(3)
    const running = service.run(started.analysisId)
    await vi.waitFor(() => expect(startedAt).toHaveLength(3))
    expect(peakInflight).toBeGreaterThan(1)
    expect(store.get('byod-1')?.resultRows ?? []).toHaveLength(0)
    releasePuts?.()
    const completed = await running
    expect(completed.status).toBe('complete')
    expect(completed.resultRows.map((row) => row.rowIndex)).toEqual([0, 1, 2])
    expect(completed.progress).toEqual({ completedRows: 3, totalRows: 3, completedCalls: 3, totalCalls: 3 })
  })

  it('merges out-of-order Jev completions by rowIndex and keeps a bounded pool', async () => {
    const store = new InMemoryAnalysisStore()
    const order: number[] = []
    const gates = ticketsDataset.rows.map(() => {
      let release: (value: void) => void = () => undefined
      const promise = new Promise<void>((resolve) => { release = resolve })
      return { promise, release }
    })
    const classifier: AnalysisClassifier = {
      async classify(input) {
        await gates[input.rowIndex]?.promise
        order.push(input.rowIndex)
        return byodClassification()
      },
    }
    const service = new AnalysisService({
      store,
      classifier,
      draftProvider: makeDraftProvider([]),
      datasets: new InMemoryDatasetSource([ticketsDataset]),
      now: () => 1_800_000_000_000,
      idFactory: () => 'byod-pool',
    })
    const started = await service.start({ datasetId: 'tickets', query: byodTicketQuery, classes: ['urgent', 'routine'] })
    const running = service.run(started.analysisId)
    await vi.waitFor(() => expect(store.get('byod-pool')?.status).toBe('running'))
    gates[2]?.release()
    await vi.waitFor(() => expect(store.get('byod-pool')?.resultRows.map((row) => row.rowIndex)).toEqual([2]))
    expect(store.get('byod-pool')?.progress.completedRows).toBe(1)
    gates[0]?.release()
    await vi.waitFor(() => expect(store.get('byod-pool')?.resultRows.map((row) => row.rowIndex)).toEqual([0, 2]))
    gates[1]?.release()
    const completed = await running
    expect(order).toEqual([2, 0, 1])
    expect(completed.resultRows.map((row) => row.rowIndex)).toEqual([0, 1, 2])
    expect(completed.status).toBe('complete')
    expect(completed.progress.completedRows).toBe(3)
  })

  it('coalesces overlapping snapshot puts onto the latest snapshot', async () => {
    const writes: number[] = []
    let release: (() => void) | undefined
    const hold = new Promise<void>((resolve) => { release = resolve })
    let startedFirst: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => { startedFirst = resolve })
    const pipeline = createSnapshotWritePipeline(async (snapshot) => {
      writes.push(snapshot.progress.completedRows)
      startedFirst?.()
      if (writes.length === 1) await hold
    })
    const queued: AnalysisSnapshot = {
      analysisId: 'pipe-1',
      fixtureId: 'tickets',
      datasetId: 'tickets',
      sourceType: 'upload',
      query: byodTicketQuery,
      status: 'running',
      createdAt: '2026-09-18T00:00:00.000Z',
      updatedAt: '2026-09-18T00:00:00.000Z',
      progress: { completedRows: 0, totalRows: 3, completedCalls: 0, totalCalls: 3 },
      classes: ['urgent', 'routine'],
      columns: ['message'],
      resultRows: [],
    }
    pipeline.enqueue({ ...queued, progress: { ...queued.progress, completedRows: 1, completedCalls: 1 } })
    await firstStarted
    pipeline.enqueue({ ...queued, progress: { ...queued.progress, completedRows: 2, completedCalls: 2 } })
    pipeline.enqueue({ ...queued, progress: { ...queued.progress, completedRows: 3, completedCalls: 3 } })
    await vi.waitFor(() => expect(writes).toEqual([1]))
    release?.()
    await pipeline.flush()
    expect(writes[0]).toBe(1)
    expect(writes.at(-1)).toBe(3)
    expect(writes).not.toContain(2)
  })

  it('fails the run when a snapshot put fails after classifications land', async () => {
    const store = new InMemoryAnalysisStore()
    const originalPut = store.put.bind(store)
    store.put = (snapshot) => {
      if (snapshot.status === 'running' && snapshot.resultRows.length > 0) throw new Error('convex write qps')
      originalPut(snapshot)
    }
    const service = new AnalysisService({
      store,
      classifier: { async classify() { return byodClassification() } },
      draftProvider: makeDraftProvider([]),
      datasets: new InMemoryDatasetSource([ticketsDataset]),
      now: () => 1_800_000_000_000,
      idFactory: () => 'byod-put-fail',
    })
    const started = await service.start({ datasetId: 'tickets', query: byodTicketQuery, classes: ['urgent', 'routine'] })
    const failed = await service.run(started.analysisId)
    expect(failed.status).toBe('error')
    expect(failed.error).toEqual({ code: 'ANALYSIS_STORAGE_ERROR', retryable: true })
    expect(JSON.stringify(failed)).not.toMatch(/convex write qps/i)
    expect(store.get('byod-put-fail')?.status).toBe('error')
    expect(store.get('byod-put-fail')?.error).toEqual({ code: 'ANALYSIS_STORAGE_ERROR', retryable: true })
  })

  it('merges incremental snapshot puts so a later row does not drop earlier rows', () => {
    const store = new InMemoryAnalysisStore()
    const base: AnalysisSnapshot = {
      analysisId: 'merge-rows',
      fixtureId: 'tickets',
      datasetId: 'tickets',
      sourceType: 'upload',
      query: byodTicketQuery,
      status: 'running',
      createdAt: '2026-09-18T00:00:00.000Z',
      updatedAt: '2026-09-18T00:00:00.000Z',
      progress: { completedRows: 1, totalRows: 3, completedCalls: 1, totalCalls: 3 },
      classes: ['urgent', 'routine'],
      columns: ['message'],
      resultRows: [{ rowIndex: 0, input: { message: 'one' }, model: 'jev-latest', selectedClass: 'urgent', probabilities: { urgent: 0.7, routine: 0.3 } }],
    }
    store.put(base)
    store.put({
      ...base,
      progress: { completedRows: 2, totalRows: 3, completedCalls: 2, totalCalls: 3 },
      resultRows: [{ rowIndex: 2, input: { message: 'three' }, model: 'jev-latest', selectedClass: 'routine', probabilities: { urgent: 0.2, routine: 0.8 } }],
    })
    expect(store.get('merge-rows')?.resultRows.map((row) => row.rowIndex)).toEqual([0, 2])
    store.put({ ...base, status: 'error', resultRows: [], error: { code: 'ANALYSIS_STORAGE_ERROR', retryable: true } })
    expect(store.get('merge-rows')).toMatchObject({
      status: 'error',
      resultRows: [expect.objectContaining({ rowIndex: 0 }), expect.objectContaining({ rowIndex: 2 })],
    })
  })

  it('heals a lease-dead frozen running snapshot on get so Resume can continue', async () => {
    const store = new InMemoryAnalysisStore()
    const now = 1_800_000_000_000
    const service = new AnalysisService({
      store,
      classifier: makeClassifier([]),
      draftProvider: makeDraftProvider([]),
      datasets: new InMemoryDatasetSource([ticketsDataset]),
      now: () => now,
      idFactory: () => 'stalled-run',
    })
    const started = await service.start({ datasetId: 'tickets', query: byodTicketQuery, classes: ['urgent', 'routine'] })
    store.put({
      ...started,
      status: 'running',
      updatedAt: new Date(now - 61_000).toISOString(),
      progress: { completedRows: 2, totalRows: 3, completedCalls: 2, totalCalls: 3 },
      resultRows: [
        { rowIndex: 0, input: ticketsDataset.rows[0], model: 'jev-latest', selectedClass: 'urgent', probabilities: { urgent: 0.7, routine: 0.3 } },
        { rowIndex: 1, input: ticketsDataset.rows[1], model: 'jev-latest', selectedClass: 'urgent', probabilities: { urgent: 0.7, routine: 0.3 } },
      ],
    })
    await expect(service.get(started.analysisId)).resolves.toMatchObject({
      status: 'error',
      progress: { completedRows: 2 },
      error: { code: 'ANALYSIS_RUN_STALLED', retryable: true },
    })
    const recovered = await service.start({
      datasetId: 'tickets',
      query: byodTicketQuery,
      analysisId: started.analysisId,
      classes: ['urgent', 'routine'],
      resume: true,
    })
    expect(recovered).toMatchObject({ status: 'queued', progress: { completedRows: 2 } })
  })

  it('does not heal a live leased running snapshot', async () => {
    const store = new InMemoryAnalysisStore()
    const now = 1_800_000_000_000
    const service = new AnalysisService({
      store,
      classifier: makeClassifier([]),
      draftProvider: makeDraftProvider([]),
      datasets: new InMemoryDatasetSource([ticketsDataset]),
      now: () => now,
      idFactory: () => 'live-lease',
    })
    const started = await service.start({ datasetId: 'tickets', query: byodTicketQuery, classes: ['urgent', 'routine'] })
    expect(store.claim(started.analysisId, 'owner-live', now, 300_000)).toBe('claimed')
    store.put({
      ...started,
      status: 'running',
      updatedAt: new Date(now - 61_000).toISOString(),
    })
    await expect(service.get(started.analysisId)).resolves.toMatchObject({ status: 'running' })
  })

  it('keeps bounds explicit for future fixtures', () => {
    expect(ANALYSIS_MAX_CALLS).toBe(5_000)
    expect(ANALYSIS_MAX_ROWS).toBe(5_000)
    expect(ANALYSIS_CLASSIFY_CONCURRENCY).toBe(6)
    expect(FOOTBALL_FIXTURE_SCHEMA).toHaveLength(31)
    expect(consecutiveCompletedRows([{ rowIndex: 0 }, { rowIndex: 2 }])).toBe(1)
    expect(pendingRowIndexes(4, [{ rowIndex: 0 }, { rowIndex: 2 }])).toEqual([1, 3])
  })

  it('requeues retryable provider failures and resumes from the persisted partial result', async () => {
    let calls = 0
    const classifier: AnalysisClassifier = {
      async classify() {
        calls += 1
        if (calls === 2) throw new AnalysisError('JEV_TIMEOUT', 'timeout', 504, true)
        return classification()
      },
    }
    const service = serviceWith(classifier)
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, analysisId: 'recoverable-analysis', classes: choiceClasses })
    const failed = await service.run(started.analysisId)
    expect(failed).toMatchObject({ status: 'error', progress: { completedRows: 1 }, error: { code: 'JEV_TIMEOUT', retryable: true } })
    const recovered = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, analysisId: started.analysisId })
    expect(recovered).toMatchObject({ status: 'queued', progress: { completedRows: 1 }, resultRows: expect.arrayContaining([expect.objectContaining({ rowIndex: 0 })]) })
    await expect(service.run(started.analysisId)).resolves.toMatchObject({ status: 'complete', progress: { completedRows: 39 } })
  })

  it('requeues a stale running snapshot without dropping completed rows', async () => {
    const store = new InMemoryAnalysisStore()
    const service = new AnalysisService({
      store,
      classifier: makeClassifier([]),
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'stale-analysis',
      now: () => 1_800_000_000_000,
    })
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, classes: choiceClasses })
    store.put({ ...started, status: 'running', updatedAt: new Date(1_800_000_000_000 - 16 * 60_000).toISOString(), progress: { ...started.progress, completedRows: 2, completedCalls: 2 }, resultRows: [{ ...classification(), rowIndex: 0, input: getHalftimeModelInput(footballFixture)[0] }, { ...classification(), rowIndex: 1, input: getHalftimeModelInput(footballFixture)[1] }] })
    await expect(service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query })).resolves.toMatchObject({ status: 'queued', progress: { completedRows: 2 }, resultRows: expect.any(Array) })
  })

  it('reuses a complete sample snapshot for the same dataset and query without invoking the classifier', async () => {
    const calls: unknown[] = []
    const store = new InMemoryAnalysisStore()
    const classifier: AnalysisClassifier = {
      async classify(input) {
        calls.push(input)
        return { model: 'jev-latest', questionKind: 'noul', value: 0.41 }
      },
    }
    const first = new AnalysisService({
      store,
      classifier,
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'analysis-a',
      now: () => 1_800_000_000_000,
    })
    const second = new AnalysisService({
      store,
      classifier,
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'analysis-b',
      now: () => 1_800_000_000_000,
    })
    const jsonQuery = JSON.stringify({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY }, null, 2)
    const started = await first.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: jsonQuery, questionKind: 'noul' })
    const completed = await first.run(started.analysisId)
    expect(completed.status).toBe('complete')
    expect(calls).toHaveLength(71)

    const reused = await second.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' })
    expect(reused.analysisId).toBe(started.analysisId)
    expect(reused.status).toBe('complete')
    expect(reused.resultRows).toHaveLength(71)
    await expect(second.run(reused.analysisId)).resolves.toMatchObject({ analysisId: started.analysisId, status: 'complete' })
    expect(calls).toHaveLength(71)
    expect(store.get('analysis-b')).toBeUndefined()
    const forced = await second.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul', forceNew: true })
    expect(forced).toMatchObject({ analysisId: 'analysis-b', status: 'queued' })
    expect(calls).toHaveLength(71)
  })

  it('returns the same analysisId on a second start without classifier or dataset load', async () => {
    const calls: unknown[] = []
    let loads = 0
    const datasets = {
      async get(datasetId: string) {
        loads += 1
        return datasetId === ticketsDataset.datasetId ? ticketsDataset : undefined
      },
    }
    const store = new InMemoryAnalysisStore()
    const classifier: AnalysisClassifier = {
      async classify(input) {
        calls.push(input)
        return byodClassification()
      },
    }
    const make = (id: string) => new AnalysisService({
      store,
      classifier,
      datasets,
      draftProvider: makeDraftProvider([]),
      idFactory: () => id,
      now: () => 1_800_000_000_000,
    })
    const first = make('byod-fast-a')
    const started = await first.start({ datasetId: 'tickets', query: byodTicketQuery, classes: ['urgent', 'routine'] })
    await first.run(started.analysisId)
    expect(calls).toHaveLength(3)
    expect(loads).toBeGreaterThanOrEqual(1)
    const loadsAfterFirst = loads
    const reused = await make('byod-fast-b').start({ datasetId: 'tickets', query: byodTicketQuery, classes: ['urgent', 'routine'] })
    expect(reused.analysisId).toBe(started.analysisId)
    expect(reused.status).toBe('complete')
    expect(calls).toHaveLength(3)
    expect(loads).toBe(loadsAfterFirst)
  })

  it('creates a new run when the sample query differs', async () => {
    const calls: unknown[] = []
    const store = new InMemoryAnalysisStore()
    const classifier: AnalysisClassifier = {
      async classify(input) {
        calls.push(input)
        return { model: 'jev-latest', questionKind: 'noul', value: 0.41 }
      },
    }
    const first = new AnalysisService({
      store,
      classifier,
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'analysis-a',
      now: () => 1_800_000_000_000,
    })
    const second = new AnalysisService({
      store,
      classifier,
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'analysis-b',
      now: () => 1_800_000_000_000,
    })
    const started = await first.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' })
    await first.run(started.analysisId)
    const other = await second.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: 'Will the away team cover the spread?', questionKind: 'noul' })
    expect(other.analysisId).toBe('analysis-b')
    expect(other.status).toBe('queued')
    expect(other.analysisId).not.toBe(started.analysisId)
    await second.run(other.analysisId)
    expect(calls).toHaveLength(142)
  })

  it('reuses a complete BYOD snapshot for the same datasetId and query without invoking the classifier', async () => {
    const calls: unknown[] = []
    const store = new InMemoryAnalysisStore()
    const datasets = new InMemoryDatasetSource([ticketsDataset])
    const classifier: AnalysisClassifier = {
      async classify(input) {
        calls.push(input)
        return byodClassification()
      },
    }
    const first = new AnalysisService({
      store,
      classifier,
      datasets,
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'byod-a',
      now: () => 1_800_000_000_000,
    })
    const second = new AnalysisService({
      store,
      classifier,
      datasets,
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'byod-b',
      now: () => 1_800_000_000_000,
    })
    const started = await first.start({ datasetId: 'tickets', query: byodTicketQuery, classes: ['urgent', 'routine'] })
    const completed = await first.run(started.analysisId)
    expect(completed.status).toBe('complete')
    expect(calls).toHaveLength(3)

    const reused = await second.start({ datasetId: 'tickets', query: byodTicketQuery, classes: ['routine', 'urgent'] })
    expect(reused.analysisId).toBe(started.analysisId)
    expect(reused.status).toBe('complete')
    expect(reused.resultRows).toHaveLength(3)
    await expect(second.run(reused.analysisId)).resolves.toMatchObject({ analysisId: started.analysisId, status: 'complete' })
    expect(calls).toHaveLength(3)
    expect(store.get('byod-b')).toBeUndefined()
  })

  it('creates a new BYOD run when the query or datasetId differs', async () => {
    const calls: unknown[] = []
    const store = new InMemoryAnalysisStore()
    const datasets = new InMemoryDatasetSource([ticketsDataset, invoicesDataset])
    const classifier: AnalysisClassifier = {
      async classify(input) {
        calls.push(input)
        return byodClassification()
      },
    }
    const make = (id: string) => new AnalysisService({
      store,
      classifier,
      datasets,
      draftProvider: makeDraftProvider([]),
      idFactory: () => id,
      now: () => 1_800_000_000_000,
    })
    const first = make('byod-a')
    const started = await first.start({ datasetId: 'tickets', query: byodTicketQuery, classes: ['urgent', 'routine'] })
    await first.run(started.analysisId)

    const differentQuery = await make('byod-query').start({
      datasetId: 'tickets',
      query: 'Flag refund requests instead.',
      classes: ['urgent', 'routine'],
    })
    expect(differentQuery.analysisId).toBe('byod-query')
    expect(differentQuery.status).toBe('queued')
    await make('byod-query').run(differentQuery.analysisId)

    const differentDataset = await make('byod-dataset').start({
      datasetId: 'invoices',
      query: byodTicketQuery,
      classes: ['urgent', 'routine'],
    })
    expect(differentDataset.analysisId).toBe('byod-dataset')
    expect(differentDataset.status).toBe('queued')
    await make('byod-dataset').run(differentDataset.analysisId)

    expect(calls).toHaveLength(9)
  })

  it('does not reuse an errored snapshot and mints a new analysis for the next visitor', async () => {
    const store = new InMemoryAnalysisStore()
    const classifier: AnalysisClassifier = {
      async classify() {
        throw new AnalysisError('JEV_TIMEOUT', 'timeout', 504, false)
      },
    }
    const first = new AnalysisService({
      store,
      classifier,
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'analysis-error-1',
      now: () => 1_800_000_000_000,
    })
    const started = await first.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' })
    await expect(first.run(started.analysisId)).resolves.toMatchObject({ status: 'error' })
    const second = new AnalysisService({
      store,
      classifier: { async classify() { return { model: 'jev-latest', questionKind: 'noul', value: 0.5 } } },
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'analysis-error-2',
      now: () => 1_800_000_000_000,
    })
    const retry = await second.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' })
    expect(retry.analysisId).toBe('analysis-error-2')
    expect(retry.status).toBe('queued')
  })

  it('joins an in-flight queued run for the same content key instead of minting a duplicate', async () => {
    const store = new InMemoryAnalysisStore()
    const calls: unknown[] = []
    const classifier: AnalysisClassifier = {
      async classify(input) {
        calls.push(input)
        return { model: 'jev-latest', questionKind: 'noul', value: 0.41 }
      },
    }
    const first = new AnalysisService({
      store,
      classifier,
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'analysis-inflight-a',
      now: () => 1_800_000_000_000,
    })
    const second = new AnalysisService({
      store,
      classifier,
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'analysis-inflight-b',
      now: () => 1_800_000_000_000,
    })
    const started = await first.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' })
    expect(started).toMatchObject({ analysisId: 'analysis-inflight-a', status: 'queued' })
    const joined = await second.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' })
    expect(joined.analysisId).toBe(started.analysisId)
    expect(joined.status).toBe('queued')
    expect(store.get('analysis-inflight-b')).toBeUndefined()
    expect(calls).toHaveLength(0)
    const completed = await first.run(started.analysisId)
    expect(completed.status).toBe('complete')
    expect(calls).toHaveLength(71)
    await expect(second.run(joined.analysisId)).resolves.toMatchObject({ analysisId: started.analysisId, status: 'complete' })
    expect(calls).toHaveLength(71)
  })

  it('coalesces concurrent starts for the same content key onto one analysisId', async () => {
    const calls: unknown[] = []
    let nextId = 0
    const service = new AnalysisService({
      store: new InMemoryAnalysisStore(),
      classifier: {
        async classify(input) {
          calls.push(input)
          return { model: 'jev-latest', questionKind: 'noul', value: 0.41 }
        },
      },
      draftProvider: makeDraftProvider([]),
      idFactory: () => `analysis-race-${++nextId}`,
      now: () => 1_800_000_000_000,
    })
    const [left, right] = await Promise.all([
      service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' }),
      service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' }),
    ])
    expect(left.analysisId).toBe(right.analysisId)
    expect(left.status).toBe('queued')
    const completed = await service.run(left.analysisId)
    expect(completed.status).toBe('complete')
    expect(completed.analysisId).toBe(left.analysisId)
    expect(calls).toHaveLength(71)
  })

  it('mints a new analysis with forceNew even when a queued snapshot already exists', async () => {
    const store = new InMemoryAnalysisStore()
    const first = new AnalysisService({
      store,
      classifier: makeClassifier([]),
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'analysis-force-a',
      now: () => 1_800_000_000_000,
    })
    const second = new AnalysisService({
      store,
      classifier: makeClassifier([]),
      draftProvider: makeDraftProvider([]),
      idFactory: () => 'analysis-force-b',
      now: () => 1_800_000_000_000,
    })
    const started = await first.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul' })
    const forced = await second.start({ fixtureId: FOOTBALL_FIXTURE_ID, query: SAMPLE_WIN_NOUL_QUERY, questionKind: 'noul', forceNew: true })
    expect(started.analysisId).toBe('analysis-force-a')
    expect(forced).toMatchObject({ analysisId: 'analysis-force-b', status: 'queued' })
    expect(forced.analysisId).not.toBe(started.analysisId)
  })

  it('resumes a non-retryable mid-run Jev failure from the last good row when asked', async () => {
    let calls = 0
    const classifier: AnalysisClassifier = {
      async classify() {
        calls += 1
        if (calls === 2) throw new AnalysisError('JEV_MALFORMED_RESPONSE', 'bad envelope', 502, false)
        return classification()
      },
    }
    const service = serviceWith(classifier)
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, analysisId: 'malformed-resume', classes: choiceClasses })
    const failed = await service.run(started.analysisId)
    expect(failed).toMatchObject({ status: 'error', progress: { completedRows: 1 }, error: { code: 'JEV_MALFORMED_RESPONSE', retryable: false } })
    const ignored = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, analysisId: started.analysisId, classes: choiceClasses })
    expect(ignored).toMatchObject({ status: 'error', analysisId: started.analysisId })
    const recovered = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, analysisId: started.analysisId, classes: choiceClasses, resume: true })
    expect(recovered).toMatchObject({ status: 'queued', progress: { completedRows: 1 } })
    expect(recovered.error).toBeUndefined()
    await expect(service.run(started.analysisId)).resolves.toMatchObject({ status: 'complete', progress: { completedRows: 39 } })
    expect(calls).toBe(40)
  })

  it('does not reclassify later rows that landed before a fail-fast error', async () => {
    const classified: number[] = []
    let failedRow1 = false
    const classifier: AnalysisClassifier = {
      async classify(input) {
        classified.push(input.rowIndex)
        if (input.rowIndex === 1 && !failedRow1) {
          failedRow1 = true
          throw new AnalysisError('JEV_TIMEOUT', 'timeout', 504, true)
        }
        return classification()
      },
    }
    const service = serviceWith(classifier)
    const started = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, analysisId: 'gap-resume', classes: choiceClasses })
    const failed = await service.run(started.analysisId)
    expect(failed.status).toBe('error')
    expect(failed.progress.completedRows).toBe(1)
    expect(failed.resultRows.some((row) => row.rowIndex === 1)).toBe(false)
    expect(failed.resultRows.map((row) => row.rowIndex)).toEqual(expect.arrayContaining([0, 2]))
    const recovered = await service.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, analysisId: started.analysisId, resume: true })
    expect(recovered.status).toBe('queued')
    const completed = await service.run(started.analysisId)
    expect(completed.status).toBe('complete')
    expect(completed.resultRows).toHaveLength(39)
    expect(classified.filter((rowIndex) => rowIndex === 1)).toHaveLength(2)
    expect(classified.filter((rowIndex) => rowIndex === 2)).toHaveLength(1)
  })

  it('suppresses duplicate execution across independent service instances with a durable claim', async () => {
    const store = new InMemoryAnalysisStore()
    let releaseFirst: (() => void) | undefined
    let calls = 0
    const classifier: AnalysisClassifier = {
      async classify() {
        calls += 1
        if (calls === 1) await new Promise<void>((resolve) => { releaseFirst = resolve })
        return classification()
      },
    }
    const make = () => new AnalysisService({ store, classifier, draftProvider: makeDraftProvider([]), idFactory: () => `owner-${calls}`, now: () => 1_800_000_000_000 })
    const firstService = make()
    const secondService = make()
    const started = await firstService.start({ fixtureId: FOOTBALL_FIXTURE_ID, query, analysisId: 'claimed-analysis', classes: choiceClasses })
    const first = firstService.run(started.analysisId)
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(1))
    await expect(secondService.run(started.analysisId)).resolves.toMatchObject({ status: 'running' })
    expect(calls).toBeLessThan(39 * 2)
    releaseFirst?.()
    await expect(first).resolves.toMatchObject({ status: 'complete' })
  })
})
