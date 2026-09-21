import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, canConfirmJevRun, defaultAnalysisApi, hasRunnableQuery, queryRunFooter, type AnalysisApiClient } from './App'
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
  previewRows: [{ message: 'hello', tier: 'gold' }],
  validationWarnings: [],
  publicDataWarning: 'public',
}

const makeApi = (overrides: Partial<AnalysisApiClient> = {}): AnalysisApiClient => ({
  draft: vi.fn(async () => draft),
  start: vi.fn(async () => snapshot({ status: 'queued', progress: { completedRows: 0, totalRows: 39, completedCalls: 0, totalCalls: 39 }, resultRows: [], currentFixtureRow: { rowIndex: 0, input } })),
  read: vi.fn(async () => snapshot()),
  share: vi.fn(async () => snapshot()),
  intakeStatus: vi.fn(async (): Promise<DatasetIntakeStatus> => ({ convex: true, uploadThing: true, sampleAvailable: true })),
  createFromCsv: vi.fn(async () => uploaded),
  createFromUrl: vi.fn(async (): Promise<DatasetPreview> => ({ ...uploaded, datasetId: 'dataset-url-1', sourceType: 'public_url', displayName: 'remote.csv' })),
  ...overrides,
})

const startSampleRun = async (api: AnalysisApiClient) => {
  render(<App api={api} />)
  fireEvent.click(screen.getByRole('button', { name: /^2026 super bowl demo$/i }))
  fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
  await screen.findByLabelText(/^Jev query JSON$/i)
  fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
}

describe('Jev playground flow', () => {
  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
    delete document.documentElement.dataset.theme
    document.documentElement.style.colorScheme = ''
  })
  it('renders a quiet idle landing with sample and BYOD only', async () => {
    const api = makeApi()
    render(<App api={api} />)
    expect(screen.getByRole('link', { name: /jev playground home/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /run jev on a csv/i })).toBeInTheDocument()
    expect(screen.queryByText(/bring a dataset\. ask a question\. see jev classify every row/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /choose a dataset/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /2026 super bowl demo/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /squirrel census/i })).toBeInTheDocument()
    expect(screen.getByText('Places where they eat.')).toBeInTheDocument()
    expect(screen.queryByText(/location vs activity/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/football is the sample, not the product/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/same live chart as the sample/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /upload \.csv or public https csv url/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/upload csv/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /use public csv url/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^2026 super bowl demo$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^squirrel census$/i })).toBeInTheDocument()
    expect(document.querySelector('[data-stage="intake"]')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /analysis task/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /jev query json/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/playground limits|5 mb|5,000|engineer playground|how a run works|demo playground/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/espn|gamecast|ask a football question|analyze your business/i)).not.toBeInTheDocument()
    expect(api.draft).not.toHaveBeenCalled()
    expect(api.start).not.toHaveBeenCalled()
    await waitFor(() => expect(api.intakeStatus).toHaveBeenCalled())
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
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^2026 super bowl demo$/i }))
    expect(document.querySelector('[data-stage="shape"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^2026 super bowl demo$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /run jev on a csv/i })).toBeInTheDocument()
    expect(screen.queryByText(/bring a dataset\. ask a question\. see jev classify every row/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /choose a dataset/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Analysis task$/i)).toHaveValue(SAMPLE_WIN_LIKELIHOOD_TASK)
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
    expect(api.start).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/^Analysis task$/i), { target: { value: 'Find a first-half signal.' } })
    expect(api.draft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    const editor = await screen.findByLabelText(/^Jev query JSON$/i)
    expect(document.querySelector('[data-stage="shape"]')).toBeTruthy()
    expect((editor as HTMLTextAreaElement).value).not.toBe(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(screen.queryByLabelText(/^Generated query$/i)).not.toBeInTheDocument()
    expect(api.draft).toHaveBeenCalledTimes(1)
    expect(api.start).not.toHaveBeenCalled()
    const runButton = screen.getByRole('button', { name: /run jev/i })
    expect(runButton).toBeEnabled()
    expect(screen.getByText('Classifying 39 of 71 rows (H1 plays).')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument()
    expect(document.querySelector('[data-stage="shape"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^2026 super bowl demo$/i })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /class distribution|win probability/i })).not.toBeInTheDocument()
    fireEvent.click(runButton)
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
    expect(document.querySelector('[data-stage="run"]')).toBeTruthy()
    expect(api.start).toHaveBeenCalledWith({ datasetId: FOOTBALL_FIXTURE_ID, fixtureId: FOOTBALL_FIXTURE_ID, query: draftQueryJson, classes: draft.metadata.classes, questionKind: 'choice' })
    expect(api.draft).toHaveBeenCalledTimes(1)
  })

  it('keeps Starting… in the query footer while Run is in flight', async () => {
    let finish: ((value: AnalysisSnapshot) => void) | undefined
    const pending = new Promise<AnalysisSnapshot>((resolve) => { finish = resolve })
    const api = makeApi({
      start: vi.fn(() => pending),
    })
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^2026 super bowl demo$/i }))
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
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^2026 super bowl demo$/i }))
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
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^2026 super bowl demo$/i }))
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
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({
      query: edited,
      questionKind: 'noul',
      classes: [],
    }))
  })

  it('keeps Run Jev disabled when Edit query text is cleared, and still accepts a manual edit', async () => {
    const api = makeApi()
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^2026 super bowl demo$/i }))
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
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1))
    expect(api.start).toHaveBeenCalledWith({ datasetId: FOOTBALL_FIXTURE_ID, fixtureId: FOOTBALL_FIXTURE_ID, query: edited, classes: draft.metadata.classes, questionKind: 'choice' })
  })

  it('renders progress, live chart, processed-row rail, and share action', async () => {
    const api = makeApi({ read: vi.fn(async () => snapshot({
      status: 'running',
      progress: { completedRows: 12, totalRows: 39, completedCalls: 12, totalCalls: 39 },
      resultRows: Array.from({ length: 3 }, (_, rowIndex) => ({ rowIndex, input, model: 'jev-latest', selectedClass: 'K.Walker', probabilities: { 'K.Walker': 0.72, 'C.Kupp': 0.1, 'J.Smith-Njigba': 0.12, 'Other/Tie': 0.06 }, confidence: 0.72 })),
    })) })
    await startSampleRun(api)
    expect(await screen.findByText('12 / 39 rows')).toBeInTheDocument()
    expect(screen.getAllByText(/classifying 39 of 71 rows \(h1 plays\)/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 2, name: '31%' })).toBeInTheDocument()
    expect(screen.getByText('12 / 39')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Class distribution' })).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /chart playhead/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^play$/i })).not.toBeInTheDocument()
    const rail = screen.getByRole('complementary', { name: /processed rows/i })
    expect(within(rail).getByRole('button', { name: /row 1 of 39/i })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: new RegExp(`row 3 of 39 ${input.play_id} · Q${input.qtr} · K\\.Walker`, 'i') })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /current row inspector/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /incremental analysis results/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /incremental results/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy shareable public url/i })).toBeInTheDocument()
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
      start: vi.fn(async () => running(0, 'queued')),
      read: vi.fn(async () => {
        reads += 1
        if (reads === 1) return running(1)
        if (reads === 2) return running(2)
        return running(3, 'complete')
      }),
    })
    await startSampleRun(api)
    expect(await screen.findByText('Waiting for the first row…')).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: /processed rows/i })).queryByRole('button')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Waiting for the first row…')).not.toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('[data-class="K.Walker"]')).toHaveAttribute('data-count', '1'))
    await waitFor(() => expect(document.querySelector('[data-class="C.Kupp"]')).toHaveAttribute('data-count', '1'))
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
      start: vi.fn(async () => noulRun),
      read: vi.fn(async () => noulRun),
    })
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^2026 super bowl demo$/i }))
    expect(document.querySelector('[data-insight-id="series-win"]')).toHaveAttribute('data-visual', 'series')
    expect(document.querySelector('[data-insight-id="series-play-quality"]')).toHaveAttribute('data-visual', 'series')
    expect(document.querySelector('[data-insight-id="series-play-quality"] [data-preview="series"]')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'SEA play quality' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Play quality$/ })).not.toBeInTheDocument()
    expect(screen.getByText('Series')).toBeInTheDocument()
    expect(screen.getByLabelText(/dataset shape/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'SEA win probability' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Win probability$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /win likelihood/i })).not.toBeInTheDocument()
    fireEvent.click(within(document.querySelector('[data-insight-id="series-win"]') as HTMLElement).getByRole('button', { name: /run insight/i }))
    expect(await screen.findByRole('heading', { level: 2, name: '4%' })).toBeInTheDocument()
    expect(screen.getByText('3 / 71')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'SEA win probability' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /sea win probability over play index/i })).toBeInTheDocument()
    expect(screen.getByText(/^Play 3 · SEA 60%$/)).toBeInTheDocument()
    expect(screen.queryByText(/^Play 3 · 60%$/)).not.toBeInTheDocument()
    expect(await screen.findByText('3 / 71 rows')).toBeInTheDocument()
    expect(document.querySelector('[data-chart-kind="series"]')).toBeTruthy()
    expect(document.querySelector('[data-play-cursor="true"]')).toBeTruthy()
    expect(document.querySelector('[data-series-points="3"]')).toBeTruthy()
    expect(document.querySelector('[data-class="K.Walker"]')).toBeNull()
    expect(document.querySelector('[data-class="Adams"]')).toBeNull()
    const rail = screen.getByRole('complementary', { name: /processed rows/i })
    expect(within(rail).getByRole('button', { name: /row 1 of 71/i })).toBeInTheDocument()
    expect(within(rail).getByText(/SEA 40%/)).toBeInTheDocument()
    expect(within(rail).queryByText('K.Walker')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Row 3 of 71' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /chart playhead/i })).toHaveAttribute('max', '70')
    expect(document.querySelector('.series-line')).toBeTruthy()
    expect(document.querySelector('.series-fill')).toBeTruthy()
    expect(api.draft).toHaveBeenCalledWith(expect.objectContaining({ task: SAMPLE_WIN_LIKELIHOOD_TASK }))
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ query: noulQueryJson, questionKind: 'noul', classes: [] }))
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
      start: vi.fn(async () => scoreRun),
      read: vi.fn(async () => scoreRun),
    })
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^2026 super bowl demo$/i }))
    const playQualityCard = document.querySelector('[data-insight-id="series-play-quality"]') as HTMLElement
    expect(playQualityCard).toHaveAttribute('data-visual', 'series')
    expect(playQualityCard.querySelector('[data-preview="series"]')).toBeTruthy()
    expect(within(playQualityCard).queryByText(/class bars/i)).not.toBeInTheDocument()
    fireEvent.click(within(playQualityCard).getByRole('button', { name: /run insight/i }))
    expect(await screen.findByRole('img', { name: /sea play quality over play index/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'SEA play quality' })).toBeInTheDocument()
    expect(screen.getByText(/^Play 3 · SEA 55%$/)).toBeInTheDocument()
    expect(screen.getByText('3 / 71')).toBeInTheDocument()
    expect(document.querySelector('[data-chart-kind="series"]')).toBeTruthy()
    expect(document.querySelector('[data-class="Good Play"]')).toBeNull()
    expect(document.querySelector('[data-class="Bad Play"]')).toBeNull()
    expect(screen.queryByText(/classifying 39 of 71 rows \(h1 plays\)/i)).not.toBeInTheDocument()
    expect(api.draft).toHaveBeenCalledWith(expect.objectContaining({ task: SAMPLE_PLAY_QUALITY_TASK }))
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ query: scoreQueryJson, questionKind: 'score' }))
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
      start: vi.fn(async () => eatingRun),
      read: vi.fn(async () => eatingRun),
    })
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^squirrel census$/i }))
    expect(screen.getByLabelText(/dataset shape/i)).toBeInTheDocument()
    expect(screen.getByText('Places where they eat.')).toBeInTheDocument()
    expect(screen.queryByText(/location vs activity/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /where they eat/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run insight/i })).toBeInTheDocument()
    expect(screen.queryByText(/^Location$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Activity$/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Analysis task$/i)).toHaveValue(SQUIRREL_EATING_TASK)
    fireEvent.click(screen.getByRole('button', { name: /run insight/i }))
    expect(await screen.findByRole('img', { name: /places map of eating locations/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '100%' })).toBeInTheDocument()
    expect(screen.queryByText(/using saved run/i)).not.toBeInTheDocument()
    expect(document.querySelector('[data-chart-kind="places"]')).toBeTruthy()
    expect(document.querySelector('[data-place-points="3"]')).toBeTruthy()
    expect(document.querySelector('[data-class="Location"]')).toBeNull()
    expect(document.querySelector('[data-class="Activity"]')).toBeNull()
    expect(screen.queryByRole('complementary', { name: /processed rows/i })).not.toBeInTheDocument()
    expect(api.draft).toHaveBeenCalledWith(expect.objectContaining({
      datasetId: SQUIRREL_FIXTURE_ID,
      fixtureId: SQUIRREL_FIXTURE_ID,
      task: SQUIRREL_EATING_TASK,
    }))
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({
      datasetId: SQUIRREL_FIXTURE_ID,
      fixtureId: SQUIRREL_FIXTURE_ID,
      questionKind: 'noul',
      classes: [],
    }))
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
      start: vi.fn(async () => running(0)),
      read: vi.fn(async () => {
        reads += 1
        if (reads === 1) return running(1)
        if (reads === 2) return running(2)
        return running(3)
      }),
    })
    await startSampleRun(api)
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
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await screen.findByLabelText(/^Jev query JSON$/i)
    expect(screen.getByRole('button', { name: /run jev/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    await waitFor(() => expect(api.start).toHaveBeenCalledWith({
      datasetId: uploaded.datasetId,
      fixtureId: undefined,
      query: ticketsQueryJson,
      classes: ['gold', 'silver'],
      questionKind: 'choice',
    }))
    expect(await screen.findByText('1 / 2 rows')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /chart playhead/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /row 1 of 2/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /current row inspector/i })).not.toBeInTheDocument()
    expect(document.querySelector('[data-class="gold"]')).toHaveAttribute('data-count', '1')
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
      previewRows: [{ id: 1, text: 'apple', label_hint: 'fruit' }],
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
    render(<App api={api} />)
    fireEvent.click(screen.getByRole('button', { name: /^2026 super bowl demo$/i }))
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(INVALID_CLASSES_COPY)
    expect(alert).toHaveTextContent(/couldn't draft/i)
    expect(alert).not.toHaveTextContent('INVALID_CLASSES')
    expect(api.start).not.toHaveBeenCalled()
  })

  it('keeps idle intake quiet when durable storage is down, and still lets sample start', async () => {
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
    expect(screen.getByRole('button', { name: /^2026 super bowl demo$/i })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^2026 super bowl demo$/i }))
    expect(screen.getByLabelText(/^Analysis task$/i)).toHaveValue(SAMPLE_WIN_LIKELIHOOD_TASK)
    expect(api.start).not.toHaveBeenCalled()
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
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't run/i)
    expect(screen.getByText(/jev hit a provider error/i)).toBeInTheDocument()
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
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't finish this run/i)
    expect(alert).toHaveTextContent(/could not use/i)
    expect(alert).toHaveTextContent(/resume from row 32/i)
    expect(screen.queryByText(/JEV_MALFORMED_RESPONSE/)).not.toBeInTheDocument()
    expect(screen.queryByText(/retryable/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^stopped\.$/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /resume from row 32/i }))
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2))
    expect(api.start).toHaveBeenLastCalledWith(expect.objectContaining({
      analysisId: failed.analysisId,
      resume: true,
    }))
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
    expect(await screen.findByText(/still working/i)).toBeInTheDocument()
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
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/this run may be stuck — resume or start again/i)
    expect(alert).toHaveTextContent(/resume from row 729/i)
    expect(screen.getByRole('button', { name: /resume from row 729/i })).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: /^2026 super bowl demo$/i }))
    expect(screen.getByLabelText(/^Analysis task$/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/public https csv url/i), { target: { value: 'http://example.com/data.csv' } })
    fireEvent.click(screen.getByRole('button', { name: /use public csv url/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't load dataset/i)
    expect(alert).toHaveTextContent(/use an https csv url/i)
    expect(screen.queryByText(/couldn't run/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Analysis task$/i)).toBeInTheDocument()
  })

  it('resets Share Copied when the user drafts again and after a short delay', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const api = makeApi({
      start: vi.fn(async () => snapshot()),
      read: vi.fn(async () => snapshot()),
    })
    await startSampleRun(api)
    const share = await screen.findByRole('button', { name: /copy shareable public url/i })
    fireEvent.click(share)
    await waitFor(() => expect(share).toHaveTextContent(/^copied$/i))
    fireEvent.click(screen.getByRole('button', { name: /draft task/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /copy shareable public url/i })).toHaveTextContent(/^share$/i))
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: /copy shareable public url/i }))
      await act(async () => { await Promise.resolve() })
      expect(screen.getByRole('button', { name: /copy shareable public url/i })).toHaveTextContent(/^copied$/i)
      await act(async () => { vi.advanceTimersByTime(2500) })
      expect(screen.getByRole('button', { name: /copy shareable public url/i })).toHaveTextContent(/^share$/i)
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
    await startSampleRun(api)
    const latency = await screen.findByText(/classified 39 of 71 rows \(h1 plays\)/i)
    expect(latency).not.toHaveTextContent(/using saved run/i)
    expect(screen.queryByText(/using saved run/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy shareable public url/i })).toBeInTheDocument()
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
    expect(await screen.findByRole('heading', { level: 2, name: '100%' })).toBeInTheDocument()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenNthCalledWith(1, expect.not.objectContaining({ forceNew: true }))
    expect(screen.queryByText(/live run/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/using saved run/i)).not.toBeInTheDocument()
    expect(screen.getByText('39 of 39')).toBeInTheDocument()
    expect(document.querySelector('.analysis-card')).toHaveAttribute('data-complete-snap')
    expect(document.querySelector('.analysis-card')).toHaveAttribute('data-saved-run')
    expect(document.querySelector('.chart-shell')).toHaveAttribute('data-motion', 'seek')
    fireEvent.click(screen.getByRole('button', { name: /run jev/i }))
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2))
    expect(start).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ forceNew: true }))
    expect(JSON.stringify(start.mock.calls)).not.toContain('forceNew')
    expect(screen.queryByText(/using saved run/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/live run/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '100%' })).toBeInTheDocument()
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
    await startSampleRun(api)
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
})
