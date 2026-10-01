import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, parseRoute } from './App'
import { ApiClientError, type PlaygroundApi } from './api/client'
import { CSV_MAX_BYTES } from './dataset/csvTypes'
import { SAMPLE_DATASET_ID, sampleRows } from './dataset/sampleDataset'
import type { AnalysisDraftResult, AnalysisMeta, AnalysisPage, AnalysisStartResult } from './shared/analysis'
import type { DatasetPreview, PlaygroundStatus } from './shared/dataset'
import { controlTokenFor } from './state/controlTokens'

const NOW = 1_800_000_000_000

const STATUS: PlaygroundStatus = { storage: true, drafting: 'live', classifier: 'live', runsEnabled: true, limits: { maxRows: 5_000, maxBytes: CSV_MAX_BYTES, maxColumns: 100 } }

const meta = (patch: Partial<AnalysisMeta> = {}): AnalysisMeta => ({
  analysisId: 'run-abc',
  datasetId: SAMPLE_DATASET_ID,
  datasetName: 'Super Bowl LX — every Seattle play',
  sourceType: 'sample',
  query: 'Will they run or pass?',
  classes: [{ name: 'Run', description: '' }, { name: 'Pass', description: '' }],
  columns: ['quarter', 'play_call'],
  labelColumn: 'play_call',
  status: 'complete',
  mode: 'live',
  createdAt: NOW - 1_000,
  updatedAt: NOW,
  startedAt: NOW - 500,
  completedAt: NOW,
  progress: { totalRows: 3, completedRows: 3, failedRows: 0 },
  ...patch,
})

const runPage = (patch: Partial<AnalysisMeta> = {}): AnalysisPage => ({
  analysis: meta(patch),
  rows: [0, 1, 2].map((i) => ({ rowIndex: i, model: 'm', selectedClass: i === 1 ? 'Pass' : 'Run', probabilities: [0.6, 0.4], confidence: 0.6, values: [i + 1, i === 1 ? 'Pass' : 'Run'] })),
  nextAfter: 2,
  hasMore: false,
  serverTime: NOW,
})

const csvPreview = (patch: Partial<DatasetPreview> = {}): DatasetPreview => ({
  datasetId: 'ds-upload',
  sourceType: 'upload',
  displayName: 'tickets.csv',
  byteSize: 2_048,
  delimiter: ',',
  columns: [{ name: 'subject', inferredType: 'string' }, { name: 'priority', inferredType: 'string' }],
  acceptedRowCount: 12,
  previewRows: [['Printer on fire', 'high'], ['Where is my invoice', 'low']],
  validationWarnings: [],
  ...patch,
})

const makeApi = (overrides: Partial<Record<keyof PlaygroundApi, unknown>> = {}) => {
  const defaults = {
    status: vi.fn(async () => STATUS),
    uploadCsv: vi.fn(async () => csvPreview()),
    datasetFromUrl: vi.fn(async () => csvPreview({ sourceType: 'public_url', displayName: 'remote.csv' })),
    draft: vi.fn(async (): Promise<AnalysisDraftResult> => ({ datasetId: SAMPLE_DATASET_ID, query: 'Drafted question?', classes: [{ name: 'Alpha', description: 'a' }, { name: 'Beta', description: 'b' }, { name: 'Gamma', description: 'c' }], model: 'draft-model', mode: 'live' })),
    start: vi.fn(async (): Promise<AnalysisStartResult> => ({ analysis: meta({ status: 'queued', progress: { totalRows: 71, completedRows: 0, failedRows: 0 } }), controlToken: 'tok-123' })),
    read: vi.fn(async () => runPage()),
    cancel: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    browse: vi.fn(async () => ({ analyses: [], datasets: [] })),
  }
  return { ...defaults, ...overrides } as typeof defaults & PlaygroundApi
}

const renderApp = (api: PlaygroundApi) => render(<App api={api} />)


const openSample = async (api: PlaygroundApi) => {
  renderApp(api)
  fireEvent.click(await screen.findByRole('button', { name: /Try the sample/ }))
  await screen.findByRole('heading', { name: 'Super Bowl LX — every Seattle play' })
}

const runButton = () => screen.getByRole('button', { name: /Run Jev on|Starting/ })
const setValue = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } })

const csvFile = (text: string, name = 'data.csv') => new File([text], name, { type: 'text/csv' })
const upload = (file: File) => fireEvent.change(screen.getByLabelText('Upload a CSV file'), { target: { files: [file] } })

beforeAll(() => {
  // jsdom's File has no arrayBuffer(); browsers do.
  if (typeof File.prototype.arrayBuffer !== 'function') {
    Object.defineProperty(File.prototype, 'arrayBuffer', {
      configurable: true,
      value(this: File) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.onerror = () => reject(reader.error)
          reader.readAsArrayBuffer(this)
        })
      },
    })
  }
})

beforeEach(() => {
  window.localStorage.clear()
  window.history.pushState(null, '', '/')
  vi.stubGlobal('scrollTo', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseRoute', () => {
  it('routes /run/<id> and the legacy /share/<id> to the run page', () => {
    expect(parseRoute('/run/abc')).toEqual({ name: 'run', analysisId: 'abc' })
    expect(parseRoute('/share/abc')).toEqual({ name: 'run', analysisId: 'abc' })
    expect(parseRoute('/run/abc/')).toEqual({ name: 'run', analysisId: 'abc' })
    expect(parseRoute('/run/a%20b')).toEqual({ name: 'run', analysisId: 'a b' })
  })

  it('sends everything else, including malformed paths, home', () => {
    for (const path of ['/', '/run', '/run/', '/run/a/b', '/other/abc', '/run/%E0%A4%A']) expect(parseRoute(path)).toEqual({ name: 'home' })
  })
})

describe('landing', () => {
  it('shows the sample card, the upload card and the public-upload warning', async () => {
    renderApp(makeApi())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ask one question of every row.')
    expect(screen.getByRole('heading', { name: 'Super Bowl LX: run or pass?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try the sample/ })).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Bring a CSV' })).toBeInTheDocument()
    expect(screen.getByLabelText('Upload a CSV file')).toBeEnabled()
    expect(screen.getByLabelText('Or paste a public link')).toBeEnabled()
    expect(await screen.findByText(/Uploads are public: anyone with the link can see the data/)).toBeVisible()
    expect(screen.getByText(/Runs and uploaded data are public to anyone with the link/)).toBeInTheDocument()
  })

  it('advertises the size and row limits', () => {
    renderApp(makeApi())
    expect(screen.getByText('Up to 4 MB and 5,000 rows')).toBeInTheDocument()
  })

  it('shows example rows that really exist in the sample data', () => {
    renderApp(makeApi())
    const rows = sampleRows()
    const items = within(screen.getByRole('list', { name: 'Example rows' })).getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      const text = Array.from(item.children, (child) => child.textContent).join(' ')
      const [, quarter, clock] = /Q(\d) · (\d+:\d\d)/.exec(text) ?? []
      const [, down, toGo] = /(\d)(?:st|nd|rd|th) & (\d+)/.exec(text) ?? []
      const [, endZone] = /(\d+) yards to go/.exec(text) ?? []
      expect(rows.some((row) => String(row[0]) === quarter && row[1] === clock && String(row[2]) === down && String(row[3]) === toGo && String(row[4]) === endZone)).toBe(true)
    }
  })

  it('still lets you start when the status request fails', async () => {
    const api = makeApi({ status: vi.fn().mockRejectedValue(new Error('down')) })
    await openSample(api)
    expect(runButton()).toBeEnabled()
  })
})

describe('sample dataset', () => {
  it('shows the preview with all 7 columns and the held-out column marked', async () => {
    await openSample(makeApi())
    const table = screen.getByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers).toHaveLength(7)
    expect(headers.map((header) => header.textContent?.replace('held out', ''))).toEqual(['quarter', 'clock', 'down', 'yards_to_go', 'yards_to_end_zone', 'score_margin', 'play_call'])
    expect(within(table).getByRole('columnheader', { name: 'play_call held out' })).toBeInTheDocument()
    expect(within(table).getAllByText('held out')).toHaveLength(1)
    expect(screen.getByText(/71 rows · 7 columns/)).toBeInTheDocument()
    expect(screen.getByText('Showing the first 8 of 71 rows.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Score against a column/)).toHaveValue('play_call')
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href')
  })

  it('arrives with a question and two labels already filled in', async () => {
    await openSample(makeApi())
    expect((screen.getByLabelText('Question asked about every row') as HTMLTextAreaElement).value).toMatch(/run or a pass/)
    expect(screen.getByLabelText('Label 1 name')).toHaveValue('Run')
    expect(screen.getByLabelText('Label 2 name')).toHaveValue('Pass')
    expect(screen.getByLabelText('Label 1 meaning')).not.toHaveValue('')
    expect(screen.queryByLabelText('Label 3 name')).not.toBeInTheDocument()
  })

  it('REGRESSION: "Run Jev on 71 rows" is enabled without editing anything', async () => {
    await openSample(makeApi())
    expect(screen.getByRole('button', { name: 'Run Jev on 71 rows' })).toBeEnabled()
    expect(screen.queryByRole('status', { name: '' })).toBeNull()
  })

  it('is described honestly: 71 rows means 71 calls', async () => {
    await openSample(makeApi())
    expect(screen.getByText(/71 Jev calls, one per row/)).toBeInTheDocument()
  })

  it('"Change dataset" returns to the landing', async () => {
    await openSample(makeApi())
    fireEvent.click(screen.getByRole('button', { name: 'Change dataset' }))
    expect(screen.getByRole('button', { name: /Try the sample/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ask one question of every row.')
    expect(screen.queryByRole('heading', { name: 'What should Jev decide for each row?' })).not.toBeInTheDocument()
  })

  it('a fresh sample selection restores the suggested question after an edit', async () => {
    await openSample(makeApi())
    setValue(screen.getByLabelText('Label 1 name'), 'Changed')
    fireEvent.click(screen.getByRole('button', { name: 'Change dataset' }))
    fireEvent.click(screen.getByRole('button', { name: /Try the sample/ }))
    expect(screen.getByLabelText('Label 1 name')).toHaveValue('Run')
  })
})

describe('labels', () => {
  it('are visible and editable', async () => {
    await openSample(makeApi())
    setValue(screen.getByLabelText('Label 1 name'), 'Rush')
    expect(screen.getByLabelText('Label 1 name')).toHaveValue('Rush')
    setValue(screen.getByLabelText('Label 2 meaning'), 'Throws it')
    expect(screen.getByLabelText('Label 2 meaning')).toHaveValue('Throws it')
  })

  it('disable Run and say why when a label name is cleared', async () => {
    await openSample(makeApi())
    setValue(screen.getByLabelText('Label 1 name'), '')
    expect(runButton()).toBeDisabled()
    expect(screen.getByText('Add at least two labels for Jev to choose from.')).toBeInTheDocument()
    setValue(screen.getByLabelText('Label 1 name'), '   ')
    expect(runButton()).toBeDisabled()
    setValue(screen.getByLabelText('Label 1 name'), 'Run')
    expect(runButton()).toBeEnabled()
    expect(screen.queryByText('Add at least two labels for Jev to choose from.')).not.toBeInTheDocument()
  })

  it('disable Run and say why when two labels are identical (ignoring case and spaces)', async () => {
    await openSample(makeApi())
    setValue(screen.getByLabelText('Label 2 name'), ' run ')
    expect(runButton()).toBeDisabled()
    expect(screen.getByText('Two labels have the same name.')).toBeInTheDocument()
    setValue(screen.getByLabelText('Label 2 name'), 'Pass')
    expect(runButton()).toBeEnabled()
  })

  it('disable Run and say why when the question is empty', async () => {
    await openSample(makeApi())
    setValue(screen.getByLabelText('Question asked about every row'), '   ')
    expect(runButton()).toBeDisabled()
    expect(screen.getByText('Write the question Jev should answer for each row.')).toBeInTheDocument()
  })

  it('can be added and removed, but never below two', async () => {
    await openSample(makeApi())
    expect(screen.getByRole('button', { name: 'Remove label Run' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove label Pass' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Add a label' }))
    expect(screen.getByLabelText('Label 3 name')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Remove label Run' })).toBeEnabled()
    setValue(screen.getByLabelText('Label 3 name'), 'Kick')
    expect(screen.getByRole('button', { name: 'Remove label Kick' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove label Run' }))
    expect(screen.queryByLabelText('Label 3 name')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Label 1 name')).toHaveValue('Pass')
    expect(screen.getByLabelText('Label 2 name')).toHaveValue('Kick')
    expect(screen.getByRole('button', { name: 'Remove label Pass' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove label Kick' })).toBeDisabled()
  })

  it('a blank extra label does not block Run and is not sent', async () => {
    const api = makeApi()
    await openSample(api)
    fireEvent.click(screen.getByRole('button', { name: 'Add a label' }))
    expect(runButton()).toBeEnabled()
    fireEvent.click(runButton())
    await waitFor(() => expect(api.start).toHaveBeenCalled())
    expect((api.start.mock.calls[0] as unknown[])[0]).toMatchObject({ classes: [{ name: 'Run' }, { name: 'Pass' }] })
  })

  it('stop adding at the maximum of 32', async () => {
    await openSample(makeApi())
    for (let count = 2; count < 32; count += 1) fireEvent.click(screen.getByRole('button', { name: 'Add a label' }))
    expect(screen.getByLabelText('Label 32 name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a label' })).toBeDisabled()
  })
})

describe('drafting', () => {
  it('calls api.draft with the task, dataset and label column and replaces the question and labels', async () => {
    const api = makeApi()
    await openSample(api)
    setValue(screen.getByLabelText('Describe it in your own words'), '  Which plays are risky?  ')
    fireEvent.click(screen.getByRole('button', { name: /Draft question and labels/ }))
    await waitFor(() => expect(screen.getByLabelText('Label 3 name')).toHaveValue('Gamma'))
    expect(api.draft).toHaveBeenCalledWith({ datasetId: SAMPLE_DATASET_ID, task: 'Which plays are risky?', labelColumn: 'play_call' })
    expect(screen.getByLabelText('Question asked about every row')).toHaveValue('Drafted question?')
    expect(screen.getByLabelText('Label 1 name')).toHaveValue('Alpha')
    expect(screen.getByLabelText('Label 2 name')).toHaveValue('Beta')
    expect(screen.getByText('Drafted by draft-model. Edit anything before you run.')).toBeInTheDocument()
    expect(screen.getByLabelText('Describe it in your own words')).toHaveValue('  Which plays are risky?  ')
  })

  it('omits labelColumn when the dataset is not scored', async () => {
    const api = makeApi()
    await openSample(api)
    setValue(screen.getByLabelText(/Score against a column/), '')
    fireEvent.click(screen.getByRole('button', { name: /Draft question and labels/ }))
    await waitFor(() => expect(api.draft).toHaveBeenCalled())
    expect(api.draft).toHaveBeenCalledWith({ datasetId: SAMPLE_DATASET_ID, task: 'Before each snap, predict whether Seattle runs or passes.' })
  })

  it('says a simulated draft is a template', async () => {
    const api = makeApi({ draft: vi.fn().mockResolvedValue({ datasetId: 'x', query: 'Template?', classes: [{ name: 'A', description: '' }, { name: 'B', description: '' }], model: 'mock', mode: 'mock' }) })
    await openSample(api)
    fireEvent.click(screen.getByRole('button', { name: /Draft question and labels/ }))
    expect(await screen.findByText(/Simulated draft/)).toBeInTheDocument()
  })

  it('shows the server message when drafting fails and leaves the form usable', async () => {
    const api = makeApi({ draft: vi.fn().mockRejectedValue(new ApiClientError('DRAFT_FAILED', 'The drafting model is busy right now.', 503, true)) })
    await openSample(api)
    const before = (screen.getByLabelText('Question asked about every row') as HTMLTextAreaElement).value
    fireEvent.click(screen.getByRole('button', { name: /Draft question and labels/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The drafting model is busy right now.')
    expect(screen.getByLabelText('Question asked about every row')).toHaveValue(before)
    expect(screen.getByLabelText('Label 1 name')).toHaveValue('Run')
    expect(screen.getByRole('button', { name: /Draft question and labels/ })).toBeEnabled()
    expect(runButton()).toBeEnabled()
  })

  it('falls back to a generic message for an unexpected draft failure', async () => {
    const api = makeApi({ draft: vi.fn().mockRejectedValue(new TypeError('kaboom')) })
    await openSample(api)
    fireEvent.click(screen.getByRole('button', { name: /Draft question and labels/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not draft that. You can write the question and labels yourself.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('kaboom')
  })

  it('needs a description before it can draft', async () => {
    await openSample(makeApi())
    setValue(screen.getByLabelText('Describe it in your own words'), '   ')
    expect(screen.getByRole('button', { name: /Draft question and labels/ })).toBeDisabled()
  })

  it('is hidden when drafting is switched off', async () => {
    const api = makeApi({ status: vi.fn(async () => ({ ...STATUS, drafting: 'off' })) })
    renderApp(api)
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Try the sample/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Draft question and labels/ })).not.toBeInTheDocument())
    expect(screen.getByLabelText('Question asked about every row')).toBeInTheDocument()
  })
})

describe('running', () => {
  it('starts with trimmed query, classes and labelColumn, then the URL becomes /run/<id> and the run page renders', async () => {
    const api = makeApi()
    await openSample(api)
    setValue(screen.getByLabelText('Question asked about every row'), '  Will they run or pass?  ')
    setValue(screen.getByLabelText('Label 1 name'), ' Run ')
    setValue(screen.getByLabelText('Label 1 meaning'), '  A rush  ')
    fireEvent.click(screen.getByRole('button', { name: 'Run Jev on 71 rows' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Will they run or pass?' })).toBeInTheDocument()
    expect(api.start).toHaveBeenCalledTimes(1)
    const input = (api.start.mock.calls[0] as unknown[])[0]
    expect(input).toEqual({
      datasetId: SAMPLE_DATASET_ID,
      query: 'Will they run or pass?',
      classes: [{ name: 'Run', description: 'A rush' }, { name: 'Pass', description: expect.any(String) }],
      labelColumn: 'play_call',
    })
    expect(window.location.pathname).toBe('/run/run-abc')
    expect(api.read).toHaveBeenCalledWith('run-abc', -1)
    expect(screen.queryByRole('heading', { name: 'What should Jev decide for each row?' })).not.toBeInTheDocument()
  })

  it('stores the control token for the new run', async () => {
    await openSample(makeApi())
    fireEvent.click(screen.getByRole('button', { name: 'Run Jev on 71 rows' }))
    await screen.findByRole('heading', { level: 1 })
    expect(controlTokenFor('run-abc')).toBe('tok-123')
  })

  it('gives the owner Cancel/Resume controls straight away and does not auto-replay a run you just started', async () => {
    const api = makeApi({ read: vi.fn(async () => runPage({ status: 'running' })) })
    await openSample(api)
    fireEvent.click(screen.getByRole('button', { name: 'Run Jev on 71 rows' }))
    expect(await screen.findByRole('button', { name: /Cancel run/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replay the run' })).toBeInTheDocument()
  })

  it('omits labelColumn when the dataset is not scored', async () => {
    const api = makeApi()
    await openSample(api)
    setValue(screen.getByLabelText(/Score against a column/), '')
    fireEvent.click(runButton())
    await waitFor(() => expect(api.start).toHaveBeenCalled())
    expect((api.start.mock.calls[0] as unknown[])[0]).not.toHaveProperty('labelColumn')
  })

  it('shows the server message when starting fails, stays on the form and lets you retry', async () => {
    const api = makeApi()
    api.start.mockRejectedValueOnce(new ApiClientError('RATE_LIMITED', 'You have started too many runs. Try again later.', 429, true))
    await openSample(api)
    fireEvent.click(runButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('You have started too many runs. Try again later.')
    expect(window.location.pathname).toBe('/')
    expect(controlTokenFor('run-abc')).toBeUndefined()
    await waitFor(() => expect(runButton()).toBeEnabled())
    fireEvent.click(runButton())
    expect(await screen.findByRole('heading', { level: 1, name: 'Will they run or pass?' })).toBeInTheDocument()
  })

  it('does not start twice on a double click', async () => {
    let finish: (value: AnalysisStartResult) => void = () => undefined
    const api = makeApi({ start: vi.fn(() => new Promise<AnalysisStartResult>((resolve) => { finish = resolve })) })
    await openSample(api)
    fireEvent.click(runButton())
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Starting…' }))
    expect(api.start).toHaveBeenCalledTimes(1)
    finish({ analysis: meta(), controlToken: 't' })
    await screen.findByRole('heading', { level: 1 })
  })

  it('moves back to the landing when the browser goes back from a run', async () => {
    await openSample(makeApi())
    fireEvent.click(runButton())
    await screen.findByRole('heading', { level: 1, name: 'Will they run or pass?' })
    window.history.pushState(null, '', '/')
    fireEvent(window, new PopStateEvent('popstate'))
    expect(await screen.findByRole('button', { name: /Try the sample/ })).toBeInTheDocument()
  })
})

describe('deployment status', () => {
  it('with storage off: uploads are disabled with an explanation, the sample is still selectable and Run is disabled with a reason', async () => {
    const api = makeApi({ status: vi.fn(async () => ({ ...STATUS, storage: false })) })
    renderApp(api)
    expect(await screen.findByText(/Uploads are switched off on this deployment/)).toBeInTheDocument()
    expect(screen.getByLabelText('Upload a CSV file')).toBeDisabled()
    expect(screen.getByLabelText('Or paste a public link')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Fetch' })).toBeDisabled()
    expect(screen.queryByText(/Uploads are public/)).not.toBeInTheDocument()
    const sample = screen.getByRole('button', { name: /Try the sample/ })
    expect(sample).toBeEnabled()
    fireEvent.click(sample)
    await screen.findByRole('heading', { name: 'Super Bowl LX — every Seattle play' })
    expect(screen.getByRole('button', { name: 'Run Jev on 71 rows' })).toBeDisabled()
    expect(screen.getByText(/no storage configured yet, so runs are unavailable/)).toBeInTheDocument()
  })

  it('with the classifier off: Run is disabled with a reason', async () => {
    const api = makeApi({ status: vi.fn(async () => ({ ...STATUS, classifier: 'off' })) })
    renderApp(api)
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Try the sample/ }))
    expect(await screen.findByText(/Jev is not connected on this deployment yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jev on 71 rows' })).toBeDisabled()
  })

  it('with runs paused: Run is disabled with a reason', async () => {
    const api = makeApi({ status: vi.fn(async () => ({ ...STATUS, runsEnabled: false })) })
    renderApp(api)
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Try the sample/ }))
    expect(await screen.findByText(/New runs are paused/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jev on 71 rows' })).toBeDisabled()
  })

  it('with the classifier in mock mode: shows a visible Simulated indicator, also next to Run', async () => {
    const api = makeApi({ status: vi.fn(async () => ({ ...STATUS, classifier: 'mock' })) })
    renderApp(api)
    expect(await screen.findByText('Simulated mode')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Try the sample/ }))
    expect(await screen.findByText(/This deployment is in simulated mode, so no real calls are made/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jev on 71 rows' })).toBeEnabled()
  })

  it('with a live classifier: no Simulated indicator', async () => {
    const api = makeApi()
    renderApp(api)
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(screen.queryByText('Simulated mode')).not.toBeInTheDocument()
  })
})

describe('upload', () => {
  it('rejects a file over 4 MB locally with a message and never calls api.uploadCsv', async () => {
    const api = makeApi()
    renderApp(api)
    upload(new File([new Uint8Array(5 * 1024 * 1024)], 'big.csv'))
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is 5.0 MB. The limit is 4 MB.')
    expect(api.uploadCsv).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Try the sample/ })).toBeInTheDocument()
  })

  it('does not treat a file of exactly 4 MB as too large for the local size check', async () => {
    const api = makeApi()
    renderApp(api)
    upload(new File([new Uint8Array(CSV_MAX_BYTES)], 'exact.csv'))
    expect(await screen.findByRole('alert')).not.toHaveTextContent(/The limit is/)
    expect(api.uploadCsv).not.toHaveBeenCalled()
  })

  it.each([
    ['only a header', 'a,b\n', /no data rows/],
    ['an empty file', '', /no data rows/],
    ['duplicate column names', 'a,a\n1,2\n', /header/],
    ['an HTML page', '<!doctype html><html><body>hi</body></html>', /not a CSV/],
  ])('rejects %s locally and never calls api.uploadCsv', async (_label, text, message) => {
    const api = makeApi()
    renderApp(api)
    upload(csvFile(text))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(api.uploadCsv).not.toHaveBeenCalled()
  })

  it('rejects a file with more rows than this deployment allows, with the numbers', async () => {
    const api = makeApi({ status: vi.fn(async () => ({ ...STATUS, limits: { ...STATUS.limits, maxRows: 2 } })) })
    renderApp(api)
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    await screen.findByText('Up to 4 MB and 2 rows')
    upload(csvFile('a,b\n1,2\n3,4\n5,6\n'))
    expect(await screen.findByRole('alert')).toHaveTextContent('That file has 3 rows. This playground runs at most 2.')
    expect(api.uploadCsv).not.toHaveBeenCalled()
  })

  it('sends a valid file to api.uploadCsv and shows the returned preview, including validation warnings', async () => {
    const preview = csvPreview({ validationWarnings: ['1 row had fewer cells than the header and was padded.', 'Column “id” kept as text to preserve leading zeros or long IDs.'] })
    const api = makeApi({ uploadCsv: vi.fn(async () => preview) })
    renderApp(api)
    const file = csvFile('subject,priority\nPrinter on fire,high\nInvoice,low\n', 'tickets.csv')
    upload(file)
    expect(await screen.findByRole('heading', { name: 'tickets.csv' })).toBeInTheDocument()
    expect(api.uploadCsv).toHaveBeenCalledWith(file, 'tickets.csv')
    expect(screen.getByText('Uploaded CSV')).toBeInTheDocument()
    expect(screen.getByText(/12 rows · 2 columns · 2\.0 KB/)).toBeInTheDocument()
    const warnings = screen.getByRole('list', { name: 'Things we adjusted while reading the file' })
    expect(within(warnings).getAllByRole('listitem').map((item) => item.textContent)).toEqual(preview.validationWarnings)
    expect(within(screen.getByRole('table')).getByText('Printer on fire')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run Jev on 12 rows' })).toBeDisabled()
    expect(screen.getByText('Write the question Jev should answer for each row.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Score against a column/)).toHaveValue('')
  })

  it('lets you write a question and run on an uploaded dataset', async () => {
    const api = makeApi()
    renderApp(api)
    upload(csvFile('subject,priority\nx,high\ny,low\n', 'tickets.csv'))
    await screen.findByRole('heading', { name: 'tickets.csv' })
    setValue(screen.getByLabelText('Question asked about every row'), 'Is it urgent?')
    setValue(screen.getByLabelText('Label 1 name'), 'Urgent')
    setValue(screen.getByLabelText('Label 2 name'), 'Routine')
    setValue(screen.getByLabelText(/Score against a column/), 'priority')
    fireEvent.click(screen.getByRole('button', { name: 'Run Jev on 12 rows' }))
    await waitFor(() => expect(api.start).toHaveBeenCalled())
    expect(api.start).toHaveBeenCalledWith({ datasetId: 'ds-upload', query: 'Is it urgent?', classes: [{ name: 'Urgent', description: '' }, { name: 'Routine', description: '' }], labelColumn: 'priority' })
  })

  it('shows the server message when the upload is refused and stays on the landing', async () => {
    const api = makeApi({ uploadCsv: vi.fn().mockRejectedValue(new ApiClientError('RATE_LIMITED', 'Too many uploads. Please wait.', 429, true)) })
    renderApp(api)
    upload(csvFile('a,b\n1,2\n'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many uploads. Please wait.')
    expect(screen.getByRole('button', { name: /Try the sample/ })).toBeEnabled()
    expect(screen.getByLabelText('Upload a CSV file')).toBeEnabled()
  })

  it('shows a generic message for an unexpected upload failure', async () => {
    const api = makeApi({ uploadCsv: vi.fn().mockRejectedValue(new TypeError('kaboom')) })
    renderApp(api)
    upload(csvFile('a,b\n1,2\n'))
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not read that file.')
  })

  it('shows progress and blocks the other intake routes while uploading', async () => {
    let finish: (value: DatasetPreview) => void = () => undefined
    const api = makeApi({ uploadCsv: vi.fn(() => new Promise<DatasetPreview>((resolve) => { finish = resolve })) })
    renderApp(api)
    upload(csvFile('a,b\n1,2\n'))
    expect(await screen.findByText('Uploading…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try the sample/ })).toBeDisabled()
    expect(screen.getByLabelText('Upload a CSV file')).toBeDisabled()
    await waitFor(() => expect(api.uploadCsv).toHaveBeenCalled())
    finish(csvPreview())
    await screen.findByRole('heading', { name: 'tickets.csv' })
  })

  it('clears an earlier error when a later attempt works', async () => {
    renderApp(makeApi())
    upload(csvFile('a,b\n'))
    await screen.findByRole('alert')
    upload(csvFile('a,b\n1,2\n'))
    await screen.findByRole('heading', { name: 'tickets.csv' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('URL intake', () => {
  const fill = (value: string) => setValue(screen.getByLabelText('Or paste a public link'), value)

  it('sends the link to api.datasetFromUrl and shows the preview', async () => {
    const api = makeApi()
    renderApp(api)
    expect(screen.getByRole('button', { name: 'Fetch' })).toBeDisabled()
    fill('  https://example.com/data.csv  ')
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    expect(await screen.findByRole('heading', { name: 'remote.csv' })).toBeInTheDocument()
    expect(api.datasetFromUrl).toHaveBeenCalledWith('https://example.com/data.csv')
    expect(screen.getByText('CSV from a link')).toBeInTheDocument()
  })

  it('shows the server error message and stays on the landing', async () => {
    const api = makeApi({ datasetFromUrl: vi.fn().mockRejectedValue(new ApiClientError('URL_NOT_PUBLIC', 'That address is not a public web page.', 400, false)) })
    renderApp(api)
    fill('http://192.168.0.1/data.csv')
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That address is not a public web page.')
    expect(screen.getByRole('button', { name: /Try the sample/ })).toBeInTheDocument()
  })

  it('shows a generic message for an unexpected failure', async () => {
    const api = makeApi({ datasetFromUrl: vi.fn().mockRejectedValue(new TypeError('kaboom')) })
    renderApp(api)
    fill('https://example.com/data.csv')
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not fetch that link.')
  })
})

describe('opening a run by URL', () => {
  it.each(['/run/abc', '/share/abc'])('renders the run page for the id in %s', async (path) => {
    window.history.pushState(null, '', path)
    const api = makeApi({ read: vi.fn(async () => runPage({ analysisId: 'abc' })) })
    renderApp(api)
    expect(await screen.findByRole('heading', { level: 1, name: 'Will they run or pass?' })).toBeInTheDocument()
    expect(api.read).toHaveBeenCalledWith('abc', -1)
    expect(screen.queryByRole('button', { name: /Try the sample/ })).not.toBeInTheDocument()
  })

  it('has no owner controls for a visitor', async () => {
    window.history.pushState(null, '', '/run/abc')
    renderApp(makeApi({ read: vi.fn(async () => runPage({ analysisId: 'abc', status: 'running' })) }))
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('button', { name: /Cancel run/ })).not.toBeInTheDocument()
  })

  it('shows the message and a way to start a new run for an unknown id', async () => {
    window.history.pushState(null, '', '/run/missing')
    const api = makeApi({ read: vi.fn().mockRejectedValue(new ApiClientError('ANALYSIS_NOT_FOUND', 'We could not find that run.', 404, false)) })
    renderApp(api)
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find that run.')
    const link = screen.getByRole('link', { name: 'Start a new run' })
    expect(link).toHaveAttribute('href', '/')
    expect(api.read).toHaveBeenCalledTimes(1)
  })

  it('offers the brand link home from a run page', async () => {
    window.history.pushState(null, '', '/run/abc')
    renderApp(makeApi())
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('link', { name: /Jev Playground/ })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'New run' })).toHaveAttribute('href', '/')
  })
})
