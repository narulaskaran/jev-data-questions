import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ResultsChart } from './ResultsChart'
import { RowRail } from './RowRail'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader } from './ui/card'
import { Progress as ProgressBar } from './ui/progress'
import {
  resumeRunLabel,
  runErrorCopy,
  runProgressCount,
  runProgressPercent,
  runStallCopy,
  runSubsetCopy,
  savedRunCopy,
} from '../runView/format'
import { downloadTextFile, resultsCsv, resultsCsvFilename } from '../runView/resultsCsv'
import { snapCompleteMotion, snapCompletePlayhead, useRunPlayhead } from '../runView/playhead'
import { inferQuestionKind, type ChartVisualKind } from '../shared/questionKind'
import { chartIsRowStreamed, resolveChartVisual } from '../dataset/insight'
import type { AnalysisRowInput, AnalysisSnapshot, AnalysisStatus } from '../shared/analysis'

const statusLabels: Record<AnalysisStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  complete: 'Complete',
  error: 'Error',
}

const statusVariant: Record<AnalysisStatus, 'queued' | 'running' | 'complete' | 'error'> = {
  queued: 'queued',
  running: 'running',
  complete: 'complete',
  error: 'error',
}

const StatusBadge = memo(function StatusBadge({ status }: { status: AnalysisStatus }) {
  return (
    <Badge className={`analysis-status status-${status}`} variant={statusVariant[status]} role="status">
      {statusLabels[status]}
    </Badge>
  )
})

const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const Progress = memo(function Progress({
  completedRows,
  totalRows,
  percent,
}: {
  completedRows: number
  totalRows: number
  percent: number
}) {
  return (
    <div className="progress-block" aria-label="Analysis progress">
      <div className="progress-line"><span>{completedRows} / {totalRows} rows</span><b>{percent}%</b></div>
      <ProgressBar value={percent} />
    </div>
  )
})

export const AnalysisRunView = memo(function AnalysisRunView({
  snapshot,
  shareUrl,
  shareMessage,
  onCopyShare,
  onResume,
  resuming,
  datasetRowCount,
  inputHalf,
  latencyHint,
  chartKind: chartKindOverride,
  sourceRows,
}: {
  snapshot: AnalysisSnapshot
  shareUrl: string
  shareMessage: string
  onCopyShare: () => void
  onResume?: () => void
  resuming?: boolean
  datasetRowCount?: number
  inputHalf?: 'H1'
  latencyHint?: 'saved' | 'live'
  chartKind?: ChartVisualKind
  sourceRows?: readonly AnalysisRowInput[]
}) {
  const rows = snapshot.resultRows
  const playbackEnabled = snapshot.status === 'complete'
  const live = snapshot.status === 'queued' || snapshot.status === 'running'
  const [elapsedMs, setElapsedMs] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const { index, followLive, motion, playing, seek, togglePlayback } = useRunPlayhead(rows.length, snapshot.analysisId)
  const seekRef = useRef(seek)
  const toggleRef = useRef(togglePlayback)
  seekRef.current = seek
  toggleRef.current = togglePlayback
  const handleSeek = useCallback((next: number, phase: 'scrub' | 'release' = 'release') => {
    seekRef.current(next, phase)
  }, [])
  const handleTogglePlayback = useCallback(() => {
    toggleRef.current()
  }, [])
  const questionKind = inferQuestionKind(snapshot.query, snapshot.classes, snapshot.questionKind)
  const chartKind = resolveChartVisual({
    datasetId: snapshot.datasetId || snapshot.fixtureId,
    columns: snapshot.columns,
    rows: snapshot.resultRows.map((row) => row.input),
    query: snapshot.query,
    questionKind,
    classes: snapshot.classes,
    visual: chartKindOverride,
  })
  const showRail = chartIsRowStreamed(chartKind)
  const canDownload = rows.length > 0
  const subsetCopy = runSubsetCopy({
    analyzedRows: snapshot.progress.totalRows,
    datasetRows: datasetRowCount,
    sourceType: snapshot.sourceType,
    inputHalf,
    tense: live ? 'analyzing' : 'analyzed',
  })
  const errorCopy = snapshot.error ? runErrorCopy(snapshot.error, snapshot.progress.completedRows) : undefined
  const displayCompleted = snapshot.status === 'complete' ? snapshot.progress.totalRows : snapshot.progress.completedRows
  const progressPercent = runProgressPercent(snapshot.progress.completedRows, snapshot.progress.totalRows, snapshot.status)
  const progressCount = runProgressCount(snapshot.progress.completedRows, snapshot.progress.totalRows, snapshot.status)

  useEffect(() => {
    if (!live) return undefined
    const startedAt = Date.parse(snapshot.createdAt)
    const origin = Number.isFinite(startedAt) ? startedAt : Date.now()
    const tick = () => {
      const now = Date.now()
      setNowMs(now)
      setElapsedMs(Math.max(0, now - origin))
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [live, snapshot.analysisId, snapshot.createdAt])

  const completeSnap = snapshot.status === 'complete'
  const savedReuse = latencyHint === 'saved' && completeSnap
  const savedCopy = savedReuse ? savedRunCopy() : undefined
  const chartIndex = snapCompletePlayhead(snapshot.status, rows.length, index, playing, followLive)
  const chartMotion = snapCompleteMotion(snapshot.status, playing, motion)
  const stallCopy = runStallCopy(snapshot.status, snapshot.updatedAt, nowMs)
  const latencyCopy = live
    ? subsetCopy
      ? `Live run · ${formatElapsed(elapsedMs)} · ${subsetCopy} Can take a few minutes.`
      : `Live run · ${formatElapsed(elapsedMs)} · ${snapshot.progress.totalRows} rows can take a few minutes.`
    : [savedCopy, subsetCopy].filter(Boolean).join(' ') || undefined

  return (
    <Card className="analysis-card" aria-labelledby="analysis-heading" data-analysis-id={snapshot.analysisId} data-complete-snap={completeSnap || undefined} data-saved-run={savedReuse || undefined}>
      <CardHeader className="analysis-head flex-row items-start justify-between space-y-0 p-6 pb-0">
        <div>
          <p className="eyebrow">Run</p>
          <h2 id="analysis-heading" className="analysis-progress-pct">{progressPercent}%</h2>
          <p className="analysis-progress-count">{progressCount}</p>
        </div>
        <div className="analysis-actions">
          <StatusBadge status={snapshot.status} />
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              if (!canDownload) return
              downloadTextFile(resultsCsvFilename(snapshot), resultsCsv(snapshot))
            }}
            disabled={!canDownload}
            aria-label="Download results CSV"
          >
            Download CSV
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onCopyShare} disabled={!shareUrl} aria-label="Copy shareable public URL">
            {shareMessage || 'Share'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Progress
          completedRows={displayCompleted}
          totalRows={snapshot.progress.totalRows}
          percent={progressPercent}
        />
        {latencyCopy ? <p className="run-latency" role="status">{latencyCopy}</p> : null}
        {stallCopy ? <p className="run-stall" role="status">{stallCopy}</p> : null}
        {errorCopy ? (
          <div className="error-banner compact" role="alert">
            <div className="error-banner-copy">
              <b>{errorCopy.title}</b>
              <span>{errorCopy.detail}</span>
            </div>
            {onResume ? (
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
        <div className="run-view">
          <div className="run-view-main">
            <ResultsChart
              rows={rows}
              playheadIndex={chartIndex}
              classes={snapshot.classes}
              totalRows={snapshot.progress.totalRows}
              motion={chartMotion}
              questionKind={questionKind}
              chartKind={chartKind}
              playing={playing}
              playbackEnabled={playbackEnabled && showRail}
              sourceRows={sourceRows}
              onSeek={handleSeek}
              onTogglePlayback={handleTogglePlayback}
            />
          </div>
          {showRail ? (
          <RowRail
            rows={rows}
            totalRows={snapshot.progress.totalRows}
            playheadIndex={chartIndex}
            classes={snapshot.classes}
            chartKind={chartKind}
            onSelect={handleSeek}
          />
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
})
