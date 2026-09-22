import { memo, useMemo } from 'react'
import { ResultsChart } from './ResultsChart'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader } from './ui/card'
import { Progress as ProgressBar } from './ui/progress'
import {
  resumeRunLabel,
  runErrorCopy,
  runProgressPercent,
  runStallCopy,
} from '../runView/format'
import { inferQuestionKind } from '../shared/questionKind'
import { perspectiveLabelFor, resolveChartVisual } from '../dataset/insight'
import type { InsightProposal } from '../dataset/insight'
import type { AnalysisRowInput, AnalysisSnapshot } from '../shared/analysis'
import { downloadTextFile, resultsCsv, resultsCsvFilename } from '../runView/resultsCsv'

export type DashboardTileModel = {
  insight: InsightProposal
  snapshot?: AnalysisSnapshot
  starting?: boolean
  error?: string
  latencyHint?: 'saved' | 'live'
}

export const DashboardTile = memo(function DashboardTile({
  insight,
  snapshot,
  starting,
  error,
  latencyHint,
  sourceRows,
  lead,
  nowMs,
  onResume,
  resuming,
  shareMessage,
  onCopyShare,
}: DashboardTileModel & {
  sourceRows?: readonly AnalysisRowInput[]
  lead?: boolean
  nowMs?: number
  onResume?: () => void
  resuming?: boolean
  shareMessage?: string
  onCopyShare?: () => void
}) {
  const questionKind = snapshot
    ? inferQuestionKind(snapshot.query, snapshot.classes, snapshot.questionKind)
    : insight.questionKind
  const chartKind = resolveChartVisual({
    datasetId: snapshot?.datasetId || snapshot?.fixtureId,
    columns: snapshot?.columns,
    rows: snapshot?.resultRows.map((row) => row.input) ?? sourceRows,
    query: snapshot?.query ?? insight.cannedQuery ?? insight.task,
    questionKind,
    classes: snapshot?.classes ?? insight.classes,
    visual: insight.visual,
  })
  const rows = snapshot?.resultRows ?? []
  const totalRows = snapshot?.progress.totalRows || sourceRows?.length || 0
  const playheadIndex = rows.length > 0 ? rows.length - 1 : 0
  const waiting = !snapshot && Boolean(starting)
  const showSkeleton = waiting && chartKind !== 'places'
  const percent = snapshot
    ? runProgressPercent(snapshot.progress.completedRows, snapshot.progress.totalRows, snapshot.status)
    : 0
  const stallCopy = snapshot
    ? runStallCopy(snapshot.status, snapshot.updatedAt, nowMs ?? Date.now())
    : undefined
  const errorCopy = snapshot?.error
    ? runErrorCopy(snapshot.error, snapshot.progress.completedRows)
    : error
      ? { title: "Couldn't run", detail: error }
      : undefined
  const perspectiveLabel = perspectiveLabelFor({
    datasetId: snapshot?.datasetId ?? insight.perspectiveLabel,
    fixtureId: snapshot?.fixtureId,
    rows: [
      ...(snapshot?.resultRows.map((row) => row.input) ?? []),
      ...(sourceRows ?? []),
    ],
  }) ?? insight.perspectiveLabel
  const headingId = `dashboard-heading-${insight.id}`
  const status = snapshot?.status
  const completeSnap = snapshot?.status === 'complete'

  const chart = useMemo(() => (
    <ResultsChart
      rows={rows}
      playheadIndex={playheadIndex}
      classes={snapshot?.classes ?? insight.classes}
      totalRows={totalRows}
      motion={completeSnap ? 'seek' : 'tick'}
      questionKind={questionKind}
      chartKind={chartKind}
      compact
      heading={insight.title}
      headingId={headingId}
      sourceRows={sourceRows}
      perspectiveLabel={perspectiveLabel}
      onSeek={() => undefined}
    />
  ), [
    chartKind,
    completeSnap,
    headingId,
    insight.classes,
    insight.title,
    playheadIndex,
    perspectiveLabel,
    questionKind,
    rows,
    snapshot?.classes,
    sourceRows,
    totalRows,
  ])

  return (
    <Card
      className={`dashboard-tile${lead ? ' is-lead' : ''}`}
      data-insight-id={insight.id}
      data-visual={insight.visual}
      data-lead={lead || undefined}
      data-complete-snap={completeSnap || undefined}
      data-saved-run={completeSnap && latencyHint === 'saved' ? true : undefined}
      aria-labelledby={headingId}
    >
      <CardHeader className="section-heading flex-row items-start justify-between space-y-0">
        <div>
          <p className="eyebrow">{insight.visual === 'places' ? 'Places' : insight.visual === 'series' ? (insight.id === 'series-win' ? 'P(win) line' : 'Series') : 'Class bars'}</p>
          <h2 id={headingId}>{insight.title}</h2>
        </div>
        <div className="dashboard-tile-actions">
        {status ? (
          <Badge variant={status === 'complete' ? 'complete' : status === 'error' ? 'error' : 'running'}>
            {status === 'complete' ? `${percent}%` : status === 'error' ? 'Error' : starting ? 'Starting…' : `${percent}%`}
          </Badge>
        ) : starting ? (
          <Badge variant="running">Starting…</Badge>
        ) : null}
        {lead && snapshot && rows.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => downloadTextFile(resultsCsvFilename(snapshot), resultsCsv(snapshot))}
            aria-label="Download results CSV"
          >
            Download CSV
          </Button>
        ) : null}
        {lead && snapshot && onCopyShare ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onCopyShare}
            aria-label="Copy shareable public URL"
          >
            {shareMessage || 'Share'}
          </Button>
        ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {snapshot ? (
          <div className="progress-block dashboard-progress" aria-label={`${insight.title} progress`}>
            <div className="progress-line">
              <span>{snapshot.status === 'complete' ? `${snapshot.progress.totalRows} of ${snapshot.progress.totalRows}` : `${snapshot.progress.completedRows} / ${snapshot.progress.totalRows}`}</span>
              <b>{percent}%</b>
            </div>
            <ProgressBar value={percent} />
          </div>
        ) : null}
        {stallCopy ? <p className="run-stall" role="status">{stallCopy}</p> : null}
        {errorCopy ? (
          <div className="error-banner compact" role="alert">
            <div className="error-banner-copy">
              <b>{errorCopy.title}</b>
              <span>{errorCopy.detail}</span>
            </div>
            {snapshot?.error && onResume ? (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={onResume}
                disabled={resuming}
                aria-label={resumeRunLabel(snapshot.progress.completedRows)}
              >
                {resuming ? 'Resuming…' : resumeRunLabel(snapshot.progress.completedRows)}
              </Button>
            ) : null}
          </div>
        ) : null}
        {showSkeleton ? (
          <div className="chart-skeleton" data-skeleton="true" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : chart}
      </CardContent>
    </Card>
  )
})
