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
import { ANALYSIS_STALL_AFTER_MS } from '../shared/analysis'
import { inferQuestionKind } from '../shared/questionKind'
import { insightEyebrow, perspectiveLabelFor, resolveChartVisual } from '../dataset/insight'
import type { InsightProposal } from '../dataset/insight'
import type { AnalysisRowInput, AnalysisSnapshot } from '../shared/analysis'
import { downloadTextFile, resultsCsv, resultsCsvFilename } from '../runView/resultsCsv'

export type DashboardTileModel = {
  insight: InsightProposal
  snapshot?: AnalysisSnapshot
  starting?: boolean
  startedAt?: number
  error?: string
  latencyHint?: 'saved' | 'live'
}

export const DashboardTile = memo(function DashboardTile({
  insight,
  snapshot,
  starting,
  startedAt,
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
  const percent = snapshot
    ? runProgressPercent(snapshot.progress.completedRows, snapshot.progress.totalRows, snapshot.status)
    : 0
  const stallCopy = snapshot
    ? runStallCopy(snapshot.status, snapshot.updatedAt, nowMs ?? Date.now())
    : starting && startedAt && (nowMs ?? Date.now()) - startedAt >= ANALYSIS_STALL_AFTER_MS
      ? runStallCopy('running', new Date(startedAt).toISOString(), nowMs ?? Date.now())
      : undefined
  const errorCopy = snapshot?.error
    ? runErrorCopy(snapshot.error, snapshot.progress.completedRows)
    : error
      ? { title: "Couldn't run", detail: error }
      : undefined
  const paintsPlaces = chartKind === 'places' && (sourceRows?.length ?? 0) > 0
  const rankPlaces = insight.id === 'bars-eating-places'
  const paintsRanks = rankPlaces && (sourceRows?.length ?? 0) > 0
  const empty = rows.length === 0 && !paintsPlaces && !paintsRanks
  const showSkeleton = empty && chartKind !== 'places' && !paintsRanks
  const showError = Boolean(errorCopy) && !paintsPlaces && !paintsRanks
  const showProgress = Boolean(starting || snapshot)
  const waitingCopy = starting && !snapshot && !stallCopy ? 'Starting…' : undefined
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
      rankPlaces={rankPlaces}
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
    rankPlaces,
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
          <p className="eyebrow">{insightEyebrow(insight)}</p>
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
        {showProgress ? (
          <div className="progress-block dashboard-progress" aria-label={`${insight.title} progress`}>
            <div className="progress-line">
              <span>
                {snapshot
                  ? snapshot.status === 'complete'
                    ? `${snapshot.progress.totalRows} of ${snapshot.progress.totalRows}`
                    : `${snapshot.progress.completedRows} / ${snapshot.progress.totalRows}`
                  : waitingCopy ?? '0 / …'}
              </span>
              <b>{percent}%</b>
            </div>
            <ProgressBar value={percent} indeterminate={!snapshot || (snapshot.status !== 'complete' && snapshot.progress.completedRows === 0)} />
          </div>
        ) : null}
        {stallCopy ? <p className="run-stall" role="status">{stallCopy}</p> : null}
        {showError && errorCopy ? (
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
