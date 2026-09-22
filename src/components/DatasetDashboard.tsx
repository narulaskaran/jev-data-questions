import { useEffect, useState } from 'react'
import { DashboardTile, type DashboardTileModel } from './DashboardTile'
import type { AnalysisRowInput } from '../shared/analysis'

export const DatasetDashboard = ({
  tiles,
  sourceRows,
  onResume,
  resumingId,
  shareMessage,
  onCopyShare,
}: {
  tiles: readonly DashboardTileModel[]
  sourceRows?: readonly AnalysisRowInput[]
  onResume?: (insightId: string) => void
  resumingId?: string
  shareMessage?: string
  onCopyShare?: (analysisId: string) => void
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const live = tiles.some((tile) => tile.snapshot?.status === 'queued' || tile.snapshot?.status === 'running')

  useEffect(() => {
    if (!live) return undefined
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live])

  if (tiles.length === 0) return null
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
