import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, canConfirmJevRun, defaultAnalysisApi, hasRunnableQuery, PRODUCT_TITLE, queryRunFooter, type AnalysisApiClient } from './App'
import { getFixtureDatasetPreview } from './dataset/sampleDataset'
import { footballSampleCsv } from './dataset/sampleCsv'
import { FOOTBALL_FIXTURE_ID, getHalftimeModelInput } from './fixtures/footballTimeline'
import { asAnalysisRow } from './shared/dataset'
import type { AnalysisDraftResult, AnalysisSnapshot } from './shared/analysis'
import { SAMPLE_PLAY_QUALITY_LEVELS, SAMPLE_PLAY_QUALITY_QUERY, SAMPLE_PLAY_QUALITY_TASK, SAMPLE_WIN_LIKELIHOOD_TASK, SAMPLE_WIN_NOUL_QUERY, SQUIRREL_EATING_NOUL_QUERY, SQUIRREL_EATING_TASK, INVALID_CLASSES_COPY } from './shared/questionKind'
import { SQUIRREL_FIXTURE_ID } from './fixtures/squirrelCensus'
import { formatDraftQueryForEditor, parseJevQueryJson } from './shared/jevQuery'
import type { DatasetIntakeStatus, DatasetPreview } from './shared/dataset'

const input = asAnalysisRow(getHalftimeModelInput()[0])

const snapshot = (overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot => ({
  analysisId: 'analysis-demo-1',
  fixtureId: FOOTBALL_FIXTURE_ID,
  datasetId: FOOTBALL_FIXTURE_ID,
  sourceType: 'fixture',
  query: 'Classify each row using the visible columns.',
  status: 'complete',
  createdAt: '2026-09-17T18:00:00.000Z',
  updatedAt: '2026-09-17T18:01:00.000Z',
  progress: { completedRows: 1, totalRows: 39, completedCalls: 1, totalCalls: 39 },
  classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'],
  columns: ['play_id', 'posteam'],
  currentFixtureRow: { rowIndex: 0, input },
  resultRows: [{ rowIndex: 0, input, model: 'jev-latest', selectedClass: 'K.Walker', probabilities: { 'K.Walker': 0.72, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.12, 'Other/Tie': 0.06 }, confidence: 0.72 }],
  ...overrides,
})

const draftQueryJson = formatDraftQueryForEditor({
  query: 'Classify each row using the visible columns.',
  questionKind: 'choice',
  classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'],
})
const noulQueryJson = formatDraftQueryForEditor({
  query: SAMPLE_WIN_NOUL_QUERY,
  questionKind: 'noul',
  classes: [],
})

const draft: AnalysisDraftResult = {
  fixtureId: FOOTBALL_FIXTURE_ID,
  datasetId: FOOTBALL_FIXTURE_ID,
  sourceType: 'fixture',
  query: draftQueryJson,
  metadata: { provider: 'openrouter', model: 'openai/gpt-4o-mini', rowCount: 39, inputHalf: 'H1', labelHalf: 'H2', questionKind: 'choice', classes: ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'], columns: ['play_id'], displayName: '2026 Super Bowl Demo' },
}

const uploaded: DatasetPreview = {
  datasetId: 'dataset-upload-1',
  sourceType: 'upload',
  displayName: 'tickets.csv',
  byteSize: 32,
  contentHash: 'abc',
  encoding: 'utf-8',
  delimiter: ',',
  columns: [{ name: 'message', normalizedName: 'message', inferredType: 'string' }, { name: 'tier', normalizedName: 'tier', inferredType: 'string' }],
  acceptedRowCount: 2,
  previewRows: [{ message: 'hello', tier: 'gold' }, { message: 'world', tier: 'silver' }],
  validationWarnings: [],
  publicDataWarning: 'public',
}

const makeApi = (overrides: Partial<AnalysisApiClient> = {}): AnalysisApiClient => ({
  draft: vi.fn(async () => draft),
  start: vi.fn(async (request) => {
    const kind = request.questionKind ?? 'choice'
    if (kind === 'noul') {
      return snapshot({
        analysisId: `analysis-${request.datasetId ?? 'demo'}-noul`,
        datasetId: request.datasetId,
        fixtureId: request.fixtureId,
        query: request.query,
        questionKind: 'noul',
        classes: [],
        status: 'queued',
        progress: { completedRows: 0, totalRows: 71, completedCalls: 0, totalCalls: 71 },
        resultRows: [],
      })
    }
    if (kind === 'score') {
      return snapshot({
        analysisId: `analysis-${request.datasetId ?? 'demo'}-score`,
        datasetId: request.datasetId,
        fixtureId: request.fixtureId,
        query: request.query,
        questionKind: 'score',
        classes: [...SAMPLE_PLAY_QUALITY_LEVELS],
        status: 'queued',
        progress: { completedRows: 0, totalRows: 71, completedCalls: 0, totalCalls: 71 },
        resultRows: [],
      })
    }
    const classes = request.classes ? [...request.classes] : ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie']
    const playerChoice = classes.includes('K.Walker')
    return snapshot({
      analysisId: `analysis-${request.datasetId ?? 'demo'}-choice`,
      datasetId: request.datasetId,
      fixtureId: request.fixtureId,
      query: request.query,
      questionKind: 'choice',
      classes,
      status: playerChoice ? 'queued' : 'complete',
      progress: playerChoice
        ? { completedRows: 0, totalRows: 39, completedCalls: 0, totalCalls: 39 }
        : { completedRows: 39, totalRows: 39, completedCalls: 39, totalCalls: 39 },
      resultRows: [],
      currentFixtureRow: { rowIndex: 0, input },
    })
  }),
  read: vi.fn(async () => snapshot()),
  share: vi.fn(async () => snapshot()),
  intakeStatus: vi.fn(async (): Promise<DatasetIntakeStatus> => ({ convex: true, uploadThing: true, sampleAvailable: true })),
  readDataset: vi.fn(async (datasetId: string) => {
    const preview = getFixtureDatasetPreview(datasetId)
    if (preview) return preview
    throw new Error('DATASET_NOT_FOUND')
  }),
  createFromCsv: vi.fn(async () => uploaded),
  createFromUrl: vi.fn(async (): Promise<DatasetPreview> => ({ ...uploaded, datasetId: 'dataset-url-1', sourceType: 'public_url', displayName: 'remote.csv' })),
  propose: vi.fn(async (input) => ({ datasetId: input.datasetId ?? uploaded.datasetId, insights: [], source: 'empty' as const })),
  ...overrides,
})

const openFixture = (api: AnalysisApiClient, datasetId = FOOTBALL_FIXTURE_ID, search = '') => {
  window.history.pushState({}, '', `/dataset/${datasetId}${search}`)
  return render(<App api={api} />)
}

const enterSample = async (api: AnalysisApiClient, datasetId = FOOTBALL_FIXTURE_ID) => {
  openFixture(api, datasetId)
  await waitFor(() => expect(api.start).toHaveBeenCalled())
}

const startSampleRun = async (api: AnalysisApiClient) => {
  await enterSample(api)
}

const openEngineer = () => {
  fireEvent.click(screen.getByRole('link', { name: /^engineer$/i }))
}

const startEngineerRun = async (api: AnalysisApiClient) => {
  openFixture(api)
  openEngineer()
  fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
  await screen.findByLabelText(/^Jev query JSON$/i)
  fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
  await waitFor(() => expect(document.querySelector('.analysis-card')).toBeTruthy())
}

const analysisCard = (): HTMLElement => document.querySelector('.analysis-card') as HTMLElement

const isPlayerChoiceStart = (request: { questionKind?: string; classes?: readonly string[] }) => (
  request.questionKind === 'choice' && (request.classes ?? []).includes('K.Walker')
)

const expectNamedDashboard = () => {
  expect(Number(document.querySelector('.dashboard-grid')?.getAttribute('data-insight-count'))).toBeGreaterThanOrEqual(2)
}

const expectDiverseDashboard = () => {
  expectNamedDashboard()
  expect(Number(document.querySelector('.dashboard-grid')?.getAttribute('data-visual-kind-count'))).toBeGreaterThanOrEqual(2)
}

describe('Jev insight product flow', () => {
  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
    delete document.documentElement.dataset.theme
    document.documentElement.style.colorScheme = ''
    window.history.pushState({}, '', '/')
  })
  it('renders a quiet idle landing with BYOD only', async () => {
    const api = makeApi()
    render(<App api={api} />)
    expect(screen.getByRole('link', { name: /jev home/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: PRODUCT_TITLE })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /run jev on a csv/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/bring a dataset\. ask a question\. see jev classify every row/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /choose a dataset/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /2026 super bowl demo/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /squirrel census/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Places where they eat.')).not.toBeInTheDocument()
    expect(screen.queryByText(/location vs activity/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/football is the sample, not the product/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/same live chart as the sample/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /upload csv or public https csv url/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^upload csv$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^upload csv$/i })).toBeInTheDocument()
    expect(screen.queryByText(/choose file/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/upload \.csv/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use public csv url/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^2026 super bowl demo$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^squirrel census$/i })).not.toBeInTheDocument()
    expect(document.querySelector('[data-stage="intake"]')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /analysis task/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /jev query json/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /draft task/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /run jev/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/edit jev json/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/review the json/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^engineer$/i })).toBeInTheDocument()
    expect(screen.queryByText(/playground limits|5 mb|5,000|engineer playground|how a run works|demo playground/i)).not.toBeInTheDocument()
    expect(document.querySelector('[data-mode="product"]')).toBeTruthy()
    expect(window.location.search).not.toMatch(/mode=engineer/)
    expect(screen.queryByText(/espn|gamecast|ask a football question|analyze your business/i)).not.toBeInTheDocument()
    expect(api.draft).not.toHaveBeenCalled()
    expect(api.start).not.toHaveBeenCalled()
    await waitFor(() => expect(api.intakeStatus).toHaveBeenCalled())
  })

  it('accepts the public Super Bowl CSV through BYOD upload', async () => {
    const csvText = footballSampleCsv()
    const api = makeApi({
      createFromCsv: vi.fn(async () => ({
        ...uploaded,
        displayName: 'seahawks-super-bowl-2026.csv',
      })),
    })
    render(<App api={api} />)
    const file = new File([csvText], 'seahawks-super-bowl-2026.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    await waitFor(() => expect(api.createFromCsv).toHaveBeenCalledWith({
      csvText,
      filename: 'seahawks-super-bowl-2026.csv',
    }))
    expect(await screen.findByRole('heading', { name: 'seahawks-super-bowl-2026.csv' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^2026 super bowl demo$/i })).not.toBeInTheDocument()
  })

  it('unlocks Run Jev from existing Edit query text without another Draft or forced edit', () => {
    expect(hasRunnableQuery('')).toBe(false)
    expect(hasRunnableQuery('   ')).toBe(false)
    expect(hasRunnableQuery(draft.query)).toBe(true)
    expect(canConfirmJevRun({ query: draft.query, starting: false })).toBe(true)
    expect(canConfirmJevRun({ query: draft.query, starting: true })).toBe(false)
    expect(canConfirmJevRun({ query: '  ', starting: false })).toBe(false)
    expect(canConfirmJevRun({ query: '{not-json', starting: false })).toBe(false)
    expect(canConfirmJevRun({ query: SAMPLE_WIN_LIKELIHOOD_TASK, starting: false })).toBe(false)
    expect(queryRunFooter({ query: draft.query, starting: false, hasSnapshot: false })).toBeUndefined()
    expect(queryRunFooter({ query: draft.query, starting: true, hasSnapshot: false })).toBe('Starting…')
    expect(queryRunFooter({ query: draft.query, starting: false, hasSnapshot: true })).toBeUndefined()
    expect(queryRunFooter({ query: '{not-json', starting: false, hasSnapshot: false })).toBe('Valid Jev JSON required.')
    expect(queryRunFooter({ query: '', starting: false, hasSnapshot: false })).toBe('Enter Jev query JSON before running.')
    expect(queryRunFooter({ query: '', starting: true, hasSnapshot: false })).toBe('Starting…')
  })

  it('does not fetch on sample task editing, and enables Run Jev after draft without a query edit', async () => {
    const api = makeApi()
    openFixture(api)
    expect(document.querySelector('[data-stage="dataset"]')).toBeTruthy()
    expect(window.location.pathname).toBe(`/dataset/${FOOTBALL_FIXTURE_ID}`)
    expect(screen.queryByRole('heading', { name: /choose a dataset/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /run jev on a csv/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/bring a dataset\. ask a question\. see jev classify every row/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: PRODUCT_TITLE })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Analysis task$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /draft task/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/edit jev json/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'SEA win probability' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'SEA play quality' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Play success' })).not.toBeInTheDocument()
    expectNamedDashboard()
    expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument()
    expect(document.querySelector('[data-insight-id="series-win"]')).toHaveAttribute('data-visual', 'series')
    expect(document.querySelector('[data-insight-id="series-play-quality"]')).toHaveAttribute('data-visual', 'series')
    expect(document.querySelector('[data-insight-id="bars-success"]')).toBeNull()
    expect(screen.getByText('71 rows')).toBeInTheDocument()
    expect(screen.getByText(/^26 columns$/)).toBeInTheDocument()
    expect(screen.queryByText(/showing first/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/delimiter/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not evidence of model quality/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^source$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^license$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /2026 super bowl demo/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'posteam_score' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'defteam_score' })).toBeInTheDocument()
    const previewTable = screen.getByRole('table', { name: /dataset preview/i })
    expect(within(previewTable).getByRole('columnheader', { name: 'wpa' })).toBeInTheDocument()
    expect(within(previewTable).getByRole('columnheader', { name: 'fumble' })).toBeInTheDocument()
    expect(within(previewTable).getAllByRole('columnheader').length).toBe(26)
    expect(within(previewTable).getAllByRole('row')).toHaveLength(72)
    expect(screen.queryByText(/showing first/i)).not.toBeInTheDocument()
    expect(api.draft).not.toHaveBeenCalled()
    await waitFor(() => expect(api.start).toHaveBeenCalled())
    openEngineer()
    expect(screen.getByLabelText(/^Analysis task$/i)).toHaveValue(SAMPLE_WIN_LIKELIHOOD_TASK)
    fireEvent.change(screen.getByLabelText(/^Analysis task$/i), { target: { value: 'Find a first-half signal.' } })
    expect(api.draft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    const editor = await screen.findByLabelText(/^Jev query JSON$/i)
    expect(document.querySelector('[data-stage="dataset"]')).toBeTruthy()
    expect((editor as HTMLTextAreaElement).value).not.toBe(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(screen.queryByLabelText(/^Generated query$/i)).not.toBeInTheDocument()
    expect(api.draft).toHaveBeenCalledTimes(1)
    const dashboardStarts = vi.mocked(api.start).mock.calls.length
    expect(dashboardStarts).toBeGreaterThanOrEqual(2)
    const runButton = screen.getByRole('button', { name: /run jev/i })
    expect(runButton).toBeEnabled()
    expect(screen.getByText('Classifying 39 of 71 rows (H1 plays).')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument()
    expect(document.querySelector('[data-stage="dataset"]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'SEA win probability' })).toBeInTheDocument()
    fireEvent.click(runButton)
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(dashboardStarts + 1))
    expect(document.querySelector('[data-stage="run"]')).toBeTruthy()
    expect(api.start).toHaveBeenCalledWith({ datasetId: FOOTBALL_FIXTURE_ID, fixtureId: FOOTBALL_FIXTURE_ID, query: draftQueryJson, classes: draft.metadata.classes, questionKind: 'choice' })
    expect(api.draft).toHaveBeenCalledTimes(1)
  })

  it('keeps Draft/JSON off the product URL and only on Engineer', async () => {
    const api = makeApi()
    openFixture(api)
    expect(document.querySelector('[data-mode="product"]')).toBeTruthy()
    expect(window.location.search).not.toMatch(/mode=engineer/)
    expect(screen.queryByText(/edit jev json/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /analysis task/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /jev query json/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /draft task/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /run jev/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /^engineer$/i }))
    expect(document.querySelector('[data-mode="engineer"]')).toBeTruthy()
    expect(window.location.search).toMatch(/mode=engineer/)
    expect(screen.getByText(/edit jev json/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Analysis task$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Jev query JSON$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /draft task/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^product$/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /^product$/i }))
    expect(document.querySelector('[data-mode="product"]')).toBeTruthy()
    expect(window.location.pathname).toBe(`/dataset/${FOOTBALL_FIXTURE_ID}`)
    expect(window.location.search).not.toMatch(/mode=engineer/)
    expect(screen.queryByText(/edit jev json/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /jev query json/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /draft task/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'SEA win probability' })).toBeInTheDocument()
  })

  it('opens the JSON editor from ?mode=engineer without leaking onto /', async () => {
    window.history.pushState({}, '', '/?mode=engineer')
    const api = makeApi()
    render(<App api={api} />)
    expect(document.querySelector('[data-mode="engineer"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^2026 super bowl demo$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /upload csv or public https csv url/i })).toBeInTheDocument()
    window.history.pushState({}, '', `/dataset/${FOOTBALL_FIXTURE_ID}?mode=engineer`)
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(await screen.findByRole('heading', { name: 'SEA win probability' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Jev query JSON$/i)).toBeInTheDocument()
    expect(document.querySelector('details.advanced-json')).toHaveAttribute('open')
    fireEvent.click(screen.getByRole('link', { name: /^product$/i }))
    expect(window.location.search).not.toMatch(/mode=engineer/)
    expect(screen.queryByLabelText(/^Jev query JSON$/i)).not.toBeInTheDocument()
  })

  it('keeps Starting… in the query footer while Run is in flight', async () => {
    let finish: ((value: AnalysisSnapshot) => void) | undefined
    const pending = new Promise<AnalysisSnapshot>((resolve) => { finish = resolve })
    const api = makeApi({
      start: vi.fn(() => pending),
    })
    openFixture(api)
    openEngineer()
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByLabelText(/^Jev query JSON$/i)
    expect(screen.queryByText(/review the json, then run jev/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/draft builds the editable/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    expect(await screen.findByRole('button', { name: /starting/i })).toBeDisabled()
    expect(document.querySelector('.query-card .form-footer span')).toHaveTextContent('Starting…')
    expect(screen.queryByText(/enter jev query json before running/i)).not.toBeInTheDocument()
    finish?.(snapshot({ status: 'queued', progress: { completedRows: 0, totalRows: 71, completedCalls: 0, totalCalls: 71 }, resultRows: [], currentFixtureRow: { rowIndex: 0, input } }))
    await waitFor(() => expect(document.querySelector('[data-stage="run"]')).toBeTruthy())
    expect(screen.queryByText(/enter jev query json before running/i)).not.toBeInTheDocument()
    expect(document.querySelector('.query-card .form-footer span')).toBeNull()
  })

  it('drafts the Jev query JSON into the editor, not a prose paraphrase of the task', async () => {
    const api = makeApi()
    openFixture(api)
    openEngineer()
    expect(screen.getByLabelText(/^Analysis task$/i)).toHaveValue(SAMPLE_WIN_LIKELIHOOD_TASK)
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    const editor = await screen.findByLabelText(/^Jev query JSON$/i)
    const parsed = parseJevQueryJson((editor as HTMLTextAreaElement).value)
    expect(parsed?.type).toMatch(/^(noul|score|choice)$/)
    expect((editor as HTMLTextAreaElement).value).toBe(JSON.stringify(parsed, null, 2))
    expect((editor as HTMLTextAreaElement).value.trim().startsWith('{')).toBe(true)
    expect((editor as HTMLTextAreaElement).value).toMatch(/"type"\s*:/)
    expect((editor as HTMLTextAreaElement).value).not.toBe(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(screen.queryByLabelText(/^Generated query$/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^jev query$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run jev/i })).toBeEnabled()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith((editor as HTMLTextAreaElement).value))
  })

  it('runs after the user edits the Jev query JSON', async () => {
    const api = makeApi()
    openFixture(api)
    openEngineer()
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByLabelText(/^Jev query JSON$/i)
    const edited = formatDraftQueryForEditor({
      query: 'Will SEA cover given this play state?',
      questionKind: 'noul',
      classes: [],
    })
    fireEvent.change(screen.getByLabelText(/^Jev query JSON$/i), { target: { value: edited } })
    expect(screen.getByRole('button', { name: /run jev/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    await waitFor(() => expect(api.start).toHaveBeenCalledWith(expect.objectContaining({
      query: edited,
      questionKind: 'noul',
      classes: [],
    })))
  })

  it('keeps Run Jev disabled when Edit query text is cleared, and still accepts a manual edit', async () => {
    const api = makeApi()
    openFixture(api)
    openEngineer()
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByLabelText(/^Jev query JSON$/i)
    fireEvent.change(screen.getByLabelText(/^Jev query JSON$/i), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: /run jev/i })).toBeDisabled()
    expect(screen.getByText(/enter jev query json before running/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Jev query JSON$/i), { target: { value: '{not-json' } })
    expect(screen.getByRole('button', { name: /run jev/i })).toBeDisabled()
    expect(screen.getByText(/valid jev json required/i)).toBeInTheDocument()
    const edited = formatDraftQueryForEditor({
      query: 'Use only visible columns.',
      questionKind: 'choice',
      classes: draft.metadata.classes,
    })
    fireEvent.change(screen.getByLabelText(/^Jev query JSON$/i), { target: { value: edited } })
    expect(screen.getByRole('button', { name: /run jev/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    await waitFor(() => expect(api.start).toHaveBeenCalledWith({ datasetId: FOOTBALL_FIXTURE_ID, fixtureId: FOOTBALL_FIXTURE_ID, query: edited, classes: draft.metadata.classes, questionKind: 'choice' }))
  })

  it('renders progress, live chart, processed-row rail, and share action', async () => {
    const api = makeApi({ read: vi.fn(async () => snapshot({
      status: 'running',
      progress: { completedRows: 12, totalRows: 39, completedCalls: 12, totalCalls: 39 },
      resultRows: Array.from({ length: 3 }, (_, rowIndex) => ({ rowIndex, input, model: 'jev-latest', selectedClass: 'K.Walker', probabilities: { 'K.Walker': 0.72, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.12, 'Other/Tie': 0.06 }, confidence: 0.72 })),
    })) })
    await startEngineerRun(api)
    const runView = analysisCard()
    expect(await within(runView).findByText('12 / 39 rows')).toBeInTheDocument()
    expect(within(runView).getAllByText(/classifying 39 of 71 rows \(h1 plays\)/i).length).toBeGreaterThan(0)
    expect(within(runView).getByRole('heading', { level: 2, name: '31%' })).toBeInTheDocument()
    expect(within(runView).getByText('12 / 39')).toBeInTheDocument()
    expect(within(runView).getByRole('heading', { level: 3, name: 'Class distribution' })).toBeInTheDocument()
    expect(within(runView).getByText('Running')).toBeInTheDocument()
    expect(within(runView).getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
    expect(within(runView).getByRole('slider', { name: /chart playhead/i })).toBeInTheDocument()
    expect(within(runView).queryByRole('button', { name: /^play$/i })).not.toBeInTheDocument()
    const rail = within(runView).getByRole('complementary', { name: /processed rows/i })
    expect(within(rail).getByRole('button', { name: /row 1 of 39/i })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: new RegExp(`row 3 of 39 ${input.play_id} · Q${input.qtr} · K\\.Walker`, 'i') })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /current row inspector/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /incremental analysis results/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /incremental results/i })).not.toBeInTheDocument()
    expect(within(runView).getByRole('button', { name: /copy shareable public url/i })).toBeInTheDocument()
    expect(screen.queryByText(/open public snapshot/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /switch to (dark|light) theme/i })).toBeInTheDocument()
  })

  it('updates the class chart from incremental running predictions, not only terminal status', async () => {
    const running = (count: number, status: AnalysisSnapshot['status'] = 'running'): AnalysisSnapshot => snapshot({
      status,
      progress: { completedRows: count, totalRows: 3, completedCalls: count, totalCalls: 3 },
      resultRows: Array.from({ length: count }, (_, rowIndex) => ({
        rowIndex,
        input,
        model: 'jev-latest',
        selectedClass: rowIndex === 1 ? 'C.Kupp' : 'K.Walker',
        probabilities: { 'K.Walker': 0.6, 'C.Kupp': 0.4 },
      })),
    })
    let reads = 0
    const api = makeApi({
      start: vi.fn(async (request) => (
        isPlayerChoiceStart(request)
          ? running(0, 'queued')
          : snapshot({ status: 'complete', questionKind: request.questionKind, classes: request.classes ? [...request.classes] : [], resultRows: [], progress: { completedRows: 71, totalRows: 71, completedCalls: 71, totalCalls: 71 } })
      )),
      read: vi.fn(async () => {
        reads += 1
        if (reads === 1) return running(1)
        if (reads === 2) return running(2)
        return running(3, 'complete')
      }),
    })
    await startEngineerRun(api)
    const runView = analysisCard()
    expect(await within(runView).findByText('Waiting for the first row…')).toBeInTheDocument()
    expect(within(runView).getByRole('complementary', { name: /processed rows/i })).toBeInTheDocument()
    await waitFor(() => expect(within(runView).queryByText('Waiting for the first row…')).not.toBeInTheDocument())
    await waitFor(() => expect(runView.querySelector('[data-class="K.Walker"]')).toHaveAttribute('data-count', '1'))
    await waitFor(() => expect(runView.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '1'))
    expect(api.read).toHaveBeenCalled()
  })

  it('charts a Noul win-probability series instead of leftover player-class bars', async () => {
    const noulDraft: AnalysisDraftResult = {
      ...draft,
      query: noulQueryJson,
      metadata: { ...draft.metadata, rowCount: 71, questionKind: 'noul', classes: [], columns: ['play_id', 'posteam_score', 'defteam_score', 'score_differential'] },
    }
    const noulRun = snapshot({
      query: noulQueryJson,
      questionKind: 'noul',
      classes: [],
      status: 'running',
      progress: { completedRows: 3, totalRows: 71, completedCalls: 3, totalCalls: 71 },
      resultRows: Array.from({ length: 3 }, (_, rowIndex) => ({
        rowIndex,
        input: { ...input, wpa: 0.91, posteam_score: 3, defteam_score: 0 },
        model: 'jev-latest',
        questionKind: 'noul' as const,
        value: 0.4 + rowIndex * 0.1,
      })),
    })
    const api = makeApi({
      draft: vi.fn(async () => noulDraft),
      start: vi.fn(async (request) => (
        request.questionKind === 'score'
          ? { ...noulRun, analysisId: 'analysis-play-quality', questionKind: 'score' as const, query: noulRun.query }
          : noulRun
      )),
      read: vi.fn(async () => noulRun),
    })
    openFixture(api)
    expect(document.querySelector('[data-insight-id="series-win"]')).toHaveAttribute('data-visual', 'series')
    expect(document.querySelector('[data-insight-id="series-play-quality"]')).toHaveAttribute('data-visual', 'series')
    expect(document.querySelector('[data-insight-id="bars-success"]')).toBeNull()
    expectNamedDashboard()
    expect(screen.getByRole('heading', { name: 'SEA play quality' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Play quality$/ })).not.toBeInTheDocument()
    expect(screen.getByText('P(win) line')).toBeInTheDocument()
    expect(screen.getByText('Quality')).toBeInTheDocument()
    expect(screen.getByLabelText(/dataset shape/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'SEA win probability' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Win probability$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /win likelihood/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /draft task/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/edit jev json/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument()
    const winTile = document.querySelector('[data-insight-id="series-win"]') as HTMLElement
    expect(await within(winTile).findByRole('img', { name: /sea win probability over play index/i })).toBeInTheDocument()
    expect(within(winTile).getByText('3 / 71')).toBeInTheDocument()
    expect(winTile.querySelector('[data-chart-kind="series"]')).toBeTruthy()
    expect(winTile.querySelector('[data-series-points="3"]')).toBeTruthy()
    expect(winTile.querySelector('[data-class="K.Walker"]')).toBeNull()
    expect(document.querySelector('[data-insight-id="series-play-quality"]')).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: /processed rows/i })).not.toBeInTheDocument()
    expect(document.querySelector('.series-line')).toBeTruthy()
    expect(document.querySelector('.series-fill')).toBeTruthy()
    expect(api.draft).not.toHaveBeenCalled()
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ query: noulQueryJson, questionKind: 'noul', classes: [] }))
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ questionKind: 'score' }))
  })

  it('charts Seahawks play quality as a series over all 71 plays, not Good/Bad H1 bars', async () => {
    const scoreQueryJson = formatDraftQueryForEditor({
      query: SAMPLE_PLAY_QUALITY_QUERY,
      questionKind: 'score',
      classes: [...SAMPLE_PLAY_QUALITY_LEVELS],
    })
    const scoreDraft: AnalysisDraftResult = {
      ...draft,
      query: scoreQueryJson,
      metadata: {
        ...draft.metadata,
        rowCount: 71,
        questionKind: 'score',
        classes: [...SAMPLE_PLAY_QUALITY_LEVELS],
        columns: ['play_id', 'posteam_score', 'defteam_score', 'score_differential'],
      },
    }
    delete scoreDraft.metadata.inputHalf
    delete scoreDraft.metadata.labelHalf
    const scoreRun = snapshot({
      query: scoreQueryJson,
      questionKind: 'score',
      classes: [...SAMPLE_PLAY_QUALITY_LEVELS],
      status: 'running',
      progress: { completedRows: 3, totalRows: 71, completedCalls: 3, totalCalls: 71 },
      resultRows: Array.from({ length: 3 }, (_, rowIndex) => ({
        rowIndex,
        input: { ...input, wpa: 0.91, posteam_score: 3, defteam_score: 0 },
        model: 'jev-latest',
        questionKind: 'score' as const,
        value: 0.35 + rowIndex * 0.1,
      })),
    })
    const api = makeApi({
      draft: vi.fn(async () => scoreDraft),
      start: vi.fn(async (request) => (
        request.questionKind === 'noul'
          ? { ...scoreRun, analysisId: 'analysis-win', questionKind: 'noul' as const }
          : scoreRun
      )),
      read: vi.fn(async () => scoreRun),
    })
    openFixture(api)
    const playQualityCard = document.querySelector('[data-insight-id="series-play-quality"]') as HTMLElement
    expect(playQualityCard).toHaveAttribute('data-visual', 'series')
    expect(document.querySelector('[data-insight-id="bars-success"]')).toBeNull()
    expectNamedDashboard()
    expect(within(playQualityCard).queryByText(/class bars/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument()
    expect(await within(playQualityCard).findByRole('img', { name: /sea play quality over play index/i })).toBeInTheDocument()
    expect(within(playQualityCard).getByRole('heading', { name: 'SEA play quality' })).toBeInTheDocument()
    expect(within(playQualityCard).getByText('3 / 71')).toBeInTheDocument()
    expect(playQualityCard.querySelector('[data-chart-kind="series"]')).toBeTruthy()
    expect(document.querySelector('[data-class="Good Play"]')).toBeNull()
    expect(document.querySelector('[data-class="Bad Play"]')).toBeNull()
    expect(screen.queryByText(/classifying 39 of 71 rows \(h1 plays\)/i)).not.toBeInTheDocument()
    expect(api.draft).not.toHaveBeenCalled()
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ query: scoreQueryJson, questionKind: 'score' }))
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ questionKind: 'noul' }))
  })

  it('opens the squirrel census sample and runs a places insight, never Location vs Activity bars', async () => {
    const eatingQuery = formatDraftQueryForEditor({
      query: SQUIRREL_EATING_NOUL_QUERY,
      questionKind: 'noul',
      classes: [],
    })
    const eatingDraft: AnalysisDraftResult = {
      fixtureId: SQUIRREL_FIXTURE_ID,
      datasetId: SQUIRREL_FIXTURE_ID,
      sourceType: 'fixture',
      query: eatingQuery,
      metadata: {
        provider: 'openrouter',
        model: 'cached-sample-places',
        rowCount: 96,
        questionKind: 'noul',
        classes: [],
        columns: ['x', 'y', 'location', 'eating'],
        displayName: 'Squirrel census',
      },
    }
    const eatingRun = snapshot({
      analysisId: 'analysis-squirrel-1',
      fixtureId: SQUIRREL_FIXTURE_ID,
      datasetId: SQUIRREL_FIXTURE_ID,
      query: eatingQuery,
      questionKind: 'noul',
      classes: [],
      status: 'complete',
      progress: { completedRows: 3, totalRows: 3, completedCalls: 3, totalCalls: 3 },
      columns: ['x', 'y', 'location', 'eating'],
      resultRows: [
        { rowIndex: 0, input: { x: -73.97, y: 40.78, location: 'Ground Plane', eating: true }, model: 'jev-latest', questionKind: 'noul', value: 0.9 },
        { rowIndex: 1, input: { x: -73.96, y: 40.79, location: 'Above Ground', eating: false }, model: 'jev-latest', questionKind: 'noul', value: 0.1 },
        { rowIndex: 2, input: { x: -73.975, y: 40.782, location: 'Ground Plane', eating: true }, model: 'jev-latest', questionKind: 'noul', value: 0.85 },
      ],
    })
    const api = makeApi({
      draft: vi.fn(async () => eatingDraft),
      start: vi.fn(async (request) => (
        /on the move/i.test(String(request.query))
          ? { ...eatingRun, analysisId: 'analysis-squirrel-activity', query: request.query }
          : eatingRun
      )),
      read: vi.fn(async () => eatingRun),
    })
    openFixture(api, SQUIRREL_FIXTURE_ID)
    expect(window.location.pathname).toBe(`/dataset/${SQUIRREL_FIXTURE_ID}`)
    expect(screen.getByLabelText(/dataset shape/i)).toBeInTheDocument()
    expect(screen.queryByText(/location vs activity/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /where they eat/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /on the move/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /how active/i })).not.toBeInTheDocument()
    expect(Number(document.querySelector('.dashboard-grid')?.getAttribute('data-insight-count'))).toBeGreaterThanOrEqual(2)
    expectDiverseDashboard()
    expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /run insight/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Location$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Activity$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/classify by shift/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Analysis task$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/edit jev json/i)).not.toBeInTheDocument()
    const placesTile = document.querySelector('[data-insight-id="places-eating"]') as HTMLElement
    expect(placesTile).toHaveAttribute('data-lead')
    expect(placesTile).toHaveAttribute('data-visual', 'places')
    expect(await within(placesTile).findByRole('img', { name: /places map of eating locations/i })).toBeInTheDocument()
    expect(screen.queryByText(/using saved run/i)).not.toBeInTheDocument()
    expect(placesTile.querySelector('[data-chart-kind="places"]')).toBeTruthy()
    expect(placesTile.querySelector('[data-place-points]')).toBeTruthy()
    expect(document.querySelector('[data-class="Location"]')).toBeNull()
    expect(document.querySelector('[data-class="Activity"]')).toBeNull()
    expect(document.querySelector('[data-class="AM"]')).toBeNull()
    expect(screen.queryByRole('complementary', { name: /processed rows/i })).not.toBeInTheDocument()
    expect(api.draft).not.toHaveBeenCalled()
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({
      datasetId: SQUIRREL_FIXTURE_ID,
      fixtureId: SQUIRREL_FIXTURE_ID,
      questionKind: 'noul',
      classes: [],
    }))
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ query: expect.stringMatching(/on the move/i) }))
  })

  it('follows the live edge until the user scrubs back, then seeks from the row rail', async () => {
    const running = (count: number): AnalysisSnapshot => snapshot({
      status: 'running',
      currentFixtureRow: { rowIndex: Math.max(0, count - 1), input },
      progress: { completedRows: count, totalRows: 39, completedCalls: count, totalCalls: 39 },
      resultRows: Array.from({ length: count }, (_, rowIndex) => ({
        rowIndex,
        input: { ...input, play_id: Number(input.play_id) + rowIndex },
        model: 'jev-latest',
        selectedClass: rowIndex === 0 ? 'K.Walker' : 'C.Kupp',
        probabilities: { 'K.Walker': 0.6, 'C.Kupp': 0.4 },
      })),
    })
    let reads = 0
    const api = makeApi({
      start: vi.fn(async (request) => (
        isPlayerChoiceStart(request)
          ? running(0)
          : snapshot({ status: 'complete', questionKind: request.questionKind, classes: request.classes ? [...request.classes] : [], resultRows: [], progress: { completedRows: 71, totalRows: 71, completedCalls: 71, totalCalls: 71 } })
      )),
      read: vi.fn(async () => {
        reads += 1
        if (reads === 1) return running(1)
        if (reads === 2) return running(2)
        return running(3)
      }),
    })
    await startEngineerRun(api)
    const rail = await screen.findByRole('complementary', { name: /processed rows/i })
    await waitFor(() => expect(within(rail).getByRole('button', { name: /row 2 of 39/i })).toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '1'))
    fireEvent.click(within(rail).getByRole('button', { name: /row 1 of 39/i }))
    await waitFor(() => expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '0'))
    expect(within(rail).getByText(new RegExp(`${input.play_id}`))).toBeInTheDocument()
    await waitFor(() => expect(within(rail).getByRole('button', { name: /row 3 of 39/i })).toBeInTheDocument())
    expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '0')
    fireEvent.change(screen.getByRole('slider', { name: /chart playhead/i }), { target: { value: '2' } })
    fireEvent.pointerUp(screen.getByRole('slider', { name: /chart playhead/i }))
    await waitFor(() => expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '2'))
    expect(screen.queryByRole('table', { name: /incremental analysis results/i })).not.toBeInTheDocument()
  })

  it('loads upload and public URL datasets into the same draft → chart path', async () => {
    const api = makeApi()
    render(<App api={api} />)
    const file = new File(['message,tier\nhello,gold\n'], 'tickets.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    expect(await screen.findByRole('heading', { name: 'tickets.csv' })).toBeInTheDocument()
    expect(api.createFromCsv).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /change dataset/i }))
    fireEvent.change(screen.getByLabelText(/public https csv url/i), { target: { value: 'https://example.com/data.csv' } })
    fireEvent.click(screen.getByRole('button', { name: /use public csv url/i }))
    expect(await screen.findByRole('heading', { name: 'remote.csv' })).toBeInTheDocument()
    expect(api.createFromUrl).toHaveBeenCalledWith({ url: 'https://example.com/data.csv' })
  })

  it('uses the same chart and row-rail shell for a BYOD run', async () => {
    const byod = snapshot({
      analysisId: 'analysis-upload-1',
      fixtureId: uploaded.datasetId,
      datasetId: uploaded.datasetId,
      sourceType: 'upload',
      status: 'running',
      classes: ['gold', 'silver'],
      columns: ['message', 'tier'],
      progress: { completedRows: 1, totalRows: 2, completedCalls: 1, totalCalls: 2 },
      resultRows: [{ rowIndex: 0, input: { message: 'hello', tier: 'gold' }, model: 'jev-latest', selectedClass: 'gold', confidence: 0.9 }],
    })
    const ticketsQueryJson = formatDraftQueryForEditor({
      query: 'Classify each row using the visible columns.',
      questionKind: 'choice',
      classes: ['gold', 'silver'],
    })
    const api = makeApi({
      draft: vi.fn(async () => ({
        ...draft,
        datasetId: uploaded.datasetId,
        fixtureId: uploaded.datasetId,
        sourceType: 'upload' as const,
        query: ticketsQueryJson,
        metadata: { ...draft.metadata, displayName: 'tickets.csv', rowCount: 2, questionKind: 'choice' as const, classes: ['gold', 'silver'], columns: ['message'] },
      })),
      start: vi.fn(async () => byod),
      read: vi.fn(async () => byod),
    })
    render(<App api={api} />)
    const file = new File(['message,tier\nhello,gold\n'], 'tickets.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    expect(await screen.findByRole('heading', { name: 'tickets.csv' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /yes or no|notable rows|play success/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /draft task/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/edit jev json/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/classify by /i)).not.toBeInTheDocument()
    await waitFor(() => expect(api.propose).toHaveBeenCalled())
    expect(await screen.findByText(/no insights for this table/i)).toBeInTheDocument()
    expect(document.querySelector('.dashboard-grid')).toBeNull()
    expect(api.start).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: /current row inspector/i })).not.toBeInTheDocument()
  })

  it('shows a fruit/vehicle Choice draft with JSON edit and Run after BYOD upload', async () => {
    const classify = {
      ...uploaded,
      datasetId: 'dataset-classify-1',
      displayName: 'classify.csv',
      columns: [
        { name: 'id', normalizedName: 'id', inferredType: 'number' as const },
        { name: 'text', normalizedName: 'text', inferredType: 'string' as const },
        { name: 'label_hint', normalizedName: 'label_hint', inferredType: 'string' as const },
      ],
      acceptedRowCount: 10,
      previewRows: [{ id: 1, text: 'apple', label_hint: 'fruit' }, { id: 2, text: 'truck', label_hint: 'vehicle' }],
    }
    const fruitQuery = formatDraftQueryForEditor({
      query: 'Classify each row as fruit or vehicle using text.',
      questionKind: 'choice',
      classes: ['fruit', 'vehicle'],
    })
    const api = makeApi({
      createFromCsv: vi.fn(async () => classify),
      draft: vi.fn(async () => ({
        fixtureId: classify.datasetId,
        datasetId: classify.datasetId,
        sourceType: 'upload' as const,
        query: fruitQuery,
        metadata: {
          provider: 'openrouter',
          model: 'openai/gpt-4o-mini',
          rowCount: 10,
          questionKind: 'choice' as const,
          classes: ['fruit', 'vehicle'],
          columns: ['id', 'text', 'label_hint'],
          displayName: 'classify.csv',
        },
      })),
    })
    render(<App api={api} />)
    const file = new File(['id,text,label_hint\n1,apple,fruit\n'], 'classify.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    expect(await screen.findByRole('heading', { name: 'classify.csv' })).toBeInTheDocument()
    expect(screen.queryByText(/classify by /i)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /yes or no|notable rows/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Analysis task$/i)).not.toBeInTheDocument()
    openEngineer()
    fireEvent.change(screen.getByLabelText(/^Analysis task$/i), {
      target: { value: 'classify each row as fruit or vehicle using text' },
    })
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    const editor = await screen.findByLabelText(/^Jev query JSON$/i)
    expect(parseJevQueryJson((editor as HTMLTextAreaElement).value)).toEqual({
      type: 'choice',
      instructions: 'Classify each row as fruit or vehicle using text.',
      criteria: { fruit: 'the fruit class', vehicle: 'the vehicle class' },
    })
    expect(screen.getByRole('button', { name: /run jev/i })).toBeEnabled()
    expect(screen.getByRole('list', { name: /choice classes/i })).toHaveTextContent('fruit')
    expect(screen.getByRole('list', { name: /choice classes/i })).toHaveTextContent('vehicle')
    expect(screen.queryByText(/INVALID_CLASSES/)).not.toBeInTheDocument()
  })

  it('shows a plain draft-classes message instead of raw INVALID_CLASSES', async () => {
    const api = makeApi({
      draft: vi.fn(async () => { throw new Error('INVALID_CLASSES') }),
    })
    openFixture(api)
    openEngineer()
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(INVALID_CLASSES_COPY)
    expect(alert).toHaveTextContent(/couldn't draft/i)
    expect(alert).not.toHaveTextContent('INVALID_CLASSES')
    expect(vi.mocked(api.start).mock.calls.every((call) => !(call[0]?.classes ?? []).includes('K.Walker'))).toBe(true)
  })

  it('keeps idle intake quiet when durable storage is down, and still opens a fixture route', async () => {
    const api = makeApi({
      intakeStatus: vi.fn(async (): Promise<DatasetIntakeStatus> => ({ convex: false, uploadThing: false, sampleAvailable: true })),
      createFromCsv: vi.fn(async () => { throw new Error('UPLOADTHING_NOT_CONFIGURED') }),
    })
    render(<App api={api} />)
    await waitFor(() => expect(screen.getByLabelText(/upload csv/i)).toBeDisabled())
    expect(screen.queryByText(/not configured on this deployment/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/durable storage/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/uploadthing/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sample still works/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^2026 super bowl demo$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^squirrel census$/i })).not.toBeInTheDocument()
    window.history.pushState({}, '', `/dataset/${FOOTBALL_FIXTURE_ID}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(await screen.findByRole('heading', { name: 'SEA win probability' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Analysis task$/i)).not.toBeInTheDocument()
    await waitFor(() => expect(api.start).toHaveBeenCalled())
  })

  it('shows a short BYOD error without durable-storage jargon', async () => {
    const api = makeApi({
      createFromCsv: vi.fn(async () => { throw new Error('UPLOADTHING_NOT_CONFIGURED') }),
    })
    render(<App api={api} />)
    const file = new File(['message,tier\nhello,gold\n'], 'tickets.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not upload this csv/i)
    expect(screen.getByText(/couldn't load dataset/i)).toBeInTheDocument()
    expect(screen.queryByText(/not configured on this deployment/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/durable storage/i)).not.toBeInTheDocument()
    expect(api.start).not.toHaveBeenCalled()
  })

  it('loads and renders a persisted snapshot on direct public share navigation', async () => {
    const analysisId = 'analysis-shared-1'
    const api = makeApi({ share: vi.fn(async (requestedId) => snapshot({ analysisId: requestedId, status: 'complete' })) })
    window.history.pushState({}, '', `/share/${analysisId}`)
    try {
      render(<App api={api} />)
      expect(await screen.findByRole('heading', { level: 2, name: '100%' })).toBeInTheDocument()
      expect(screen.getByText('39 of 39')).toBeInTheDocument()
      expect(document.querySelector('.analysis-card')).toHaveAttribute('data-complete-snap')
      expect(document.querySelector('.chart-shell')).toHaveAttribute('data-motion', 'seek')
      expect(screen.queryByText(/using saved run/i)).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 3, name: 'Class distribution' })).toBeInTheDocument()
      expect(api.share).toHaveBeenCalledWith(analysisId)
      expect(screen.queryByText(/no provider credentials|bounded jev worker|engineer playground/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('table', { name: /incremental analysis results/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /incremental results/i })).not.toBeInTheDocument()
      expect(screen.getByRole('slider', { name: /chart playhead/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
      const rail = screen.getByRole('complementary', { name: /processed rows/i })
      expect(within(rail).getByRole('button', { name: new RegExp(`row 1 of 39 ${input.play_id} · Q${input.qtr} · K\\.Walker`, 'i') })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /copy shareable public url/i })).toBeInTheDocument()
      expect(screen.queryByText(/public snapshot/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/open public snapshot/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/^Analysis task$/i)).not.toBeInTheDocument()
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('routes the default public share client through the share API path', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(snapshot()), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await defaultAnalysisApi.share('analysis /1')
      expect(fetchMock).toHaveBeenCalledWith('/api/share/analysis%20%2F1', expect.objectContaining({ method: 'GET' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('persists a header theme toggle over the system color scheme', () => {
    render(<App api={makeApi()} />)
    const toggle = screen.getByRole('button', { name: /switch to (dark|light) theme/i })
    const next = toggle.getAttribute('aria-label')?.includes('dark') ? 'dark' : 'light'
    fireEvent.click(toggle)
    expect(window.localStorage.getItem('jev-theme')).toBe(next)
    expect(document.documentElement.classList.contains('dark')).toBe(next === 'dark')
    expect(document.documentElement.dataset.theme).toBe(next)
    expect(screen.getByRole('button', { name: next === 'dark' ? /switch to light theme/i : /switch to dark theme/i })).toBeInTheDocument()
  })

  it('renders stable API errors and empty results without exposing provider details', async () => {
    const api = makeApi({ start: vi.fn(async () => { throw new Error('ANALYSIS_PROVIDER_ERROR') }) })
    await startSampleRun(api)
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent(/couldn't run/i)
    expect(screen.getAllByText(/jev hit a provider error/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/ANALYSIS_PROVIDER_ERROR/)).not.toBeInTheDocument()
    expect(screen.queryByText(/action needs attention/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/provider response|api key/i)).not.toBeInTheDocument()
  })

  it('humanizes in-run error status instead of Retryable/Stopped', async () => {
    const failed = snapshot({
      status: 'error',
      progress: { completedRows: 31, totalRows: 39, completedCalls: 31, totalCalls: 39 },
      error: { code: 'JEV_MALFORMED_RESPONSE', retryable: false },
    })
    const api = makeApi({
      start: vi.fn(async () => failed),
      read: vi.fn(async () => failed),
    })
    await startSampleRun(api)
    const alert = (await screen.findAllByRole('alert'))[0]!
    expect(alert).toHaveTextContent(/couldn't finish this run/i)
    expect(alert).toHaveTextContent(/could not use/i)
    expect(alert).toHaveTextContent(/resume from row 32/i)
    expect(screen.queryByText(/JEV_MALFORMED_RESPONSE/)).not.toBeInTheDocument()
    expect(screen.queryByText(/retryable/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^stopped\.$/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /resume from row 32/i })[0]!)
    await waitFor(() => expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({
      analysisId: failed.analysisId,
      resume: true,
    })))
  })

  it('shows Still working when a live run has had no progress for 60s', async () => {
    const frozenAt = new Date(Date.now() - 70_000).toISOString()
    const frozen = snapshot({
      status: 'running',
      createdAt: frozenAt,
      updatedAt: frozenAt,
      progress: { completedRows: 728, totalRows: 3023, completedCalls: 728, totalCalls: 3023 },
    })
    const api = makeApi({
      start: vi.fn(async () => frozen),
      read: vi.fn(async () => frozen),
    })
    await startSampleRun(api)
    expect((await screen.findAllByText(/still working/i)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /resume from row/i })).not.toBeInTheDocument()
  })

  it('offers Resume when a stalled run is healed to a retryable error', async () => {
    const stalled = snapshot({
      status: 'error',
      progress: { completedRows: 728, totalRows: 3023, completedCalls: 728, totalCalls: 3023 },
      error: { code: 'ANALYSIS_RUN_STALLED', retryable: true },
    })
    const api = makeApi({
      start: vi.fn(async () => stalled),
      read: vi.fn(async () => stalled),
    })
    await startSampleRun(api)
    const alert = (await screen.findAllByRole('alert'))[0]!
    expect(alert).toHaveTextContent(/this run may be stuck — resume or start again/i)
    expect(alert).toHaveTextContent(/resume from row 729/i)
    expect(screen.getAllByRole('button', { name: /resume from row 729/i }).length).toBeGreaterThan(0)
    expect(screen.queryByText(/ANALYSIS_RUN_STALLED/)).not.toBeInTheDocument()
  })

  it('validates an empty public CSV URL next to the field', async () => {
    const api = makeApi()
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /use public csv url/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter a public https csv url first/i)
    expect(api.createFromUrl).not.toHaveBeenCalled()
    expect(screen.queryByText(/couldn't run/i)).not.toBeInTheDocument()
  })

  it('clears the public CSV URL after Change dataset', async () => {
    const api = makeApi()
    render(<App api={api} />)
    fireEvent.change(screen.getByLabelText(/public https csv url/i), { target: { value: 'https://example.com/data.csv' } })
    fireEvent.click(screen.getByRole('button', { name: /use public csv url/i }))
    expect(await screen.findByRole('heading', { name: 'remote.csv' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /change dataset/i }))
    expect(screen.getByLabelText(/public https csv url/i)).toHaveValue('')
  })

  it('shows dataset-load errors next to intake instead of Couldn\'t run', async () => {
    const api = makeApi({
      createFromUrl: vi.fn(async () => { throw new Error('URL_NOT_HTTPS') }),
    })
    render(<App api={api} />)
    fireEvent.change(screen.getByLabelText(/public https csv url/i), { target: { value: 'http://example.com/data.csv' } })
    fireEvent.click(screen.getByRole('button', { name: /use public csv url/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't load dataset/i)
    expect(alert).toHaveTextContent(/use an https csv url/i)
    expect(screen.queryByText(/couldn't run/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /choose a dataset/i })).toBeInTheDocument()
  })

  it('resets Share Copied when the user drafts again and after a short delay', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const api = makeApi({
      start: vi.fn(async () => snapshot()),
      read: vi.fn(async () => snapshot()),
    })
    await startEngineerRun(api)
    const runView = document.querySelector('.analysis-card') as HTMLElement
    const share = await within(runView).findByRole('button', { name: /copy shareable public url/i })
    fireEvent.click(share)
    await waitFor(() => expect(share).toHaveTextContent(/^copied$/i))
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await waitFor(() => expect(within(runView).getByRole('button', { name: /copy shareable public url/i })).toHaveTextContent(/^share$/i))
    vi.useFakeTimers()
    try {
      fireEvent.click(within(runView).getByRole('button', { name: /copy shareable public url/i }))
      await act(async () => { await Promise.resolve() })
      expect(within(runView).getByRole('button', { name: /copy shareable public url/i })).toHaveTextContent(/^copied$/i)
      await act(async () => { vi.advanceTimersByTime(2500) })
      expect(within(runView).getByRole('button', { name: /copy shareable public url/i })).toHaveTextContent(/^share$/i)
    } finally {
      vi.useRealTimers()
    }
  })

  it('downloads results CSV from a completed run', async () => {
    const api = makeApi({
      start: vi.fn(async () => snapshot()),
      read: vi.fn(async () => snapshot()),
    })
    await startSampleRun(api)
    const click = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:results'),
      revokeObjectURL: vi.fn(),
    })
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const node = originalCreate(tag)
      if (tag === 'a') Object.assign(node, { click })
      return node
    })
    try {
      fireEvent.click(await screen.findByRole('button', { name: /download results csv/i }))
      expect(URL.createObjectURL).toHaveBeenCalled()
      expect(click).toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })

  it('shows classified subset copy on a completed run without a saved-share sentence', async () => {
    const api = makeApi({
      start: vi.fn(async () => snapshot({ status: 'complete' })),
      read: vi.fn(async () => snapshot({ status: 'complete' })),
    })
    await startEngineerRun(api)
    const latency = await screen.findByText(/classified 39 of 71 rows \(h1 plays\)/i)
    expect(latency).not.toHaveTextContent(/using saved run/i)
    expect(screen.queryByText(/using saved run/i)).not.toBeInTheDocument()
    expect(within(analysisCard()).getByRole('button', { name: /copy shareable public url/i })).toBeInTheDocument()
    expect(screen.queryByText(/saved\. share copies a public link/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^saved run\.$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/can take a few minutes/i)).not.toBeInTheDocument()
  })

  it('reuses a complete start as a saved run without forceNew or a live climb', async () => {
    const complete = snapshot({
      status: 'complete',
      progress: { completedRows: 39, totalRows: 39, completedCalls: 39, totalCalls: 39 },
    })
    const start = vi.fn(async () => complete)
    const api = makeApi({
      start,
      read: vi.fn(async () => complete),
    })
    await startSampleRun(api)
    expect((await screen.findAllByText('100%')).length).toBeGreaterThan(0)
    expect(start.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(start).toHaveBeenCalledWith(expect.not.objectContaining({ forceNew: true }))
    expect(screen.queryByText(/using saved run/i)).not.toBeInTheDocument()
    expect(screen.getAllByText('39 of 39').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-insight-id="series-win"]')).toHaveAttribute('data-complete-snap')
    expect(document.querySelector('[data-insight-id="series-win"]')).toHaveAttribute('data-saved-run')
    expect(JSON.stringify(start.mock.calls)).not.toContain('forceNew')
    expect(screen.queryByText(/using saved run/i)).not.toBeInTheDocument()
  })

  it('sets live-run expectations while a run is in flight', async () => {
    const running = snapshot({
      status: 'running',
      createdAt: new Date().toISOString(),
      progress: { completedRows: 1, totalRows: 39, completedCalls: 1, totalCalls: 39 },
    })
    const api = makeApi({
      start: vi.fn(async () => running),
      read: vi.fn(async () => running),
    })
    await startEngineerRun(api)
    expect(await screen.findByText(/live run/i)).toHaveTextContent(/classifying 39 of 71 rows \(h1 plays\)/i)
    expect(screen.getByText(/live run/i)).toHaveTextContent(/can take a few minutes/i)
  })

  it('shows loading feedback while a public CSV URL is in flight', async () => {
    let finish: ((value: DatasetPreview) => void) | undefined
    const pending = new Promise<DatasetPreview>((resolve) => { finish = resolve })
    const api = makeApi({
      createFromUrl: vi.fn(() => pending),
    })
    render(<App api={api} />)
    fireEvent.change(screen.getByLabelText(/public https csv url/i), { target: { value: 'https://example.com/nyc.csv' } })
    fireEvent.click(screen.getByRole('button', { name: /use public csv url/i }))
    expect(await screen.findByText(/loading dataset/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /loading dataset/i })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /loading dataset/i })).toHaveAttribute('data-indeterminate')
    finish?.({ ...uploaded, datasetId: 'dataset-url-1', sourceType: 'public_url', displayName: 'nyc.csv' })
    expect(await screen.findByRole('heading', { name: 'nyc.csv' })).toBeInTheDocument()
    expect(screen.queryByText(/loading dataset/i)).not.toBeInTheDocument()
  })

  it('maps aborted dataset fetches to a timeout instead of hanging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }))
    try {
      await expect(defaultAnalysisApi.createFromUrl?.({ url: 'https://example.com/data.csv' })).rejects.toMatchObject({
        name: 'DatasetError',
        code: 'URL_TIMEOUT',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('opens a dataset route as the dashboard after Enter, without InsightPicker Run', async () => {
    const api = makeApi()
    window.history.pushState({}, '', `/dataset/${FOOTBALL_FIXTURE_ID}`)
    render(<App api={api} />)
    expect(await screen.findByRole('heading', { name: 'SEA win probability' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'SEA play quality' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Play success' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-stage="dataset"]')).toBeTruthy()
    expectNamedDashboard()
    expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose a dataset/i })).not.toBeInTheDocument()
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.start).mock.calls.map((call) => call[0]?.questionKind).sort()).toEqual(['noul', 'score'])
  })

  it('fills BYOD tiles from sanitized LLM proposals in parallel', async () => {
    const proposals = [
      {
        id: 'series-urgent',
        title: 'Urgent tickets',
        question: 'Is this ticket urgent given the message?',
        visual: 'series' as const,
        reason: 'Support load.',
        task: 'Is this ticket urgent given the message?',
        questionKind: 'noul' as const,
        classes: [] as string[],
        cannedQuery: 'Is this ticket urgent given the message?',
      },
      {
        id: 'series-frustrated',
        title: 'Frustrated customers',
        question: 'Is this message frustrated?',
        visual: 'series' as const,
        reason: 'Tone.',
        task: 'Is this message frustrated?',
        questionKind: 'noul' as const,
        classes: [] as string[],
        cannedQuery: 'Is this message frustrated?',
      },
    ]
    const api = makeApi({
      propose: vi.fn(async () => ({ datasetId: uploaded.datasetId, insights: proposals, source: 'llm' as const })),
    })
    render(<App api={api} />)
    const file = new File(['message,tier\nhello,gold\n'], 'tickets.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    expect(await screen.findByRole('heading', { name: 'Urgent tickets' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Frustrated customers' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /classify by shift/i })).not.toBeInTheDocument()
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2))
    expect(document.querySelectorAll('[aria-label$="progress"]').length).toBeGreaterThanOrEqual(2)
  })

  it('shows an honest empty dashboard when LLM proposals fail', async () => {
    const api = makeApi({
      propose: vi.fn(async () => { throw new Error('OPENROUTER_MALFORMED') }),
    })
    render(<App api={api} />)
    const file = new File(['message,tier\nhello,gold\n'], 'tickets.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    expect(await screen.findByText(/no insights for this table/i)).toBeInTheDocument()
    expect(document.querySelector('.dashboard-grid')).toBeNull()
    expect(api.start).not.toHaveBeenCalled()
  })

  it('keeps Seahawks heuristics when that CSV is uploaded via BYOD', async () => {
    const preview: DatasetPreview = {
      ...getFixtureDatasetPreview(FOOTBALL_FIXTURE_ID)!,
      datasetId: 'dataset-byod-sea',
      sourceType: 'upload',
      displayName: 'seahawks-super-bowl-2026.csv',
    }
    const api = makeApi({
      createFromCsv: vi.fn(async () => preview),
      propose: vi.fn(async () => ({ datasetId: preview.datasetId, insights: [], source: 'empty' as const })),
    })
    render(<App api={api} />)
    const file = new File(['play_id\n1\n'], 'seahawks-super-bowl-2026.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText(/upload csv/i), { target: { files: [file] } })
    expect(await screen.findByRole('heading', { name: 'SEA win probability' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'SEA play quality' })).toBeInTheDocument()
    expect(api.propose).not.toHaveBeenCalled()
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2))
  })

  it('humanizes the schema strip and keeps the preview table secondary', async () => {
    const api = makeApi()
    openFixture(api)
    expect(await screen.findByRole('heading', { name: 'SEA win probability' })).toBeInTheDocument()
    expect(document.querySelector('.schema-strip-summary')?.textContent).toMatch(/Places|Numbers|Text/)
    expect(document.querySelector('.schema-strip-summary')?.textContent).not.toMatch(/\bgeo\b|\bnumber\b|\bstring\b/)
    const fold = document.querySelector('.preview-fold') as HTMLDetailsElement
    expect(fold).toBeTruthy()
    expect(fold.open).toBe(true)
    expect(screen.getByText(/preview table/i)).toBeInTheDocument()
    expect(document.querySelector('.dataset-preview.is-secondary')).toBeTruthy()
  })

  it('collapses the preview table at 390px', async () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query.includes('390px'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }))
    vi.stubGlobal('matchMedia', matchMedia)
    try {
      const api = makeApi()
      openFixture(api)
      expect(await screen.findByRole('heading', { name: 'SEA win probability' })).toBeInTheDocument()
      expect((document.querySelector('.preview-fold') as HTMLDetailsElement).open).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
