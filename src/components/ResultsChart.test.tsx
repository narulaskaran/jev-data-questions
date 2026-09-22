import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResultsChart } from './ResultsChart'
import { AnalysisRunView } from './AnalysisRunView'
import { PLAYBACK_INTERVAL_MS, useRunPlayhead } from '../runView/playhead'
import type { AnalysisResultRow, AnalysisSnapshot } from '../shared/analysis'
import { getSquirrelModelInput } from '../fixtures/squirrelCensus'
import { placeCountLabel, projectPlaces } from '../runView/places'

const row = (rowIndex: number, selectedClass: string): AnalysisResultRow => ({
  rowIndex,
  input: { message: 'hello' },
  model: 'jev',
  selectedClass,
})

const NoulHarness = ({ rows, totalRows }: { rows: readonly AnalysisResultRow[]; totalRows: number }) => {
  const { index, motion, seek } = useRunPlayhead(rows.length, 'noul-run')
  return (
    <ResultsChart
      rows={rows}
      playheadIndex={index}
      totalRows={totalRows}
      motion={motion}
      questionKind="noul"
      onSeek={seek}
    />
  )
}

const ChartHarness = ({ rows, totalRows = 10 }: { rows: readonly AnalysisResultRow[]; totalRows?: number }) => {
  const { index, motion, seek } = useRunPlayhead(rows.length, 'run-1')
  return (
    <ResultsChart
      rows={rows}
      playheadIndex={index}
      classes={['gold', 'silver']}
      totalRows={totalRows}
      motion={motion}
      onSeek={seek}
    />
  )
}

describe('ResultsChart motion', () => {
  it('keeps axes and waiting copy before the first persisted row', () => {
    render(
      <ResultsChart
        rows={[]}
        playheadIndex={0}
        classes={['gold', 'silver']}
        totalRows={12}
        onSeek={vi.fn()}
      />,
    )
    expect(screen.getByText('Waiting for the first row…')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /waiting for the first row/i })).toBeInTheDocument()
    expect(document.querySelector('.chart-y-axis')).toBeTruthy()
    expect(document.querySelector('.chart-x-axis')).toBeTruthy()
    expect(screen.getByRole('slider', { name: /chart playhead/i })).toBeDisabled()
  })

  it('keeps class tracks mounted and only grows the changed series', () => {
    const classes = ['gold', 'silver']
    const { rerender } = render(
      <ResultsChart rows={[]} playheadIndex={0} classes={classes} totalRows={10} motion="tick" onSeek={vi.fn()} />,
    )
    const gold = document.querySelector('[data-class="gold"]')
    const silver = document.querySelector('[data-class="silver"]')
    const goldBar = gold?.querySelector('.distribution-track span') as HTMLElement | null
    const silverBar = silver?.querySelector('.distribution-track span') as HTMLElement | null
    const silverWidth = silverBar?.style.getPropertyValue('--bar-width')
    expect(gold).toBeTruthy()
    expect(silverWidth).toBe('0%')

    rerender(
      <ResultsChart rows={[row(0, 'gold')]} playheadIndex={0} classes={classes} totalRows={10} motion="tick" onSeek={vi.fn()} />,
    )
    expect(document.querySelector('[data-class="gold"]')).toBe(gold)
    expect(document.querySelector('[data-class="silver"]')).toBe(silver)
    expect(gold).toHaveAttribute('data-count', '1')
    expect(silver).toHaveAttribute('data-count', '0')
    expect(silverBar?.style.getPropertyValue('--bar-width')).toBe(silverWidth)
    expect(goldBar?.style.getPropertyValue('--bar-width')).toBe('10%')

    rerender(
      <ResultsChart
        rows={[row(0, 'gold'), row(1, 'gold')]}
        playheadIndex={1}
        classes={classes}
        totalRows={10}
        motion="tick"
        onSeek={vi.fn()}
      />,
    )
    expect(document.querySelector('[data-class="silver"]')).toBe(silver)
    expect(document.querySelector('[data-class="gold"]')).toHaveAttribute('data-count', '2')
    expect(silverBar?.style.getPropertyValue('--bar-width')).toBe('0%')
    expect(goldBar?.style.getPropertyValue('--bar-width')).toBe('20%')
  })

  it('renders a live P(win) series for Noul and class bars only for Choice', () => {
    const noulRows = [
      { rowIndex: 0, input: { wpa: 0.9 }, model: 'jev', value: 0.2, questionKind: 'noul' as const },
      { rowIndex: 1, input: { wpa: 0.1 }, model: 'jev', value: 0.8, questionKind: 'noul' as const },
    ]
    const { rerender } = render(
      <ResultsChart rows={noulRows} playheadIndex={1} totalRows={10} questionKind="noul" onSeek={vi.fn()} />,
    )
    expect(screen.getByRole('img', { name: /win probability over play index/i })).toBeInTheDocument()
    expect(document.querySelector('[data-chart-kind="series"]')).toBeTruthy()
    expect(document.querySelector('[data-series-points="2"]')).toBeTruthy()
    expect(document.querySelector('[data-series-extent]')).toBeTruthy()
    expect(Number(document.querySelector('[data-series-extent]')?.getAttribute('data-series-extent'))).toBeGreaterThan(0)
    expect(document.querySelector('[data-play-cursor="true"]')).toBeTruthy()
    expect(document.querySelector('[data-class="K.Walker"]')).toBeNull()
    expect(document.querySelector('.series-line')).toBeTruthy()
    expect(document.querySelector('.series-fill')).toBeTruthy()

    rerender(
      <ResultsChart
        rows={[row(0, 'gold'), row(1, 'silver')]}
        playheadIndex={1}
        classes={['gold', 'silver']}
        totalRows={10}
        questionKind="choice"
        onSeek={vi.fn()}
      />,
    )
    expect(screen.getByRole('img', { name: /class distribution/i })).toBeInTheDocument()
    expect(document.querySelector('[data-chart-kind="bars"]')).toBeTruthy()
    expect(document.querySelector('[data-class="gold"]')).toHaveAttribute('data-count', '1')
    expect(document.querySelector('.series-line')).toBeNull()
  })

  it('renders a places map for eating locations instead of Location vs Activity bars', () => {
    const rows = [
      { rowIndex: 0, input: { x: -73.97, y: 40.78, location: 'Ground Plane', eating: true }, model: 'jev', questionKind: 'noul' as const, value: 0.9 },
      { rowIndex: 1, input: { x: -73.96, y: 40.79, location: 'Above Ground', eating: false }, model: 'jev', questionKind: 'noul' as const, value: 0.05 },
    ]
    render(
      <ResultsChart
        rows={rows}
        playheadIndex={1}
        totalRows={2}
        questionKind="noul"
        chartKind="places"
        onSeek={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Places' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /map of where they are eating/i })).toBeInTheDocument()
    expect(document.querySelector('[data-chart-kind="places"]')).toBeTruthy()
    expect(document.querySelector('[data-place-points="2"]')).toBeTruthy()
    expect(document.querySelector('[data-place-labels="0"]')).toBeTruthy()
    expect(document.querySelectorAll('.place-pin')).toHaveLength(0)
    expect(document.querySelectorAll('[data-place-label]')).toHaveLength(0)
    expect(screen.queryByText('On the ground · 1 eating')).not.toBeInTheDocument()
    expect(screen.queryByText('In the trees · 0 eating')).not.toBeInTheDocument()
    expect(screen.getByText('Each dot is a sighting')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: /eating map legend/i })).toBeInTheDocument()
    expect(screen.getByText('Eating · 1')).toBeInTheDocument()
    expect(screen.getByText('Not eating · 1')).toBeInTheDocument()
    expect(document.querySelector('[data-class="Location"]')).toBeNull()
    expect(screen.queryByRole('slider', { name: /chart playhead/i })).not.toBeInTheDocument()
  })

  it('ranks places by eating count instead of a P(moving) series', () => {
    const rows = [
      { rowIndex: 0, input: { x: -73.97, y: 40.78, location: 'Ground Plane', eating: true }, model: 'jev', questionKind: 'noul' as const, value: 0.9 },
      { rowIndex: 1, input: { x: -73.96, y: 40.79, location: 'Above Ground', eating: false }, model: 'jev', questionKind: 'noul' as const, value: 0.05 },
      { rowIndex: 2, input: { x: -73.975, y: 40.782, location: 'Ground Plane', eating: true }, model: 'jev', questionKind: 'noul' as const, value: 0.8 },
    ]
    render(
      <ResultsChart
        rows={rows}
        playheadIndex={2}
        totalRows={3}
        questionKind="noul"
        chartKind="bars"
        rankPlaces
        heading="Which places have the most eating?"
        onSeek={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Which places have the most eating?' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /eating count by place/i })).toBeInTheDocument()
    expect(screen.getByText('Eating count')).toBeInTheDocument()
    expect(document.querySelector('[data-rank-kind="eating"]')).toBeTruthy()
    expect(document.querySelector('[data-class="On the ground"]')).toHaveAttribute('data-count', '2')
    expect(document.querySelector('[data-class="In the trees"]')).toHaveAttribute('data-count', '0')
    expect(document.querySelector('[data-rank-end-label="On the ground · 2"]')).toBeTruthy()
    expect(document.querySelector('[data-rank-end-label="In the trees · 0"]')).toBeTruthy()
    expect(screen.getByText('On the ground · 2')).toBeInTheDocument()
    expect(screen.getByText('In the trees · 0')).toBeInTheDocument()
    expect(document.querySelector('[data-class="Location"]')).toBeNull()
    expect(screen.queryByRole('slider', { name: /chart playhead/i })).not.toBeInTheDocument()
  })

  it('shows every ranked eating end label, including the last place · count', () => {
    const rows = getSquirrelModelInput().map((input, rowIndex) => ({
      rowIndex,
      input,
      model: 'jev',
      questionKind: 'noul' as const,
      value: input.eating ? 0.9 : 0.1,
    }))
    const ranks = projectPlaces(rows).ranks
    expect(ranks.length).toBeGreaterThan(2)
    render(
      <ResultsChart
        rows={rows}
        playheadIndex={rows.length - 1}
        totalRows={rows.length}
        questionKind="noul"
        chartKind="bars"
        rankPlaces
        heading="Which places have the most eating?"
        onSeek={vi.fn()}
      />,
    )
    const last = ranks[ranks.length - 1]!
    expect(screen.getByText(placeCountLabel(last.name, last.eating))).toBeInTheDocument()
    expect(document.querySelectorAll('[data-rank-end-label]')).toHaveLength(ranks.length)
    for (const rank of ranks) {
      expect(document.querySelector(`[data-rank-end-label="${placeCountLabel(rank.name, rank.eating)}"]`)).toBeTruthy()
    }
  })

  it('renders zero pin labels on the eating map', () => {
    const rows = getSquirrelModelInput().map((input, rowIndex) => ({
      rowIndex,
      input,
      model: 'jev',
      questionKind: 'noul' as const,
      value: input.eating ? 0.9 : 0.1,
    }))
    render(
      <ResultsChart
        rows={rows}
        playheadIndex={rows.length - 1}
        totalRows={rows.length}
        questionKind="noul"
        chartKind="places"
        onSeek={vi.fn()}
      />,
    )
    expect(document.querySelector('[data-place-points]')).toBeTruthy()
    expect(document.querySelectorAll('.place-dot').length).toBe(rows.length)
    expect(document.querySelector('[data-place-labels="0"]')).toBeTruthy()
    expect(document.querySelectorAll('.place-pin')).toHaveLength(0)
    expect(document.querySelectorAll('[data-place-label]')).toHaveLength(0)
    expect(document.querySelector('.place-labels')).toBeNull()
    expect(screen.getByRole('list', { name: /eating map legend/i })).toBeInTheDocument()
  })

  it('does not plot CSV wpa as if Jev produced the series', () => {
    render(
      <ResultsChart
        rows={[{ rowIndex: 0, input: { wpa: 0.99 }, model: 'jev', questionKind: 'noul' }]}
        playheadIndex={0}
        totalRows={8}
        questionKind="noul"
        onSeek={vi.fn()}
      />,
    )
    expect(screen.getByText('Waiting for the first row…')).toBeInTheDocument()
    expect(document.querySelector('[data-series-points]')).toBeNull()
  })

  it('uses instant seek motion while the playhead is dragged off the live edge', () => {
    render(<ChartHarness rows={[row(0, 'gold'), row(1, 'silver'), row(2, 'gold')]} />)
    const shell = document.querySelector('.chart-shell')
    expect(shell).toHaveAttribute('data-motion', 'tick')
    fireEvent.change(screen.getByRole('slider', { name: /chart playhead/i }), { target: { value: '0' } })
    expect(shell).toHaveAttribute('data-motion', 'seek')
    expect(document.querySelector('[data-class="silver"]')).toHaveAttribute('data-count', '0')
  })

  it('scrubs a 71-play P(win) series on the full-game index without new chrome', () => {
    const rows = Array.from({ length: 12 }, (_, rowIndex) => ({
      rowIndex,
      input: { wpa: 0.91 },
      model: 'jev',
      value: 0.4,
      questionKind: 'noul' as const,
    }))
    render(<NoulHarness rows={rows} totalRows={71} />)
    const slider = screen.getByRole('slider', { name: /chart playhead/i })
    expect(slider).toHaveAttribute('max', '70')
    expect(slider).toHaveAttribute('aria-valuetext', 'Row 12 of 71')
    expect(screen.getByText(/^Play 12 · 40%$/)).toBeInTheDocument()
    expect(screen.queryByText(/71 total/i)).not.toBeInTheDocument()
    expect(document.querySelector('.series-line')).toBeTruthy()
    expect(document.querySelector('.series-fill')).toBeTruthy()
    expect(document.querySelector('[data-play-cursor="true"]')).toBeTruthy()
    expect(document.querySelectorAll('.chart-scrubber input')).toHaveLength(1)
    expect(document.querySelector('.chart-x-ticks')).toBeNull()
    fireEvent.change(slider, { target: { value: '40' } })
    expect(slider).toHaveAttribute('aria-valuetext', 'Row 12 of 71')
    fireEvent.change(slider, { target: { value: '4' } })
    expect(slider).toHaveAttribute('aria-valuetext', 'Row 5 of 71')
  })
})

describe('AnalysisRunView tick isolation', () => {
  const snapshot = (count: number): AnalysisSnapshot => ({
    analysisId: 'analysis-demo-1',
    fixtureId: 'dataset-1',
    datasetId: 'dataset-1',
    sourceType: 'upload',
    query: 'Classify',
    status: 'running',
    createdAt: '2026-09-17T18:00:00.000Z',
    updatedAt: '2026-09-17T18:01:00.000Z',
    progress: { completedRows: count, totalRows: 10, completedCalls: count, totalCalls: 10 },
    classes: ['gold', 'silver'],
    columns: ['message'],
    resultRows: Array.from({ length: count }, (_, rowIndex) => row(rowIndex, rowIndex === 1 ? 'silver' : 'gold')),
  })

  it('does not remount the analysis card or class tracks when a row appends', () => {
    const { rerender } = render(
      <AnalysisRunView snapshot={snapshot(1)} shareUrl="" shareMessage="" onCopyShare={() => undefined} />,
    )
    const card = document.querySelector('.analysis-card')
    const gold = document.querySelector('[data-class="gold"]')
    rerender(<AnalysisRunView snapshot={snapshot(2)} shareUrl="" shareMessage="" onCopyShare={() => undefined} />)
    expect(document.querySelector('.analysis-card')).toBe(card)
    expect(document.querySelector('[data-class="gold"]')).toBe(gold)
    expect(document.querySelector('[data-class="silver"]')).toHaveAttribute('data-count', '1')
  })

  it('scales Row X of Y to the full-game count and keeps the existing series scrubber', () => {
    const noulSnapshot: AnalysisSnapshot = {
      analysisId: 'analysis-noul-71',
      fixtureId: 'seahawks-super-bowl-2026-jev-v1',
      datasetId: 'seahawks-super-bowl-2026-jev-v1',
      sourceType: 'fixture',
      query: '{"type":"noul","instructions":"Will SEA win given this play state?"}',
      status: 'running',
      createdAt: '2026-09-17T18:00:00.000Z',
      updatedAt: '2026-09-17T18:01:00.000Z',
      progress: { completedRows: 12, totalRows: 71, completedCalls: 12, totalCalls: 71 },
      questionKind: 'noul',
      classes: [],
      columns: ['play_id', 'posteam_score', 'defteam_score'],
      resultRows: Array.from({ length: 12 }, (_, rowIndex) => ({
        rowIndex,
        input: { play_id: rowIndex, wpa: 0.9, posteam_score: 3, defteam_score: 0 },
        model: 'jev-latest',
        questionKind: 'noul',
        value: 0.42,
      })),
    }
    render(<AnalysisRunView snapshot={noulSnapshot} shareUrl="" shareMessage="" onCopyShare={() => undefined} />)
    expect(screen.getByRole('heading', { level: 2, name: '17%' })).toBeInTheDocument()
    expect(screen.getByText('12 / 71')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'SEA win probability' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /sea win probability over play index/i })).toBeInTheDocument()
    expect(screen.getByText(/^Play 12 · SEA 42%$/)).toBeInTheDocument()
    expect(screen.queryByText(/^Play 12 · 42%$/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Row 12 of 71' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /row 1 of 71/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /row 12 of 71/i })).toBeInTheDocument()
    expect(screen.getByText('12 / 71 rows')).toBeInTheDocument()
    const slider = screen.getByRole('slider', { name: /chart playhead/i })
    expect(slider).toHaveAttribute('max', '70')
    expect(document.querySelector('.series-line')).toBeTruthy()
    expect(document.querySelector('.series-fill')).toBeTruthy()
    expect(document.querySelectorAll('.chart-scrubber input')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /row 1 of 71/i }))
    expect(screen.getByRole('heading', { name: 'Row 1 of 71' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /row 1 of 71 0 · SEA 42%/i })).toBeInTheDocument()
    fireEvent.change(slider, { target: { value: '11' } })
    fireEvent.pointerUp(slider)
    expect(screen.getByRole('heading', { name: 'Row 12 of 71' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^play$/i })).not.toBeInTheDocument()
  })

  it('renders out-of-order completed rows sorted by rowIndex without pool jargon', () => {
    const sparse: AnalysisSnapshot = {
      ...snapshot(0),
      status: 'running',
      progress: { completedRows: 2, totalRows: 10, completedCalls: 2, totalCalls: 10 },
      resultRows: [row(4, 'gold'), row(1, 'silver')].sort((left, right) => left.rowIndex - right.rowIndex),
    }
    render(<AnalysisRunView snapshot={sparse} shareUrl="" shareMessage="" onCopyShare={() => undefined} />)
    expect(screen.getByRole('heading', { level: 2, name: '20%' })).toBeInTheDocument()
    expect(screen.getByText('2 / 10')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.queryByText(/lease|pool|qps/i)).not.toBeInTheDocument()
    const rail = screen.getByRole('complementary', { name: /processed rows/i })
    const buttons = within(rail).getAllByRole('button')
    expect(buttons[0]).toHaveAccessibleName(/row 2 of 10/i)
    expect(buttons[1]).toHaveAccessibleName(/row 5 of 10/i)
  })

  it('plays a completed run from the transport beside the scrubber and stays synced with Row X of Y', () => {
    vi.useFakeTimers()
    try {
      const complete: AnalysisSnapshot = {
        ...snapshot(5),
        status: 'complete',
        progress: { completedRows: 5, totalRows: 5, completedCalls: 5, totalCalls: 5 },
        resultRows: Array.from({ length: 5 }, (_, rowIndex) => row(rowIndex, rowIndex === 1 ? 'silver' : 'gold')),
      }
      render(<AnalysisRunView snapshot={complete} shareUrl="" shareMessage="" onCopyShare={() => undefined} />)
      expect(screen.getByRole('heading', { level: 2, name: '100%' })).toBeInTheDocument()
      expect(screen.getByText('5 of 5')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Row 5 of 5' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /incremental results/i })).not.toBeInTheDocument()
      const play = screen.getByRole('button', { name: /^play$/i })
      expect(play).toHaveAttribute('aria-pressed', 'false')
      expect(play).toBeEnabled()
      fireEvent.click(play)
      expect(screen.getByRole('button', { name: /^pause$/i })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('heading', { name: 'Row 1 of 5' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /row 1 of 5 hello · gold/i })).toBeInTheDocument()
      expect(screen.getByRole('slider', { name: /chart playhead/i })).toHaveAttribute('aria-valuetext', 'Row 1 of 5')
      expect(document.querySelector('[data-class="gold"]')).toHaveAttribute('data-count', '1')
      act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS) })
      expect(screen.getByRole('heading', { name: 'Row 2 of 5' })).toBeInTheDocument()
      expect(screen.getByRole('slider', { name: /chart playhead/i })).toHaveAttribute('aria-valuetext', 'Row 2 of 5')
      expect(document.querySelector('[data-class="silver"]')).toHaveAttribute('data-count', '1')
      fireEvent.click(screen.getByRole('button', { name: /^pause$/i }))
      act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS * 3) })
      expect(screen.getByRole('heading', { name: 'Row 2 of 5' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
      fireEvent.change(screen.getByRole('slider', { name: /chart playhead/i }), { target: { value: '0' } })
      expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Row 1 of 5' })).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS * 3) })
      expect(screen.getByRole('heading', { name: 'Row 1 of 5' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
      fireEvent.click(screen.getByRole('button', { name: /row 3 of 5/i }))
      expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Row 3 of 5' })).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS * 3) })
      expect(screen.getByRole('heading', { name: 'Row 3 of 5' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
      act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS * 2) })
      expect(screen.getByRole('heading', { name: 'Row 5 of 5' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS * 3) })
      expect(screen.getByRole('heading', { name: 'Row 5 of 5' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the P(win) series and Row X of Y in lockstep while playing', () => {
    vi.useFakeTimers()
    try {
      const noulSnapshot: AnalysisSnapshot = {
        analysisId: 'analysis-share-noul',
        fixtureId: 'seahawks-super-bowl-2026-jev-v1',
        datasetId: 'seahawks-super-bowl-2026-jev-v1',
        sourceType: 'fixture',
        query: '{"type":"noul","instructions":"Will SEA win given this play state?"}',
        status: 'complete',
        createdAt: '2026-09-17T18:00:00.000Z',
        updatedAt: '2026-09-17T18:01:00.000Z',
        progress: { completedRows: 5, totalRows: 71, completedCalls: 5, totalCalls: 71 },
        questionKind: 'noul',
        classes: [],
        columns: ['play_id'],
        resultRows: Array.from({ length: 5 }, (_, rowIndex) => ({
          rowIndex,
          input: { play_id: rowIndex, wpa: 0.9 },
          model: 'jev-latest',
          questionKind: 'noul',
          value: 0.4 + rowIndex * 0.05,
        })),
      }
      render(<AnalysisRunView snapshot={noulSnapshot} shareUrl="/share/demo" shareMessage="" onCopyShare={() => undefined} />)
      expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Row 5 of 71' })).toBeInTheDocument()
      expect(document.querySelector('[data-series-points="5"]')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
      expect(screen.getByRole('heading', { name: 'Row 1 of 71' })).toBeInTheDocument()
      expect(document.querySelector('[data-series-points="1"]')).toBeTruthy()
      act(() => { vi.advanceTimersByTime(PLAYBACK_INTERVAL_MS * 2) })
      expect(screen.getByRole('heading', { name: 'Row 3 of 71' })).toBeInTheDocument()
      expect(document.querySelector('[data-series-points="3"]')).toBeTruthy()
      expect(screen.getByRole('slider', { name: /chart playhead/i })).toHaveAttribute('aria-valuetext', 'Row 3 of 71')
    } finally {
      vi.useRealTimers()
    }
  })
})
