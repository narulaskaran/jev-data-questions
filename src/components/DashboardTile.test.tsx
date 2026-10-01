import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DashboardTile } from './DashboardTile'
import { DatasetDashboard } from './DatasetDashboard'
import { getDemoDashboard } from '../demo'

const squirrel = getDemoDashboard('squirrels')
if (!squirrel) throw new Error('Missing offline squirrel demo')

describe('dashboard tiles', () => {
  it('shows retryable failures alongside useful observed charts and offers a retry', () => {
    const tile = squirrel.tiles[0]!
    const snapshot = {
      ...tile.snapshot!,
      status: 'error' as const,
      error: { code: 'ANALYSIS_RUN_STALLED', retryable: true },
    }
    const onResume = vi.fn()
    render(
      <DashboardTile
        {...tile}
        snapshot={snapshot}
        sourceRows={squirrel.dataset.previewRows}
        onResume={onResume}
      />,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /map of where they are eating/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(onResume).toHaveBeenCalledOnce()
  })

  it('offers retry for retryable start failures without a saved snapshot', () => {
    const onResume = vi.fn()
    render(
      <DashboardTile
        {...squirrel.tiles[0]!}
        snapshot={undefined}
        sourceRows={squirrel.dataset.previewRows}
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
    render(
      <DatasetDashboard
        tiles={squirrel.tiles}
        sourceRows={squirrel.dataset.previewRows}
        onCopyShare={onCopyShare}
      />,
    )

    expect(screen.getByRole('button', { name: 'Download results CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download results csv for which places have the most eating/i })).toBeInTheDocument()
    const shareButtons = [
      screen.getByRole('button', { name: 'Copy shareable public URL' }),
      screen.getByRole('button', { name: 'Copy shareable public URL for Which places have the most eating?' }),
    ]
    fireEvent.click(shareButtons[0]!)
    fireEvent.click(shareButtons[1]!)
    expect(onCopyShare.mock.calls).toEqual([['demo-squirrels'], ['demo-squirrels']])
  })
})
