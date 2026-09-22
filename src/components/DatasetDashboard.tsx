import { useEffect, useState } from 'react'
import { DashboardTile, type DashboardTileModel } from './DashboardTile'
import type { AnalysisRowInput } from '../shared/analysis'

export const FINDING_INSIGHTS_COPY = 'Finding insights…'
export const EMPTY_INSIGHTS_COPY = 'No insights for this table.'

export const DatasetDashboard = ({
  tiles,
  proposing,
  sourceRows,
  onResume,
  resumingId,
  shareMessage,
  onCopyShare,
}: {
  tiles: readonly DashboardTileModel[]
  proposing?: boolean
  sourceRows?: readonly AnalysisRowInput[]
  onResume?: (insightId: string) => void
  resumingId?: string
  shareMessage?: string
  onCopyShare?: (analysisId: string) => void
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const live = tiles.some((tile) => (
    tile.starting || tile.snapshot?.status === 'queued' || tile.snapshot?.status === 'running'
  ))

  useEffect(() => {
    if (!live && !proposing) return undefined
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live, proposing])

  if (proposing) {
    return (
      <section className="dashboard-empty" aria-label="Dataset dashboard" role="status">
        <p className="thinking">
          <span className="thinking-dot" aria-hidden="true" />
          {FINDING_INSIGHTS_COPY}
        </p>
      </section>
    )
  }

  if (tiles.length === 0) {
    return (
      <section className="dashboard-empty" aria-label="Dataset dashboard" role="status">
        <p className="empty-copy">{EMPTY_INSIGHTS_COPY}</p>
      </section>
    )
  }

  const visualKindCount = new Set(tiles.map((tile) => tile.insight.visual)).size
  return (
    <section
      className="dashboard-grid"
      aria-label="Dataset dashboard"
      data-insight-count={tiles.length}
      data-visual-kind-count={visualKindCount}
    >
      {tiles.map((tile, index) => (
        <DashboardTile
          key={tile.insight.id}
          {...tile}
          lead={index === 0}
          sourceRows={sourceRows}
          nowMs={nowMs}
          onResume={onResume ? () => onResume(tile.insight.id) : undefined}
          resuming={resumingId === tile.insight.id}
          shareMessage={shareMessage}
          onCopyShare={onCopyShare && tile.snapshot ? () => onCopyShare(tile.snapshot!.analysisId) : undefined}
        />
      ))}
    </section>
  )
}
