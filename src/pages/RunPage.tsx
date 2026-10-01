import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiClientError, type PlaygroundApi } from '../api/client'
import { ClassChart } from '../components/ClassChart'
import { AlertIcon, DownloadIcon, LinkIcon, StopIcon } from '../components/Icons'
import { ResultsTable } from '../components/ResultsTable'
import { RowDetail } from '../components/RowDetail'
import { Scoreboard } from '../components/Scoreboard'
import { Timeline } from '../components/Timeline'
import { analysisToCsv, exportFilename } from '../run/exportCsv'
import { countClasses, estimateSecondsLeft, formatCount, formatDuration, labelIndexOf, scoreRows } from '../run/metrics'
import { prefersReducedMotion, usePlayhead } from '../run/usePlayhead'
import type { AnalysisMeta, AnalysisStatus } from '../shared/analysis'
import { controlTokenFor } from '../state/controlTokens'
import { useAnalysisFeed } from '../state/useAnalysisFeed'

const STATUS_LABEL: Record<AnalysisStatus, string> = { queued: 'Starting', running: 'Running', complete: 'Complete', error: 'Stopped', cancelled: 'Cancelled' }

const statusSentence = (analysis: AnalysisMeta, stalled: boolean): string => {
  const { completedRows, totalRows } = analysis.progress
  if (stalled) return 'This run has gone quiet. It may have been interrupted.'
  switch (analysis.status) {
    case 'queued': return 'Waiting for the first answers…'
    case 'running': {
      const seconds = estimateSecondsLeft(analysis)
      return seconds === undefined ? 'Jev is working through the rows.' : `About ${formatDuration(seconds)} left.`
    }
    case 'complete': return analysis.startedAt && analysis.completedAt ? `Finished in ${formatDuration((analysis.completedAt - analysis.startedAt) / 1000)}.` : 'Finished.'
    case 'cancelled': return `Cancelled after ${formatCount(completedRows)} of ${formatCount(totalRows)} rows. The answers so far are kept.`
    case 'error': return `Stopped after ${formatCount(completedRows)} of ${formatCount(totalRows)} rows because Jev kept failing. The answers so far are kept.`
  }
}

const copyText = async (text: string): Promise<boolean> => {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export const RunPage = ({ api, analysisId, justStarted }: { api: PlaygroundApi; analysisId: string; justStarted: boolean }) => {
  const feed = useAnalysisFeed(api, analysisId)
  const { analysis, rows } = feed
  const playhead = usePlayhead(rows.length, analysisId)
  const [controlToken] = useState(() => controlTokenFor(analysisId))
  const [notice, setNotice] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [pending, setPending] = useState<'cancel' | 'resume'>()
  const autoReplayed = useRef(false)

  const live = analysis?.status === 'queued' || analysis?.status === 'running'
  const labelIndex = analysis ? labelIndexOf(analysis) : -1
  const upto = playhead.index + 1
  const tally = useMemo(() => countClasses(rows, analysis?.classes ?? [], upto), [rows, analysis?.classes, upto])
  const score = useMemo(() => (analysis ? scoreRows(rows, analysis.classes, labelIndex, upto) : undefined), [rows, analysis, labelIndex, upto])

  useEffect(() => { document.title = analysis ? `${analysis.datasetName} · Jev Playground` : 'Jev Playground' }, [analysis])

  // Someone opening a finished run gets the run replayed, not just its last frame.
  useEffect(() => {
    if (autoReplayed.current || justStarted || !analysis || live || !feed.caughtUp || rows.length < 2) return
    autoReplayed.current = true
    if (!prefersReducedMotion()) playhead.play()
  }, [analysis, feed.caughtUp, justStarted, live, playhead, rows.length])

  if (feed.fatal) {
    return (
      <div className="stack">
        <div className="banner error" role="alert"><AlertIcon /><span>{feed.fatal}</span></div>
        <p><a className="button" href="/">Start a new run</a></p>
      </div>
    )
  }
  if (!analysis) return <p className="loading" role="status">Loading the run…</p>

  const { completedRows, totalRows, failedRows } = analysis.progress
  const percent = totalRows ? Math.round((completedRows / totalRows) * 100) : 0
  const canResume = Boolean(controlToken) && (analysis.status === 'error' || feed.stalled)
  const canCancel = Boolean(controlToken) && live

  const act = async (kind: 'cancel' | 'resume') => {
    if (!controlToken) return
    setPending(kind); setActionError(undefined)
    try {
      await (kind === 'cancel' ? api.cancel(analysisId, controlToken) : api.resume(analysisId, controlToken))
      feed.refresh()
    } catch (error) {
      setActionError(error instanceof ApiClientError ? error.message : 'That did not work. Please try again.')
    } finally {
      setPending(undefined)
    }
  }

  const share = async () => {
    const url = `${window.location.origin}/run/${encodeURIComponent(analysisId)}`
    setNotice(await copyText(url) ? 'Link copied' : `Copy this link: ${url}`)
  }

  const download = () => {
    const blob = new Blob([analysisToCsv(analysis, rows)], { type: 'text/csv;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = exportFilename(analysis)
    anchor.click()
    URL.revokeObjectURL(href)
  }

  const selected = rows[playhead.index]

  return (
    <div className="stack">
      <section className="card run-head" aria-labelledby="run-heading">
        <div className="run-title">
          <div>
            <p className="eyebrow">{analysis.datasetName}</p>
            <h1 id="run-heading" className="question">{analysis.query}</h1>
          </div>
          <div className="pills">
            {analysis.mode === 'mock' && <span className="pill is-mock" title="These answers were generated by a stand-in, not by Jev.">Simulated</span>}
            <span className={`pill status-${feed.stalled ? 'stalled' : analysis.status}`} role="status">{live && !feed.stalled && <span className="pulse" aria-hidden="true" />}{feed.stalled ? 'Stalled' : STATUS_LABEL[analysis.status]}</span>
          </div>
        </div>
        <div className="progress" aria-label="Progress">
          <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={totalRows} aria-valuenow={completedRows} aria-label="Rows answered"><span style={{ width: `${percent}%` }} /></div>
          <p>
            <b>{formatCount(completedRows)} of {formatCount(totalRows)} rows</b>
            {failedRows > 0 ? ` · ${formatCount(failedRows)} failed` : ''} · {statusSentence(analysis, feed.stalled)}
            {feed.reconnecting ? ' Reconnecting…' : ''}
          </p>
        </div>
        <div className="actions">
          <button className="button" type="button" onClick={() => { void share() }}><LinkIcon /> Copy link</button>
          <button className="button" type="button" onClick={download} disabled={rows.length === 0 || !feed.caughtUp}><DownloadIcon /> Download CSV</button>
          {canCancel && <button className="button danger" type="button" disabled={pending !== undefined} onClick={() => { void act('cancel') }}><StopIcon /> {pending === 'cancel' ? 'Cancelling…' : 'Cancel run'}</button>}
          {canResume && <button className="button primary" type="button" disabled={pending !== undefined} onClick={() => { void act('resume') }}>{pending === 'resume' ? 'Resuming…' : 'Resume run'}</button>}
          <a className="button quiet" href="/">New run</a>
          <span className="notice" role="status" aria-live="polite">{notice}</span>
        </div>
        {actionError && <div className="banner error" role="alert"><AlertIcon /><span>{actionError}</span></div>}
        {analysis.mode === 'mock' && <p className="note warning">Simulated run: these answers come from a built-in stand-in so the playground can be tried without a Jev key. They say nothing about how Jev performs.</p>}
      </section>

      <Timeline playhead={playhead} loaded={rows.length} total={totalRows} live={live} />

      <div className="run-grid">
        <div className="stack">
          {score && analysis.labelColumn && <Scoreboard score={score} classes={analysis.classes} labelColumn={analysis.labelColumn} />}
          <ClassChart classes={analysis.classes} tally={tally} animate={playhead.following && !playhead.playing} />
        </div>
        <RowDetail analysis={analysis} row={selected} labelIndex={labelIndex} />
      </div>

      <ResultsTable
        analysis={analysis}
        rows={rows}
        labelIndex={labelIndex}
        selectedRowIndex={selected?.rowIndex}
        autoScroll={playhead.following || playhead.playing}
        onSelect={playhead.seek}
      />
    </div>
  )
}
