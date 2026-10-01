import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DashboardTile, type DashboardTileModel } from './DashboardTile'
import { DatasetDashboard } from './DatasetDashboard'
import { loadDemoSnapshot } from '../demo'
import { observedEatingInsight, proposeInsights } from '../dataset/insight'
import { getFootballDatasetPreview } from '../dataset/sampleDataset'
import { getSquirrelDatasetPreview } from '../fixtures/squirrelCensus'

// Saved runs of both kinds: an observed places map and a per-row series.
const squirrelRows = getSquirrelDatasetPreview().previewRows.slice(0, 120)
const squirrelSnapshot = (await loadDemoSnapshot('demo-squirrels'))!
const squirrelTile: DashboardTileModel = {
  insight: observedEatingInsight({ geo: { lat: 'latitude', lng: 'longitude' } }),
  snapshot: {
    ...squirrelSnapshot,
    resultRows: squirrelSnapshot.resultRows.slice(0, squirrelRows.length),
    progress: { ...squirrelSnapshot.progress, completedRows: squirrelRows.length, totalRows: squirrelRows.length },
  },
}
const football = getFootballDatasetPreview()
const footballTile: DashboardTileModel = {
  insight: proposeInsights(football)[0]!,
  snapshot: (await loadDemoSnapshot('demo-football'))!,
}

describe('dashboard tiles', () => {
  it('shows retryable failures alongside useful observed charts and offers a retry', () => {
    const snapshot = {
      ...squirrelTile.snapshot!,
      status: 'error' as const,
      error: { code: 'ANALYSIS_RUN_STALLED', retryable: true },
    }
    const onResume = vi.fn()
    render(<DashboardTile {...squirrelTile} snapshot={snapshot} sourceRows={squirrelRows} onResume={onResume} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /map of where they are eating/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(onResume).toHaveBeenCalledOnce()
  })

  it('offers retry for retryable start failures without a saved snapshot', () => {
    const onResume = vi.fn()
    render(
      <DashboardTile
        {...squirrelTile}
        snapshot={undefined}
        sourceRows={squirrelRows}
        error="The run could not start."
        retryable
        onResume={onResume}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry Where are they eating?' }))
    expect(onResume).toHaveBeenCalledOnce()
  })

  it('exposes download and share actions on every completed insight with usable labels', () => {
    const onCopyShare = vi.fn()
    render(<DatasetDashboard tiles={[squirrelTile, footballTile]} sourceRows={squirrelRows} onCopyShare={onCopyShare} />)

    expect(screen.getByRole('button', { name: 'Download results CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download results csv for will sea win/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy shareable public URL' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy shareable public URL for Will SEA win?' }))
    expect(onCopyShare.mock.calls).toEqual([['demo-squirrels'], ['demo-football']])
  })

  it('draws a line for an ordered table and counts per band for an unordered one', () => {
    const { unmount } = render(<DashboardTile {...footballTile} sourceRows={football.previewRows} />)
    expect(document.querySelector('.series-svg')).toBeInTheDocument()
    expect(document.querySelector('[data-bands]')).not.toBeInTheDocument()
    unmount()

    // The same kind of yes/no result over rows with no order: tickets in no sequence.
    const tickets = [
      { message: 'server down', tier: 'gold' },
      { message: 'thanks', tier: 'silver' },
      { message: 'refund please', tier: 'gold' },
      { message: 'love it', tier: 'bronze' },
    ]
    render(
      <DashboardTile
        insight={{ ...footballTile.insight, id: 'series-urgent', title: 'Is this ticket urgent?', perspectiveLabel: undefined }}
        snapshot={{
          ...footballTile.snapshot!,
          analysisId: 'run-tickets',
          datasetId: 'tickets',
          fixtureId: 'tickets',
          columns: ['message', 'tier'],
          progress: { completedRows: 4, totalRows: 4, completedCalls: 4, totalCalls: 4 },
          resultRows: tickets.map((input, rowIndex) => ({ rowIndex, input, model: 'jev', questionKind: 'noul' as const, value: [0.9, 0.1, 0.8, 0.5][rowIndex] })),
        }}
        sourceRows={tickets}
      />,
    )
    expect(document.querySelector('.series-svg')).not.toBeInTheDocument()
    const bands = [...document.querySelectorAll('[data-bands] .distribution-row')].map((row) => `${row.getAttribute('data-class')}:${row.getAttribute('data-count')}`)
    expect(bands).toEqual(['Likely yes:2', 'Unsure:1', 'Likely no:1'])
  })
})
