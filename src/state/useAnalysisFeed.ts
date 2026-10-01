import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiClientError, type PlaygroundApi } from '../api/client'
import type { AnalysisMeta, AnalysisViewRow } from '../shared/analysis'

const FAST_POLL_MS = 700
const IDLE_POLL_MS = 2_000
const MAX_RETRY_MS = 8_000
/** The run lease is 60 s; anything quieter than this has no live worker. */
const STALLED_AFTER_MS = 90_000

export interface AnalysisFeed {
  analysis?: AnalysisMeta
  rows: readonly AnalysisViewRow[]
  /** The first page has not arrived yet. */
  loading: boolean
  /** The run does not exist, or cannot be read at all. */
  fatal?: string
  /** A read failed and is being retried. */
  reconnecting: boolean
  /** Marked running, but nothing has been stored for a while. */
  stalled: boolean
  /** True once every stored row has been fetched. */
  caughtUp: boolean
  /** Poll again now (after a cancel or resume). */
  refresh(): void
}

const isLive = (analysis: AnalysisMeta): boolean => analysis.status === 'queued' || analysis.status === 'running'

/**
 * Follows a run with a cursor: every read asks only for rows after the last
 * one seen, so a 5,000-row run costs the same per poll as a 50-row one.
 * Failed reads back off and retry; they never end the feed.
 */
export const useAnalysisFeed = (api: PlaygroundApi, analysisId: string | undefined): AnalysisFeed => {
  const [analysis, setAnalysis] = useState<AnalysisMeta>()
  const [rows, setRows] = useState<readonly AnalysisViewRow[]>([])
  const [fatal, setFatal] = useState<string>()
  const [reconnecting, setReconnecting] = useState(false)
  const [stalled, setStalled] = useState(false)
  const [caughtUp, setCaughtUp] = useState(false)
  const [generation, setGeneration] = useState(0)
  const cursor = useRef(-1)
  const feedId = useRef<string>()

  useEffect(() => {
    if (!analysisId) return undefined
    if (feedId.current !== analysisId) {
      feedId.current = analysisId
      cursor.current = -1
      setAnalysis(undefined); setRows([]); setFatal(undefined); setStalled(false); setCaughtUp(false)
    }
    let active = true
    let timer: number | undefined
    let failures = 0
    let quietPolls = 0

    const schedule = (delay: number) => { timer = window.setTimeout(() => { void poll() }, delay) }

    const poll = async (): Promise<void> => {
      try {
        const page = await api.read(analysisId, cursor.current)
        if (!active) return
        failures = 0
        setReconnecting(false)
        setAnalysis(page.analysis)
        if (page.rows.length > 0) {
          const fresh = page.rows.filter((row) => row.rowIndex > cursor.current)
          cursor.current = page.nextAfter
          if (fresh.length > 0) setRows((current) => [...current, ...fresh])
        }
        setCaughtUp(!page.hasMore)
        setStalled(isLive(page.analysis) && page.serverTime - page.analysis.updatedAt > STALLED_AFTER_MS)
        if (page.hasMore) { schedule(0); return }
        if (!isLive(page.analysis)) return
        quietPolls = page.rows.length > 0 ? 0 : quietPolls + 1
        schedule(quietPolls > 3 ? IDLE_POLL_MS : FAST_POLL_MS)
      } catch (error) {
        if (!active) return
        if (error instanceof ApiClientError && (error.status === 404 || error.code === 'STORAGE_NOT_CONFIGURED')) {
          setFatal(error.message)
          return
        }
        failures += 1
        setReconnecting(true)
        schedule(Math.min(MAX_RETRY_MS, 1_000 * 2 ** Math.min(failures - 1, 3)))
      }
    }

    void poll()
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer) }
  }, [api, analysisId, generation])

  const refresh = useCallback(() => setGeneration((value) => value + 1), [])

  return { analysis, rows, loading: !analysis && !fatal, fatal, reconnecting, stalled, caughtUp, refresh }
}
