import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError, type PlaygroundApi } from '../api/client'
import type { AnalysisMeta, AnalysisPage, AnalysisStatus, AnalysisViewRow } from '../shared/analysis'
import { rememberControlToken } from '../state/controlTokens'
import { RunPage } from './RunPage'

const NOW = 1_800_000_000_000
const RUN = 'run-1'

const CLASSES = [{ name: 'Run', description: '' }, { name: 'Pass', description: '' }]
const COLUMNS = ['quarter', 'clock', 'play_call']

const pad = (value: number) => String(value).padStart(2, '0')

/** A result row for dataset row `i`: Jev said `predicted` (undefined = failed), the held-out answer is `actual`. */
const row = (i: number, predicted: string | undefined, actual: string, patch: Partial<AnalysisViewRow> = {}): AnalysisViewRow => (predicted === undefined
  ? { rowIndex: i, model: 'm', values: [1 + Math.floor(i / 10), `0:${pad(i % 60)}`, actual], error: { code: 'MODEL_FAILED', retryable: true }, ...patch }
  : { rowIndex: i, model: 'm', selectedClass: predicted, probabilities: predicted === 'Run' ? [0.8, 0.2] : [0.3, 0.7], confidence: predicted === 'Run' ? 0.8 : 0.7, values: [1 + Math.floor(i / 10), `0:${pad(i % 60)}`, actual], ...patch })

const meta = (status: AnalysisStatus, completed: number, total: number, patch: Partial<AnalysisMeta> = {}, failed = 0): AnalysisMeta => ({
  analysisId: RUN,
  datasetId: 'ds',
  datasetName: 'plays.csv',
  sourceType: 'upload',
  query: 'Will the offense run or pass?',
  classes: CLASSES,
  columns: COLUMNS,
  labelColumn: 'play_call',
  status,
  mode: 'live',
  createdAt: NOW - 60_000,
  updatedAt: NOW,
  startedAt: NOW - 30_000,
  progress: { totalRows: total, completedRows: completed, failedRows: failed },
  ...patch,
})

interface PageSpec { rows: AnalysisViewRow[]; analysis: AnalysisMeta; hasMore?: boolean; serverTime?: number }
const pageOf = ({ rows, analysis, hasMore = false, serverTime = NOW }: PageSpec): AnalysisPage => ({
  analysis,
  rows,
  nextAfter: rows.length ? rows[rows.length - 1].rowIndex : -1,
  hasMore,
  serverTime,
})

/** Rows 0..n-1 where Jev picks `predict(i)` and the truth is `actual(i)`. */
const makeRows = (n: number, predict: (i: number) => string | undefined, actual: (i: number) => string): AnalysisViewRow[] => (
  Array.from({ length: n }, (_, i) => row(i, predict(i), actual(i)))
)

const makeApi = (pages: AnalysisPage[]) => {
  let calls = 0
  const read = vi.fn(async (_id: string, _after: number) => pages[Math.min(calls++, pages.length - 1)])
  const cancel = vi.fn(async () => undefined)
  const resume = vi.fn(async () => undefined)
  return { api: { read, cancel, resume } as unknown as PlaygroundApi, read, cancel, resume }
}

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

const renderRun = async (api: PlaygroundApi, { id = RUN, justStarted = true }: { id?: string; justStarted?: boolean } = {}) => {
  const view = render(<RunPage api={api} analysisId={id} justStarted={justStarted} />)
  await flush()
  return view
}

/** A finished 10-row run: 7 right, 3 wrong (rows 1, 4, 8), with truth Run x6 / Pass x4. */
const TRUTH = ['Run', 'Run', 'Pass', 'Run', 'Pass', 'Run', 'Pass', 'Run', 'Pass', 'Run']
const PREDICTED = ['Run', 'Pass', 'Pass', 'Run', 'Run', 'Run', 'Pass', 'Run', 'Run', 'Run']
const finishedRows = () => makeRows(10, (i) => PREDICTED[i], (i) => TRUTH[i])
const finishedPage = (patch: Partial<AnalysisMeta> = {}, rows = finishedRows()) => pageOf({ rows, analysis: meta('complete', rows.length, rows.length, { completedAt: NOW - 5_000, ...patch }) })

const chartRegion = () => screen.getByRole('region', { name: 'Jev’s answers' })
const barLabels = () => within(chartRegion()).getAllByRole('listitem').map((item) => item.querySelector('.bar-label')?.textContent)
const detail = () => screen.getByRole('complementary', { name: 'Row detail' })
const slider = () => screen.getByRole('slider', { name: 'Position in the run' })

beforeEach(() => {
  vi.useFakeTimers()
  window.localStorage.clear()
  vi.stubGlobal('scrollTo', vi.fn())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('RunPage: live progress', () => {
  it('shows the question, "N of M rows", the status pill and updates as pages arrive', async () => {
    const all = makeRows(10, (i) => (i % 2 ? 'Pass' : 'Run'), () => 'Run')
    const { api } = makeApi([
      pageOf({ rows: all.slice(0, 3), analysis: meta('running', 3, 10) }),
      pageOf({ rows: all.slice(3, 6), analysis: meta('running', 6, 10) }),
    ])
    await renderRun(api)
    expect(screen.getByRole('heading', { level: 1, name: 'Will the offense run or pass?' })).toBeInTheDocument()
    expect(screen.getByText('3 of 10 rows')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(within(chartRegion()).getByText('3 classified')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Rows answered' })).toHaveAttribute('aria-valuenow', '3')

    await flush(700)
    expect(screen.getByText('6 of 10 rows')).toBeInTheDocument()
    expect(within(chartRegion()).getByText('6 classified')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Rows answered' })).toHaveAttribute('aria-valuenow', '6')
  })

  it('says it is loading before the first page and settles into the run after', async () => {
    const { api } = makeApi([finishedPage()])
    render(<RunPage api={api} analysisId={RUN} justStarted />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading the run')
    await flush()
    expect(screen.queryByText('Loading the run…')).not.toBeInTheDocument()
  })

  it('sets the page title from the dataset', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    expect(document.title).toBe('plays.csv · Jev Playground')
  })

  it('reports failed rows in the progress line', async () => {
    const rows = makeRows(5, (i) => (i === 2 ? undefined : 'Run'), () => 'Run')
    const { api } = makeApi([pageOf({ rows, analysis: meta('complete', 5, 5, {}, 1) })])
    await renderRun(api)
    expect(screen.getByText(/1 failed · Finished/)).toBeInTheDocument()
  })

  it('shows Reconnecting… when a poll fails but keeps the rows on screen', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(pageOf({ rows: makeRows(3, () => 'Run', () => 'Run'), analysis: meta('running', 3, 10) }))
      .mockRejectedValueOnce(new ApiClientError('NETWORK', 'offline', 0, true))
      .mockResolvedValue(pageOf({ rows: [], analysis: meta('running', 3, 10) }))
    await renderRun({ read } as unknown as PlaygroundApi)
    await flush(700)
    expect(screen.getByText(/Reconnecting…/)).toBeInTheDocument()
    expect(screen.getByText('3 of 10 rows')).toBeInTheDocument()
    await flush(1_000)
    expect(screen.queryByText(/Reconnecting…/)).not.toBeInTheDocument()
  })
})

describe('RunPage: chart', () => {
  it('keeps the bars in the order of analysis.classes whatever the counts are', async () => {
    // Pass wins 8 to 2, so a count-sorted chart would put Pass first.
    const rows = makeRows(10, (i) => (i < 2 ? 'Run' : 'Pass'), () => 'Pass')
    const { api } = makeApi([pageOf({ rows, analysis: meta('complete', 10, 10) })])
    await renderRun(api)
    expect(barLabels()).toEqual(['Run', 'Pass'])
    expect(within(chartRegion()).getByRole('listitem', { name: /^Run:/ })).toHaveTextContent('2')
  })

  it('keeps the order while the counts change as the run streams', async () => {
    const first = makeRows(4, () => 'Run', () => 'Run')
    const more = Array.from({ length: 6 }, (_, k) => row(4 + k, 'Pass', 'Pass'))
    const { api } = makeApi([
      pageOf({ rows: first, analysis: meta('running', 4, 10) }),
      pageOf({ rows: more, analysis: meta('running', 10, 10) }),
    ])
    await renderRun(api)
    expect(barLabels()).toEqual(['Run', 'Pass'])
    await flush(700)
    expect(barLabels()).toEqual(['Run', 'Pass'])
    expect(within(chartRegion()).getByRole('listitem', { name: /^Pass:/ })).toHaveTextContent('6')
  })

  it('tallies the rows up to the playhead when scrubbing back', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    expect(within(chartRegion()).getByText('10 classified')).toBeInTheDocument()
    fireEvent.change(slider(), { target: { value: '2' } })
    expect(within(chartRegion()).getByText('3 classified')).toBeInTheDocument()
  })
})

describe('RunPage: scoreboard', () => {
  it('shows accuracy, the always-guess baseline and the confusion matrix', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    const board = screen.getByRole('region', { name: 'Scored against “play_call”' })
    expect(within(board).getByText('70%')).toBeInTheDocument()
    expect(within(board).getByText('7 of 10 rows')).toBeInTheDocument()
    // Truth is Run x6, so always guessing Run scores 60% and Jev is 10 points ahead.
    expect(within(board).getByText('Always guessing “Run”')).toBeInTheDocument()
    expect(within(board).getByText('60%')).toBeInTheDocument()
    expect(within(board).getByText('Jev is 10 points ahead')).toBeInTheDocument()

    const matrix = within(board).getByRole('table')
    expect(within(matrix).getByRole('columnheader', { name: 'Jev: Run' })).toBeInTheDocument()
    const cellsOf = (name: string) => within(within(matrix).getByRole('row', { name: new RegExp(`^Was ${name}`) })).getAllByRole('cell').map((cell) => cell.textContent)
    // truth Run: Jev said Run 5 times, Pass once. truth Pass: Jev said Run twice, Pass twice.
    expect(cellsOf('Run')).toEqual(['5', '1'])
    expect(cellsOf('Pass')).toEqual(['2', '2'])
  })

  it('recomputes the score for the rows up to the playhead', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    fireEvent.change(slider(), { target: { value: '0' } })
    const board = screen.getByRole('region', { name: 'Scored against “play_call”' })
    expect(within(board).getByText('1 of 1 rows')).toBeInTheDocument()
    expect(within(board).getAllByText('100%').length).toBeGreaterThan(0)
  })

  it('has no scoreboard without a label column', async () => {
    const rows = makeRows(10, () => 'Run', () => 'Run')
    const { api } = makeApi([pageOf({ rows, analysis: meta('complete', 10, 10, { labelColumn: undefined }) })])
    await renderRun(api)
    expect(screen.queryByRole('region', { name: /Scored against/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Always guessing/)).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Actual' })).not.toBeInTheDocument()
    expect(chartRegion()).toBeInTheDocument()
  })

  it('explains rows whose held-out value is not one of the labels', async () => {
    const rows = [row(0, 'Run', 'Run'), row(1, 'Run', 'Kick')]
    const { api } = makeApi([pageOf({ rows, analysis: meta('complete', 2, 2) })])
    await renderRun(api)
    expect(screen.getByText(/1 rows have an answer that is not one of the labels/)).toBeInTheDocument()
  })
})

describe('RunPage: row detail', () => {
  it('shows the playhead row: values, answer, confidence, per-label probabilities and verdict', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    fireEvent.change(slider(), { target: { value: '1' } }) // row 2: Jev said Pass, truth Run
    const panel = within(detail())
    expect(panel.getByRole('heading', { name: 'Row 2' })).toBeInTheDocument()
    expect(panel.getByText('Pass', { selector: 'b' })).toBeInTheDocument()
    expect(panel.getByText('70% confident')).toBeInTheDocument()
    const probabilities = panel.getByRole('list', { name: 'Probability per label' })
    expect(within(probabilities).getByText('Run').parentElement).toHaveTextContent('30%')
    expect(within(probabilities).getByText('Pass').parentElement).toHaveTextContent('70%')
    expect(panel.getByText('Was Run')).toBeInTheDocument()

    fireEvent.change(slider(), { target: { value: '0' } }) // row 1: right
    expect(within(detail()).getByText('Correct')).toBeInTheDocument()
  })

  it('lists the input values under "What Jev saw" and the held-out value under its own heading', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    fireEvent.change(slider(), { target: { value: '3' } })
    const panel = within(detail())
    const sawList = panel.getByRole('heading', { name: 'What Jev saw' }).nextElementSibling as HTMLElement
    expect(within(sawList).getByText('quarter')).toBeInTheDocument()
    expect(within(sawList).getByText('clock')).toBeInTheDocument()
    expect(within(sawList).getByText('0:03')).toBeInTheDocument()
    expect(within(sawList).queryByText('play_call')).not.toBeInTheDocument()
    expect(within(sawList).queryByText('Run')).not.toBeInTheDocument()

    const held = panel.getByRole('heading', { name: 'Held out' }).nextElementSibling as HTMLElement
    expect(within(held).getByText('play_call')).toBeInTheDocument()
    expect(within(held).getByText('Run')).toBeInTheDocument()
  })

  it('has no "Held out" section without a label column', async () => {
    const rows = makeRows(3, () => 'Run', () => 'Run')
    const { api } = makeApi([pageOf({ rows, analysis: meta('complete', 3, 3, { labelColumn: undefined }) })])
    await renderRun(api)
    expect(within(detail()).queryByRole('heading', { name: 'Held out' })).not.toBeInTheDocument()
    expect(within(detail()).getByText('play_call')).toBeInTheDocument()
  })

  it('invites you to wait before the first row exists', async () => {
    const { api } = makeApi([pageOf({ rows: [], analysis: meta('queued', 0, 10) })])
    await renderRun(api)
    expect(within(detail()).getByText('Each row appears here as Jev answers it.')).toBeInTheDocument()
    expect(screen.getByText('Rows appear here as Jev answers them.')).toBeInTheDocument()
    expect(screen.getByText('No rows yet', { selector: '.timeline-readout' })).toBeInTheDocument()
  })
})

describe('RunPage: failed rows', () => {
  const failedRows = () => makeRows(6, (i) => (i === 3 ? undefined : 'Run'), () => 'Run')
  const failedPage = () => pageOf({ rows: failedRows(), analysis: meta('complete', 6, 6, {}, 1) })

  it('shows the error code in the detail and "Failed" in the table', async () => {
    const { api } = makeApi([failedPage()])
    await renderRun(api)
    const results = screen.getByRole('region', { name: 'Results' })
    expect(within(results).getByText('Failed')).toBeInTheDocument()
    fireEvent.click(within(results).getByRole('button', { name: 'Inspect row 4' }))
    expect(within(detail()).getByRole('heading', { name: 'Row 4' })).toBeInTheDocument()
    expect(within(detail()).getByText('MODEL_FAILED')).toBeInTheDocument()
    expect(within(detail()).getByText(/Jev could not answer this row/)).toBeInTheDocument()
  })

  it('offers a Failed filter that shows only failed rows', async () => {
    const { api } = makeApi([failedPage()])
    await renderRun(api)
    const results = screen.getByRole('region', { name: 'Results' })
    expect(within(results).getAllByRole('button', { name: /^Inspect row/ })).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: 'Failed 1' }))
    expect(screen.getByRole('button', { name: 'Failed 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(results).getAllByRole('button', { name: /^Inspect row/ })).toHaveLength(1)
    expect(within(results).getByRole('button', { name: 'Inspect row 4' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(within(results).getAllByRole('button', { name: /^Inspect row/ })).toHaveLength(6)
  })

  it('has no Failed chip when nothing failed', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    expect(screen.queryByRole('button', { name: /^Failed/ })).not.toBeInTheDocument()
  })
})

describe('RunPage: misses filter and row selection', () => {
  it('shows only wrong rows under Misses', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    const results = screen.getByRole('region', { name: 'Results' })
    fireEvent.click(screen.getByRole('button', { name: 'Misses 3' }))
    const shown = within(results).getAllByRole('button', { name: /^Inspect row/ }).map((button) => button.textContent)
    expect(shown).toEqual(['2', '5', '9'])
  })

  it('moves the playhead to the clicked row, unfiltered', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    const results = screen.getByRole('region', { name: 'Results' })
    fireEvent.click(within(results).getByRole('button', { name: 'Inspect row 6' }))
    expect(within(detail()).getByRole('heading', { name: 'Row 6' })).toBeInTheDocument()
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 6 of 10')
    expect(within(chartRegion()).getByText('6 classified')).toBeInTheDocument()
  })

  it('moves the playhead to THAT row while a filter is on (button and whole-row click)', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    const results = screen.getByRole('region', { name: 'Results' })
    fireEvent.click(screen.getByRole('button', { name: 'Misses 3' }))

    fireEvent.click(within(results).getByRole('button', { name: 'Inspect row 9' }))
    expect(within(detail()).getByRole('heading', { name: 'Row 9' })).toBeInTheDocument()
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 9 of 10')

    const rowTwo = within(results).getByRole('button', { name: 'Inspect row 2' }).closest('tr') as HTMLElement
    fireEvent.click(rowTwo)
    expect(within(detail()).getByRole('heading', { name: 'Row 2' })).toBeInTheDocument()
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 2 of 10')
    // Still filtered.
    expect(within(results).getAllByRole('button', { name: /^Inspect row/ })).toHaveLength(3)
  })

  it('marks right and wrong answers in the Actual column', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    const results = screen.getByRole('region', { name: 'Results' })
    expect(within(results).getByRole('columnheader', { name: 'Actual' })).toBeInTheDocument()
    const wrongRow = within(results).getByRole('button', { name: 'Inspect row 2' }).closest('tr') as HTMLElement
    expect(wrongRow.querySelector('.is-wrong')).not.toBeNull()
    const rightRow = within(results).getByRole('button', { name: 'Inspect row 1' }).closest('tr') as HTMLElement
    expect(rightRow.querySelector('.is-right')).not.toBeNull()
  })
})

describe('RunPage: timeline', () => {
  it('has an accessible name and a "Row N of M" value text, and is not inside an image role', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 10 of 10')
    expect(slider().closest('[role="img"]')).toBeNull()
    expect(screen.getByRole('group', { name: 'Replay controls' })).toContainElement(slider())
  })

  it('updates the chart and the detail when moved', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    fireEvent.change(slider(), { target: { value: '2' } })
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 3 of 10')
    expect(within(chartRegion()).getByText('3 classified')).toBeInTheDocument()
    expect(within(detail()).getByRole('heading', { name: 'Row 3' })).toBeInTheDocument()
  })

  it('uses the whole run size as the total while rows are still arriving', async () => {
    const { api } = makeApi([pageOf({ rows: makeRows(4, () => 'Run', () => 'Run'), analysis: meta('running', 4, 20) })])
    await renderRun(api)
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 4 of 20')
  })

  it('offers "Jump to live" only when scrubbed back during a live run', async () => {
    const all = makeRows(10, () => 'Run', () => 'Run')
    const { api } = makeApi([
      pageOf({ rows: all.slice(0, 5), analysis: meta('running', 5, 10) }),
      pageOf({ rows: all.slice(5, 8), analysis: meta('running', 8, 10) }),
    ])
    await renderRun(api)
    expect(screen.queryByRole('button', { name: 'Jump to live' })).not.toBeInTheDocument()
    fireEvent.change(slider(), { target: { value: '1' } })
    expect(screen.getByRole('button', { name: 'Jump to live' })).toBeInTheDocument()

    // Scrubbed back: new rows do not drag the playhead along.
    await flush(700)
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 2 of 10')
    fireEvent.click(screen.getByRole('button', { name: 'Jump to live' }))
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 8 of 10')
    expect(screen.queryByRole('button', { name: 'Jump to live' })).not.toBeInTheDocument()
  })

  it('does not offer "Jump to live" on a finished run', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    fireEvent.change(slider(), { target: { value: '1' } })
    expect(screen.queryByRole('button', { name: 'Jump to live' })).not.toBeInTheDocument()
  })

  it('follows the newest row while live and stops following at the end of a replay', async () => {
    const all = makeRows(6, () => 'Run', () => 'Run')
    const { api } = makeApi([
      pageOf({ rows: all.slice(0, 2), analysis: meta('running', 2, 6) }),
      pageOf({ rows: all.slice(2, 5), analysis: meta('running', 5, 6) }),
    ])
    await renderRun(api)
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 2 of 6')
    await flush(700)
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 5 of 6')
  })
})

describe('RunPage: owner controls', () => {
  const livePage = () => pageOf({ rows: makeRows(3, () => 'Run', () => 'Run'), analysis: meta('running', 3, 10) })

  it('shows Cancel only for the owner of a live run', async () => {
    rememberControlToken(RUN, 'secret')
    const { api } = makeApi([livePage()])
    await renderRun(api)
    expect(screen.getByRole('button', { name: /Cancel run/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Resume run/ })).not.toBeInTheDocument()
  })

  it('shows neither Cancel nor Resume to a visitor without the token', async () => {
    for (const status of ['running', 'error'] as const) {
      const { api } = makeApi([pageOf({ rows: makeRows(3, () => 'Run', () => 'Run'), analysis: meta(status, 3, 10) })])
      const view = await renderRun(api)
      expect(screen.queryByRole('button', { name: /Cancel run/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Resume run/ })).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('ignores a token that belongs to a different run', async () => {
    rememberControlToken('some-other-run', 'secret')
    const { api } = makeApi([livePage()])
    await renderRun(api)
    expect(screen.queryByRole('button', { name: /Cancel run/ })).not.toBeInTheDocument()
  })

  it('does not show Cancel for the owner of a finished run', async () => {
    rememberControlToken(RUN, 'secret')
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    expect(screen.queryByRole('button', { name: /Cancel run/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Resume run/ })).not.toBeInTheDocument()
  })

  it('cancels with the stored token and then refreshes the run', async () => {
    rememberControlToken(RUN, 'secret')
    const { api, read, cancel } = makeApi([livePage(), pageOf({ rows: [], analysis: meta('cancelled', 3, 10) })])
    await renderRun(api)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Cancel run/ })) })
    expect(cancel).toHaveBeenCalledWith(RUN, 'secret')
    await flush()
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.getByText(/Cancelled after 3 of 10 rows/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancel run/ })).not.toBeInTheDocument()
  })

  it('disables the button while the request is in flight', async () => {
    rememberControlToken(RUN, 'secret')
    const { api, cancel } = makeApi([livePage()])
    let finish: () => void = () => undefined
    cancel.mockImplementation(() => new Promise<undefined>((resolve) => { finish = () => resolve(undefined) }))
    await renderRun(api)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Cancel run/ })) })
    expect(screen.getByRole('button', { name: /Cancelling…/ })).toBeDisabled()
    await act(async () => { finish() })
    expect(screen.getByRole('button', { name: /Cancel run/ })).toBeEnabled()
  })

  it('shows the server message when cancelling fails', async () => {
    rememberControlToken(RUN, 'secret')
    const { api, cancel } = makeApi([livePage()])
    cancel.mockRejectedValue(new ApiClientError('FORBIDDEN', 'That control token is not valid.', 403, false))
    await renderRun(api)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Cancel run/ })) })
    expect(screen.getByRole('alert')).toHaveTextContent('That control token is not valid.')
    expect(screen.getByRole('button', { name: /Cancel run/ })).toBeEnabled()
  })

  it('shows a generic message when cancelling fails unexpectedly', async () => {
    rememberControlToken(RUN, 'secret')
    const { api, cancel } = makeApi([livePage()])
    cancel.mockRejectedValue(new TypeError('boom'))
    await renderRun(api)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Cancel run/ })) })
    expect(screen.getByRole('alert')).toHaveTextContent('That did not work. Please try again.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('boom')
  })

  it('offers Resume to the owner when the run stopped with an error, and calls api.resume', async () => {
    rememberControlToken(RUN, 'secret')
    const { api, read, resume } = makeApi([
      pageOf({ rows: makeRows(3, () => 'Run', () => 'Run'), analysis: meta('error', 3, 10) }),
      pageOf({ rows: [], analysis: meta('running', 3, 10) }),
    ])
    await renderRun(api)
    expect(screen.getByText(/Stopped after 3 of 10 rows/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancel run/ })).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Resume run/ })) })
    expect(resume).toHaveBeenCalledWith(RUN, 'secret')
    await flush()
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Resume run/ })).not.toBeInTheDocument()
  })

  it('offers Resume to the owner when the feed is stalled', async () => {
    rememberControlToken(RUN, 'secret')
    const { api, resume } = makeApi([pageOf({ rows: makeRows(3, () => 'Run', () => 'Run'), analysis: meta('running', 3, 10), serverTime: NOW + 120_000 })])
    await renderRun(api)
    expect(screen.getByText('Stalled')).toBeInTheDocument()
    expect(screen.getByText(/gone quiet/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Resume run/ })) })
    expect(resume).toHaveBeenCalledWith(RUN, 'secret')
  })

  it('does not offer Resume to a visitor on a stalled run, but still explains it', async () => {
    const { api } = makeApi([pageOf({ rows: makeRows(3, () => 'Run', () => 'Run'), analysis: meta('running', 3, 10), serverTime: NOW + 120_000 })])
    await renderRun(api)
    expect(screen.getByText('Stalled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Resume run/ })).not.toBeInTheDocument()
  })
})

describe('RunPage: copy link', () => {
  const link = () => screen.getByRole('button', { name: /Copy link/ })

  it('copies <origin>/run/<id>', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    await act(async () => { fireEvent.click(link()) })
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/run/${RUN}`)
    expect(screen.getByText('Link copied')).toBeInTheDocument()
  })

  it('encodes unusual ids in the copied link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { api } = makeApi([finishedPage()])
    await renderRun(api, { id: 'a b/c' })
    await act(async () => { fireEvent.click(link()) })
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/run/a%20b%2Fc`)
  })

  it('does NOT claim "Link copied" when the clipboard is unavailable; it shows the URL to copy by hand', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    await act(async () => { fireEvent.click(link()) })
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument()
    expect(screen.getByText(`Copy this link: ${window.location.origin}/run/${RUN}`)).toBeInTheDocument()
  })

  it('does NOT claim "Link copied" when writing to the clipboard is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) }, configurable: true })
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    await act(async () => { fireEvent.click(link()) })
    expect(screen.queryByText('Link copied')).not.toBeInTheDocument()
    expect(screen.getByText(/Copy this link: .*\/run\/run-1/)).toBeInTheDocument()
  })
})

describe('RunPage: download', () => {
  const download = () => screen.getByRole('button', { name: /Download CSV/ })

  it('is disabled until rows are loaded', async () => {
    const { api } = makeApi([pageOf({ rows: [], analysis: meta('queued', 0, 10) })])
    await renderRun(api)
    expect(download()).toBeDisabled()
  })

  it('is disabled while more rows are still being fetched, and enabled once caught up', async () => {
    const all = makeRows(10, () => 'Run', () => 'Run')
    const read = vi.fn()
    // Hold the second page back so the "still fetching" state is observable.
    let release: () => void = () => undefined
    read.mockResolvedValueOnce(pageOf({ rows: all.slice(0, 5), analysis: meta('running', 10, 10), hasMore: true }))
    read.mockImplementationOnce(() => new Promise<AnalysisPage>((resolve) => { release = () => resolve(pageOf({ rows: all.slice(5), analysis: meta('complete', 10, 10) })) }))
    await renderRun({ read } as unknown as PlaygroundApi)
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 5 of 10')
    expect(download()).toBeDisabled()
    await act(async () => { release() })
    expect(download()).toBeEnabled()
  })

  it('downloads a file named after the dataset', async () => {
    const createObjectURL = vi.fn(() => 'blob:csv')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { clicked.push(this) })
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    fireEvent.click(download())
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob
    expect(blob.type).toContain('text/csv')
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('plays-jev-results.csv')
    expect(clicked[0].href).toBe('blob:csv')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv')
  })
})

describe('RunPage: virtualised table', () => {
  it('mounts far fewer than 1,000 rows for a 1,000-row run', async () => {
    const rows = makeRows(1_000, (i) => (i % 3 ? 'Run' : 'Pass'), () => 'Run')
    const { api } = makeApi([pageOf({ rows, analysis: meta('complete', 1_000, 1_000) })])
    await renderRun(api)
    const results = screen.getByRole('region', { name: 'Results' })
    const mounted = within(results).getAllByRole('button', { name: /^Inspect row/ }).length
    expect(mounted).toBeGreaterThan(5)
    expect(mounted).toBeLessThan(100)
    expect(within(results).getByRole('table')).toHaveAttribute('aria-rowcount', '1001')
    expect(screen.getByText('1,000 of 1,000 answered. Select a row to inspect it.')).toBeInTheDocument()
  })

  it('mounts a different slice when the table is scrolled', async () => {
    const rows = makeRows(1_000, () => 'Run', () => 'Run')
    const { api } = makeApi([pageOf({ rows, analysis: meta('complete', 1_000, 1_000) })])
    await renderRun(api)
    const results = screen.getByRole('region', { name: 'Results' })
    expect(within(results).queryByRole('button', { name: 'Inspect row 500' })).not.toBeInTheDocument()
    fireEvent.scroll(results, { target: { scrollTop: 499 * 36 } })
    expect(within(results).getByRole('button', { name: 'Inspect row 500' })).toBeInTheDocument()
    expect(within(results).queryByRole('button', { name: 'Inspect row 1' })).not.toBeInTheDocument()
  })
})

describe('RunPage: automatic replay', () => {
  const stubMotion = (reduce: boolean) => vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: reduce && query.includes('prefers-reduced-motion'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })))

  it('replays a finished run opened fresh', async () => {
    stubMotion(false)
    const { api } = makeApi([finishedPage()])
    await renderRun(api, { justStarted: false })
    expect(screen.getByRole('button', { name: 'Pause replay' })).toBeInTheDocument()
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 1 of 10')
  })

  it('finishes the replay, lands on the last row and does not start a second one', async () => {
    stubMotion(false)
    const { api } = makeApi([finishedPage()])
    await renderRun(api, { justStarted: false })
    await flush(15_000)
    expect(screen.getByRole('button', { name: 'Replay the run' })).toBeInTheDocument()
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 10 of 10')
    await flush(15_000)
    expect(screen.getByRole('button', { name: 'Replay the run' })).toBeInTheDocument()
  })

  it('does not replay when the user prefers reduced motion', async () => {
    stubMotion(true)
    const { api } = makeApi([finishedPage()])
    await renderRun(api, { justStarted: false })
    expect(screen.getByRole('button', { name: 'Replay the run' })).toBeInTheDocument()
    expect(slider()).toHaveAttribute('aria-valuetext', 'Row 10 of 10')
    await flush(15_000)
    expect(screen.getByRole('button', { name: 'Replay the run' })).toBeInTheDocument()
  })

  it('does not replay a run the viewer just started', async () => {
    stubMotion(false)
    const { api } = makeApi([finishedPage()])
    await renderRun(api, { justStarted: true })
    expect(screen.getByRole('button', { name: 'Replay the run' })).toBeInTheDocument()
  })

  it('does not replay a run that is still live', async () => {
    stubMotion(false)
    const { api } = makeApi([pageOf({ rows: makeRows(5, () => 'Run', () => 'Run'), analysis: meta('running', 5, 10) })])
    await renderRun(api, { justStarted: false })
    expect(screen.getByRole('button', { name: 'Replay the run' })).toBeInTheDocument()
  })

  it('does not replay a finished run with a single row', async () => {
    stubMotion(false)
    const { api } = makeApi([pageOf({ rows: makeRows(1, () => 'Run', () => 'Run'), analysis: meta('complete', 1, 1) })])
    await renderRun(api, { justStarted: false })
    expect(screen.getByRole('button', { name: 'Replay the run' })).toBeDisabled()
  })

  it('can be paused, and replayed again by hand', async () => {
    stubMotion(false)
    const { api } = makeApi([finishedPage()])
    await renderRun(api, { justStarted: false })
    fireEvent.click(screen.getByRole('button', { name: 'Pause replay' }))
    expect(screen.getByRole('button', { name: 'Replay the run' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Replay the run' }))
    expect(screen.getByRole('button', { name: 'Pause replay' })).toBeInTheDocument()
  })
})

describe('RunPage: simulated runs', () => {
  it('shows the Simulated pill and the explanatory note for a mock analysis', async () => {
    const { api } = makeApi([finishedPage({ mode: 'mock' })])
    await renderRun(api)
    expect(screen.getByText('Simulated')).toBeInTheDocument()
    expect(screen.getByText(/Simulated run: these answers come from a built-in stand-in/)).toBeInTheDocument()
  })

  it('shows neither for a live-model analysis', async () => {
    const { api } = makeApi([finishedPage()])
    await renderRun(api)
    expect(screen.queryByText('Simulated')).not.toBeInTheDocument()
    expect(screen.queryByText(/Simulated run/)).not.toBeInTheDocument()
  })
})

describe('RunPage: unknown run', () => {
  it('shows the server message and a way to start a new run', async () => {
    const read = vi.fn().mockRejectedValue(new ApiClientError('ANALYSIS_NOT_FOUND', 'We could not find that run.', 404, false))
    await renderRun({ read } as unknown as PlaygroundApi, { id: 'nope' })
    expect(screen.getByRole('alert')).toHaveTextContent('We could not find that run.')
    expect(screen.getByRole('link', { name: 'Start a new run' })).toHaveAttribute('href', '/')
    await flush(30_000)
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('RunPage: never hijacks page scroll', () => {
  it('does not call scrollIntoView or window.scrollTo while rows stream in', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    const all = makeRows(200, (i) => (i % 2 ? 'Pass' : 'Run'), () => 'Run')
    const pages = Array.from({ length: 10 }, (_, k) => pageOf({ rows: all.slice(k * 20, (k + 1) * 20), analysis: meta(k === 9 ? 'complete' : 'running', (k + 1) * 20, 200) }))
    const { api } = makeApi(pages)
    try {
      await renderRun(api)
      for (let step = 0; step < 12; step += 1) await flush(700)
      expect(screen.getByText('200 of 200 rows')).toBeInTheDocument()
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(scrollTo).not.toHaveBeenCalled()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('does not call them during an automatic replay either', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const rows = makeRows(300, (i) => (i % 2 ? 'Pass' : 'Run'), () => 'Run')
    const { api } = makeApi([pageOf({ rows, analysis: meta('complete', 300, 300) })])
    try {
      await renderRun(api, { justStarted: false })
      expect(screen.getByRole('button', { name: 'Pause replay' })).toBeInTheDocument()
      await flush(15_000)
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(scrollTo).not.toHaveBeenCalled()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})
