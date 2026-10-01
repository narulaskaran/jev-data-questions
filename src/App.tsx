import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DemoPicker } from './components/LandingDemos'
import { demoDatasets, demoReplayDisclosure, isDemoAnalysisId, loadDemoDashboard, loadDemoSnapshot, type DemoDashboard } from './demo'
import { copyText } from './browser/clipboard'
import { AnalysisRunView } from './components/AnalysisRunView'
import type { DashboardTileModel } from './components/DashboardTile'
import { DatasetDashboard } from './components/DatasetDashboard'
import { DatasetIntake } from './components/DatasetIntake'
import { DatasetPreviewCard } from './components/DatasetPreview'
import { StoryDashboard } from './components/story/StoryDashboard'
import { buildStoryDashboard } from './insights/dashboard'
import { SchemaStrip } from './components/SchemaStrip'
import { StageFold } from './components/StageFold'
import { Button } from './components/ui/button'
import { ArrowUpRight } from './components/ui/arrow'
import { Label } from './components/ui/label'
import { loadFixtureDatasetPreview } from './dataset/sampleDataset'
import { formatCount } from './insights/format'
import { hasNamedHeuristicCuts, proposeInsights, queryFromInsight, sanitizeLlmInsightProposals, mergeDashboardInsights, type InsightProposal } from './dataset/insight'
import { LOCAL_PATH, datasetHref, landHref, parseAppLocation, type AppRoute } from './app/route'
import { CSV_MAX_BYTES, DatasetError, DATASET_ERROR_COPY, plainDatasetError, type ValidatedDataset } from './dataset/csvTypes'
import { validateCsvText } from './dataset/validateDataset'
import type {
  AnalysisDraftResult,
  AnalysisSnapshot,
} from './shared/analysis'
import {
  classesFromJevQuery,
  formatDraftQueryForEditor,
  looksLikeJevQueryJson,
  parseJevQueryJson,
} from './shared/jevQuery'
import type { DatasetIntakeStatus, DatasetPreview } from './shared/dataset'
import { ANALYSIS_ERROR_COPY, plainAnalysisError } from './runView/format'
import { useTheme } from './theme'
import './styles.css'

export const INTAKE_TIMEOUT_MS = 45_000

export interface AnalysisProposeResult {
  datasetId: string
  insights: InsightProposal[]
  source?: 'heuristic' | 'llm' | 'empty'
}

export interface AnalysisApiClient {
  draft: (input: { fixtureId?: string; datasetId?: string; task: string }) => Promise<AnalysisDraftResult>
  propose?: (input: { fixtureId?: string; datasetId?: string }) => Promise<AnalysisProposeResult>
  start: (input: {
    fixtureId?: string
    datasetId?: string
    query: string
    classes?: readonly string[]
    questionKind?: AnalysisDraftResult['metadata']['questionKind']
    analysisId?: string
    resume?: boolean
    forceNew?: boolean
  }) => Promise<AnalysisSnapshot>
  read: (analysisId: string) => Promise<AnalysisSnapshot>
  share: (analysisId: string) => Promise<AnalysisSnapshot>
  intakeStatus?: () => Promise<DatasetIntakeStatus>
  readDataset?: (datasetId: string) => Promise<DatasetPreview>
  createFromCsv?: (input: { csvText: string; filename: string }) => Promise<DatasetPreview>
  createFromUrl?: (input: { url: string }) => Promise<DatasetPreview>
}

const apiError = async (response: Response): Promise<Error> => {
  if (response.ok) return new Error('')
  let code = 'REQUEST_FAILED'
  let failure: DatasetError['failure']
  let message = ''
  try {
    const body = await response.json() as { error?: unknown; failure?: unknown; message?: unknown }
    if (typeof body.error === 'string' && /^[A-Z0-9_]+$/.test(body.error)) code = body.error
    if (typeof body.failure === 'string' && /^[A-Z0-9_]+$/.test(body.failure)) failure = body.failure as DatasetError['failure']
    if (typeof body.message === 'string') message = body.message.trim()
  } catch { /* Keep a stable client-side error when the body is not JSON. */ }
  if (code in DATASET_ERROR_COPY) {
    return new DatasetError(code as DatasetError['code'], message || DATASET_ERROR_COPY[code], response.status, failure)
  }
  return new Error(message || code)
}

const isAbortError = (error: unknown): boolean => (
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
)

const json = async <T,>(url: string, init: RequestInit, options: { timeoutMs?: number } = {}): Promise<T> => {
  const timeoutMs = options.timeoutMs ?? 30_000
  const controller = timeoutMs ? new AbortController() : undefined
  const timer = timeoutMs ? window.setTimeout(() => controller?.abort(), timeoutMs) : undefined
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller?.signal ?? init.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    if (!response.ok) throw await apiError(response)
    return await response.json() as T
  } catch (error) {
    if (isAbortError(error)) {
      if (options.timeoutMs) throw new DatasetError('URL_TIMEOUT', 'This CSV took too long to load. Try a smaller file or another URL.', 504)
      throw new Error('This request took too long. Please try again.')
    }
    throw error
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

export const defaultAnalysisApi: AnalysisApiClient = {
  draft: (input) => json<AnalysisDraftResult>('/api/analysis/draft', { method: 'POST', body: JSON.stringify(input) }),
  propose: (input) => json<AnalysisProposeResult>('/api/analysis/propose', { method: 'POST', body: JSON.stringify(input) }),
  start: (input) => json<AnalysisSnapshot>('/api/analysis/run', { method: 'POST', body: JSON.stringify(input) }),
  read: (analysisId) => json<AnalysisSnapshot>(`/api/analysis/${encodeURIComponent(analysisId)}`, { method: 'GET' }),
  share: (analysisId) => json<AnalysisSnapshot>(`/api/share/${encodeURIComponent(analysisId)}`, { method: 'GET' }),
  intakeStatus: () => json<DatasetIntakeStatus>('/api/datasets/status', { method: 'GET' }),
  readDataset: (datasetId) => json<DatasetPreview>(`/api/datasets/${encodeURIComponent(datasetId)}`, { method: 'GET' }),
  createFromCsv: (input) => json<DatasetPreview>('/api/datasets/from-csv', { method: 'POST', body: JSON.stringify(input) }, { timeoutMs: INTAKE_TIMEOUT_MS }),
  createFromUrl: (input) => json<DatasetPreview>('/api/datasets/from-url', { method: 'POST', body: JSON.stringify(input) }, { timeoutMs: INTAKE_TIMEOUT_MS }),
}

export const PRODUCT_TITLE = 'Turn a CSV into a dashboard'
export const LOCAL_DATA_NOTE = 'This file is read in your browser and is not uploaded.'

/** Storage errors that mean "there is no live service here", not "this file is bad". */
const INTAKE_OFFLINE_CODES = new Set(['UPLOADTHING_NOT_CONFIGURED', 'DATASET_INTAKE_UNAVAILABLE', 'DATASET_UNAVAILABLE', 'ANALYSIS_STORAGE_NOT_CONFIGURED'])

const isIntakeOffline = (error: unknown): boolean => (
  (error instanceof DatasetError && INTAKE_OFFLINE_CODES.has(error.code))
  || (error instanceof Error && INTAKE_OFFLINE_CODES.has(error.message))
)

/** A dataset that lives only in this tab: charted locally, never stored or shared. */
const localDatasetPreview = (validated: ValidatedDataset, filename: string): DatasetPreview => ({
  datasetId: `local-${Date.now().toString(36)}`,
  sourceType: 'upload',
  displayName: filename.replace(/\.[^.]+$/, '') || 'Your CSV',
  byteSize: validated.byteSize,
  contentHash: 'local',
  encoding: validated.encoding,
  delimiter: validated.delimiter,
  columns: validated.columns,
  acceptedRowCount: validated.acceptedRowCount,
  previewRows: validated.rows,
  validationWarnings: validated.validationWarnings,
  publicDataWarning: LOCAL_DATA_NOTE,
})

const fixtureIdFor = (dataset?: { sourceType?: string; datasetId?: string }): string | undefined => (
  dataset?.sourceType === 'fixture' ? dataset.datasetId : undefined
)

export const hasRunnableQuery = (query: string): boolean => looksLikeJevQueryJson(query)

const shortError = (error: unknown, fallback: string) => {
  if (error instanceof DatasetError) return error.message.trim() || plainDatasetError(error.code, fallback)
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) {
    return ANALYSIS_ERROR_COPY[error.message]
      ?? DATASET_ERROR_COPY[error.message]
      ?? plainAnalysisError(error.message, fallback)
  }
  return fallback
}

const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      aria-pressed={theme === 'dark'}
      onClick={toggleTheme}
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M12 5.2a.9.9 0 0 1 .9.9v1.2a.9.9 0 1 1-1.8 0V6.1a.9.9 0 0 1 .9-.9zm0 10.6a3.8 3.8 0 1 1 0-7.6 3.8 3.8 0 0 1 0 7.6zm6.7-4.7h1.2a.9.9 0 1 1 0 1.8h-1.2a.9.9 0 1 1 0-1.8zM4.1 11.1H5.3a.9.9 0 1 1 0 1.8H4.1a.9.9 0 1 1 0-1.8zm12.9 5.2.85.85a.9.9 0 1 1-1.27 1.27l-.85-.85a.9.9 0 1 1 1.27-1.27zM6.35 5.58l.85.85A.9.9 0 1 1 5.93 7.7l-.85-.85A.9.9 0 0 1 6.35 5.58zm10.9 0a.9.9 0 0 1 1.27 1.27l-.85.85A.9.9 0 1 1 16.4 6.43zM7.2 16.3a.9.9 0 0 1 1.27 1.27l-.85.85A.9.9 0 1 1 6.35 17.15zM12 16.7a.9.9 0 0 1 .9.9v1.2a.9.9 0 1 1-1.8 0v-1.2a.9.9 0 0 1 .9-.9z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M13.2 3.2a.8.8 0 0 1 .86.98 7.2 7.2 0 1 0 5.76 5.76.8.8 0 0 1 1.5.54 8.8 8.8 0 1 1-7.64-7.64.8.8 0 0 1-.48.36z" />
        </svg>
      )}
    </button>
  )
}

const App = ({ api = defaultAnalysisApi }: { api?: AnalysisApiClient }) => {
  const [route, setRoute] = useState<AppRoute>(() => parseAppLocation())
  const shareAnalysisId = route.kind === 'share' ? route.analysisId : undefined
  const isShareView = shareAnalysisId !== undefined
  const demoId = route.kind === 'demo' ? route.demoId : undefined
  const [loadedDemo, setLoadedDemo] = useState<{ id: string, dashboard?: DemoDashboard }>()
  const demo = demoId !== undefined && loadedDemo?.id === demoId ? loadedDemo.dashboard : undefined
  const demoLoading = demoId !== undefined && loadedDemo?.id !== demoId
  const isLocal = route.kind === 'local'
  const [dataset, setDataset] = useState<DatasetPreview | undefined>()
  const [intakeStatus, setIntakeStatus] = useState<DatasetIntakeStatus>()
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | undefined>()
  const [intakeBusy, setIntakeBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [intakeError, setIntakeError] = useState<string | undefined>()
  const [intakeResetToken, setIntakeResetToken] = useState(0)
  const [shareMessage, setShareMessage] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [foldAnimate, setFoldAnimate] = useState(false)
  const [tiles, setTiles] = useState<DashboardTileModel[]>([])
  const [resumingId, setResumingId] = useState<string>()
  const [proposing, setProposing] = useState(false)
  const [runRequested, setRunRequested] = useState(false)
  const [manualShareUrl, setManualShareUrl] = useState('')
  const [storyQuestion, setStoryQuestion] = useState('')
  const routeVersion = useRef(0)

  const navigate = (href: string) => {
    routeVersion.current += 1
    setIntakeBusy(false)
    setStoryQuestion('')
    window.history.pushState({}, '', href)
    setRoute(parseAppLocation())
    window.scrollTo?.({ top: 0, behavior: 'instant' })
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setFoldAnimate(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const sync = () => {
      routeVersion.current += 1
      setIntakeBusy(false)
      setStoryQuestion('')
      setRoute(parseAppLocation())
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  useEffect(() => {
    if (shareMessage !== 'Copied') return undefined
    const timer = window.setTimeout(() => setShareMessage(''), 2500)
    return () => window.clearTimeout(timer)
  }, [shareMessage])

  useEffect(() => {
    if (isShareView || route.kind === 'demo' || !api.intakeStatus) return undefined
    let active = true
    void api.intakeStatus().then((status) => { if (active) setIntakeStatus(status) }).catch(() => {
      if (active) setIntakeStatus({ convex: false, uploadThing: false, sampleAvailable: true })
    })
    return () => { active = false }
  }, [api, isShareView, route.kind])

  useEffect(() => {
    if (demoId === undefined) return undefined
    let active = true
    void loadDemoDashboard(demoId).then((dashboard) => {
      if (active) setLoadedDemo({ id: demoId, dashboard })
    })
    return () => { active = false }
  }, [demoId])

  useEffect(() => {
    if (!shareAnalysisId) return undefined
    let active = true
    setShareLoading(true)
    setError(undefined)
    setSnapshot(undefined)
    const load = loadDemoSnapshot(shareAnalysisId).then((demoSnapshot) => demoSnapshot ?? api.share(shareAnalysisId))
    void load.then((nextSnapshot) => {
      if (active) setSnapshot(nextSnapshot)
    }).catch((readError) => {
      if (active) setError(shortError(readError, 'Could not read public snapshot'))
    }).finally(() => {
      if (active) setShareLoading(false)
    })
    return () => { active = false }
  }, [api, shareAnalysisId])

  useEffect(() => {
    if (!snapshot || snapshot.status === 'complete' || snapshot.status === 'error') return undefined
    let active = true
    let timer: number | undefined
    let failures = 0
    const poll = async () => {
      try {
        const next = await api.share(snapshot.analysisId)
        if (!active) return
        setSnapshot(next)
        failures = 0
        setError(undefined)
        if (next.status !== 'complete' && next.status !== 'error') timer = window.setTimeout(poll, 1500)
      } catch (readError) {
        if (active) {
          setError(`${shortError(readError, 'Could not read analysis progress')} Reconnecting…`)
          failures += 1
          timer = window.setTimeout(poll, Math.min(15_000, 1500 * 2 ** failures))
        }
      }
    }
    timer = window.setTimeout(poll, 250)
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer) }
  }, [api, isShareView, snapshot?.analysisId, snapshot?.status])

  const shareUrl = snapshot ? `${window.location.origin}/share/${encodeURIComponent(snapshot.analysisId)}` : ''
  const datasetId = dataset?.datasetId

  const resetIntakeForm = () => setIntakeResetToken((token) => token + 1)

  const resetRunState = () => {
    setSnapshot(undefined)
    setShareMessage('')
    setError(undefined)
    setTiles([])
    setResumingId(undefined)
    setProposing(false)
    setRunRequested(false)
    setManualShareUrl('')
  }

  const readCsvText = async (file: File): Promise<string> => {
    if (typeof file.text === 'function') return file.text()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new DatasetError('NOT_CSV', 'That does not look like a CSV.'))
      reader.readAsText(file)
    })
  }

  const applyDataset = (preview: DatasetPreview, shouldNavigate = true, local = false) => {
    resetRunState()
    resetIntakeForm()
    setIntakeError(undefined)
    setDataset(preview)
    if (shouldNavigate) navigate(local ? LOCAL_PATH : datasetHref(preview.datasetId, window.location.search))
  }

  const handleUpload = async (file: File) => {
    const version = routeVersion.current
    setIntakeBusy(true); setError(undefined); setIntakeError(undefined)
    try {
      if (file.size > CSV_MAX_BYTES) throw new DatasetError('CSV_TOO_LARGE', DATASET_ERROR_COPY.CSV_TOO_LARGE, 413)
      const csvText = await readCsvText(file)
      if (version !== routeVersion.current) return
      const validated = validateCsvText(csvText)
      // Without the live service the dashboard is still built, entirely in this tab.
      const offline = !api.createFromCsv || (intakeStatus !== undefined && (!intakeStatus.convex || !intakeStatus.uploadThing))
      if (offline) {
        applyDataset(localDatasetPreview(validated, file.name), true, true)
        return
      }
      let preview: DatasetPreview
      try {
        preview = await api.createFromCsv!({ csvText, filename: file.name })
      } catch (storeError) {
        if (!isIntakeOffline(storeError)) throw storeError
        if (version !== routeVersion.current) return
        applyDataset(localDatasetPreview(validated, file.name), true, true)
        return
      }
      if (version !== routeVersion.current) return
      applyDataset(preview)
    } catch (uploadError) {
      if (version === routeVersion.current) setIntakeError(shortError(uploadError, 'Could not use this CSV'))
    } finally { if (version === routeVersion.current) setIntakeBusy(false) }
  }

  const handleUrl = async (url: string) => {
    const version = routeVersion.current
    const trimmed = url.trim()
    if (!trimmed) {
      setIntakeError('Enter a public HTTPS CSV URL first.')
      return
    }
    setIntakeBusy(true); setError(undefined); setIntakeError(undefined)
    try {
      if (!api.createFromUrl) throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', DATASET_ERROR_COPY.UPLOADTHING_NOT_CONFIGURED, 503)
      const preview = await api.createFromUrl({ url: trimmed })
      if (version !== routeVersion.current) return
      applyDataset(preview)
    } catch (urlError) {
      if (version === routeVersion.current) setIntakeError(shortError(urlError, 'Could not use this CSV URL'))
    } finally { if (version === routeVersion.current) setIntakeBusy(false) }
  }

  useEffect(() => {
    if ((route.kind === 'land' || route.kind === 'demo') && dataset) {
      setDataset(undefined)
      resetRunState()
    }
    // A local file exists only in memory, so a reload has nothing to show.
    if (route.kind === 'local' && !dataset) {
      window.history.replaceState({}, '', landHref(window.location.search))
      setRoute(parseAppLocation())
    }
    if (route.kind !== 'dataset') return
    if (dataset?.datasetId === route.datasetId) return
    setDataset(undefined)
    resetRunState()
    setIntakeError(undefined)
    let active = true
    setIntakeBusy(true)
    const { datasetId: routeDatasetId } = route
    const load = loadFixtureDatasetPreview(routeDatasetId).then((fixture) => fixture ?? (api.readDataset
      ? api.readDataset(routeDatasetId)
      : Promise.reject(new DatasetError('DATASET_NOT_FOUND', 'Could not load this dataset.', 404))))
    void load.then((preview) => {
      if (active) applyDataset(preview, false)
    }).catch((loadError) => {
      if (active) setIntakeError(shortError(loadError, 'Could not use this CSV'))
    }).finally(() => {
      if (active) setIntakeBusy(false)
    })
    return () => { active = false }
  }, [api, dataset?.datasetId, route])

  useEffect(() => {
    if (!dataset || route.kind !== 'dataset' || dataset.datasetId !== route.datasetId || !runRequested) return undefined
    let cancelled = false
    const startTiles = (proposed: InsightProposal[]) => {
      if (cancelled) return
      setProposing(false)
      setTiles(proposed.map((insight) => ({ insight, starting: true, startedAt: Date.now() })))
      for (const insight of proposed) {
        void (async () => {
          try {
            let nextQuery = queryFromInsight(insight)
            if (!hasRunnableQuery(nextQuery)) {
              const result = await api.draft({
                datasetId: dataset.datasetId,
                fixtureId: fixtureIdFor(dataset),
                task: insight.question || insight.task,
              })
              nextQuery = formatDraftQueryForEditor({
                query: result.query,
                questionKind: result.metadata.questionKind,
                classes: result.metadata.classes,
              })
            }
            const parsed = parseJevQueryJson(nextQuery)
            if (!parsed) throw new Error('Could not start Jev analysis')
            if (cancelled) return
            const started = await api.start({
              datasetId: dataset.datasetId,
              fixtureId: fixtureIdFor(dataset),
              query: nextQuery.trim(),
              classes: classesFromJevQuery(parsed),
              questionKind: parsed.type,
            })
            if (cancelled) return
            setTiles((current) => current.map((tile) => (
              tile.insight.id === insight.id
                ? { ...tile, snapshot: started, starting: false, latencyHint: started.status === 'complete' ? 'saved' : 'live', error: undefined }
                : tile
            )))
          } catch (startError) {
            if (cancelled) return
            setTiles((current) => current.map((tile) => (
              tile.insight.id === insight.id
                ? { ...tile, starting: false, error: shortError(startError, 'Could not start Jev analysis'), retryable: true }
                : tile
            )))
          }
        })()
      }
    }

    const heuristic = proposeInsights(dataset)
    if (hasNamedHeuristicCuts(heuristic)) {
      startTiles(heuristic)
      return () => { cancelled = true }
    }

    setTiles([])
    setProposing(true)
    const finishEmpty = () => {
      if (cancelled) return
      setTiles([])
      setProposing(false)
    }

    if (!api.propose) {
      startTiles(heuristic)
      if (heuristic.length === 0) finishEmpty()
      return () => { cancelled = true }
    }

    void api.propose({
      datasetId: dataset.datasetId,
      fixtureId: fixtureIdFor(dataset),
    }).then((result) => {
      if (cancelled) return
      const packed = mergeDashboardInsights(heuristic, sanitizeLlmInsightProposals(result.insights, dataset), dataset)
      if (packed.length === 0) {
        finishEmpty()
        return
      }
      startTiles(packed)
    }).catch(() => {
      if (heuristic.length > 0) startTiles(heuristic)
      else finishEmpty()
    })
    return () => { cancelled = true }
  }, [api, dataset, route, runRequested])

  const liveTileKey = tiles
    .map((tile) => `${tile.insight.id}:${tile.snapshot?.analysisId ?? ''}:${tile.snapshot?.status ?? ''}`)
    .join('|')

  useEffect(() => {
    const live = tiles.filter((tile) => (
      tile.snapshot && tile.snapshot.status !== 'complete' && tile.snapshot.status !== 'error'
    ))
    if (live.length === 0) return undefined
    let active = true
    let timer: number | undefined
    const poll = async () => {
      const updates = await Promise.all(live.map(async (tile) => {
        try {
          const next = await api.read(tile.snapshot!.analysisId)
          return { id: tile.insight.id, snapshot: next }
        } catch (readError) {
          return { id: tile.insight.id, error: shortError(readError, 'Could not read analysis progress') }
        }
      }))
      if (!active) return
      setTiles((current) => current.map((tile) => {
        const update = updates.find((item) => item.id === tile.insight.id)
        if (!update) return tile
        return {
          ...tile,
          snapshot: update.snapshot ?? tile.snapshot,
          error: 'error' in update ? update.error : undefined,
        }
      }))
      const stillLive = updates.some((update) => update.error || update.snapshot?.status === 'queued' || update.snapshot?.status === 'running')
      if (stillLive) timer = window.setTimeout(() => { void poll() }, updates.some((update) => update.error) ? 5000 : 1500)
    }
    timer = window.setTimeout(() => { void poll() }, 250)
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer) }
  }, [api, liveTileKey])

  const handleResumeTile = async (insightId: string) => {
    const tile = tiles.find((item) => item.insight.id === insightId)
    if (!tile || !dataset?.datasetId || (tile.snapshot && (tile.snapshot.status !== 'error' || !tile.snapshot.error?.retryable))) return
    setResumingId(insightId)
    const version = routeVersion.current
    try {
      let nextQuery = tile.snapshot?.query ?? queryFromInsight(tile.insight)
      if (!hasRunnableQuery(nextQuery)) {
        const drafted = await api.draft({ datasetId: dataset.datasetId, fixtureId: fixtureIdFor(dataset), task: tile.insight.task })
        nextQuery = formatDraftQueryForEditor({ query: drafted.query, questionKind: drafted.metadata.questionKind, classes: drafted.metadata.classes })
      }
      const parsed = parseJevQueryJson(nextQuery)
      if (!parsed) throw new Error('Could not start this analysis. Try another insight.')
      if (version !== routeVersion.current) return
      const started = await api.start({
        datasetId: dataset.datasetId,
        fixtureId: fixtureIdFor(dataset),
        query: nextQuery,
        classes: classesFromJevQuery(parsed),
        questionKind: parsed.type,
        ...(tile.snapshot ? { analysisId: tile.snapshot.analysisId, resume: true } : {}),
      })
      if (version !== routeVersion.current) return
      setTiles((current) => current.map((item) => (
        item.insight.id === insightId
          ? { ...item, snapshot: started, error: undefined, latencyHint: started.status === 'complete' ? 'saved' : 'live' }
          : item
      )))
    } catch (runError) {
      if (version !== routeVersion.current) return
      setTiles((current) => current.map((item) => (
        item.insight.id === insightId
          ? { ...item, error: shortError(runError, 'Could not resume Jev analysis') }
          : item
      )))
    } finally {
      if (version === routeVersion.current) setResumingId(undefined)
    }
  }

  const copyShareUrl = useCallback(async (analysisId?: string) => {
    const id = analysisId ?? snapshot?.analysisId
    if (!id) return
    const url = `${window.location.origin}${id.startsWith('demo-') ? `/demo/${id.slice(5)}` : `/share/${encodeURIComponent(id)}`}`
    if (await copyText(url)) { setShareMessage('Copied'); setManualShareUrl('') }
    else { setShareMessage('Copy link below'); setManualShareUrl(url) }
  }, [snapshot?.analysisId])

  const copyDashboardUrl = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}`
    if (await copyText(url)) { setShareMessage('Copied'); setManualShareUrl('') }
    else { setShareMessage('Copy link below'); setManualShareUrl(url) }
  }, [])

  const activeDataset = demo?.dataset ?? dataset
  const story = useMemo(() => (
    activeDataset
      ? buildStoryDashboard(activeDataset.columns.map((column) => column.name), activeDataset.previewRows, { noun: demo?.noun, question: storyQuestion })
      : undefined
  ), [activeDataset, demo?.noun, storyQuestion])
  const showIntake = !isShareView && !activeDataset && !demoLoading
  const showShape = !isShareView && Boolean(activeDataset)
  // Jev runs read rows from stored datasets, so they need the live service.
  const canAskJev = !demo && !isLocal
  const showRun = Boolean(snapshot) && isShareView
  const stage = isShareView ? 'share' : activeDataset ? 'dataset' : 'intake'
  const landing = route.kind === 'land'
  const demoShare = shareAnalysisId !== undefined && isDemoAnalysisId(shareAnalysisId)
  // A demo replay returns to its dashboard; everything else returns to the start.
  const backHref = demoShare ? `/demo/${shareAnalysisId!.slice(5)}` : landHref(window.location.search)
  const goBack = () => {
    if (!demoShare) {
      setDataset(undefined)
      resetRunState()
      setIntakeError(undefined)
      resetIntakeForm()
    }
    navigate(backHref)
  }
  const pageTitle = isShareView
    ? 'Saved analysis'
    : activeDataset?.displayName ?? demoDatasets.find((item) => item.id === demoId)?.name ?? 'Dataset'

  return (
    <main className="analysis-shell" data-stage={stage}>
      <header className="site-header">
        <div className="site-header-actions">
          <ThemeToggle />
        </div>
      </header>
      {landing ? <h1 id="page-title" className="sr-only">{PRODUCT_TITLE}</h1> : (
        <section className="page-head" aria-labelledby="page-title">
          <div className="page-head-text">
            <a className="page-back" href={backHref} onClick={(event) => { event.preventDefault(); goBack() }}><span aria-hidden="true">←</span> Back</a>
            <h1 id="page-title">{pageTitle}</h1>
            {activeDataset ? <p className="page-meta">{formatCount(activeDataset.acceptedRowCount)} rows <span aria-hidden="true">·</span> {activeDataset.columns.length} columns</p> : null}
          </div>
          {demo && route.kind === 'demo' && route.demoId === 'football' ? (
            <Button variant="secondary" onClick={() => navigate('/share/demo-football')}>Replay timeline <ArrowUpRight /></Button>
          ) : null}
        </section>
      )}
      <div className="workspace">
        <StageFold open={showIntake} animate={foldAnimate}>
          <DatasetIntake
            status={intakeStatus}
            intakeError={intakeError}
            resetToken={intakeResetToken}
            disabled={intakeBusy}
            onUploadFile={(file) => void handleUpload(file)}
            onSubmitUrl={(url) => void handleUrl(url)}
          />
          {landing ? <DemoPicker onOpen={(id) => navigate(`/demo/${id}`)} /> : null}
        </StageFold>
        <StageFold open={showShape} animate={foldAnimate}>
          {activeDataset ? (
            <div className="stage-stack">
              {demo ? <p className="demo-disclosure">{demo.disclosure}</p> : null}
              {isLocal ? <p className="demo-disclosure">{LOCAL_DATA_NOTE} There is no link to share, and closing or reloading the tab clears it.</p> : null}
              {story ? (
                <StoryDashboard
                  key={activeDataset.datasetId}
                  dashboard={story}
                  question={storyQuestion}
                  onAsk={setStoryQuestion}
                  shareLabel={shareMessage}
                  onShare={isLocal ? undefined : () => void copyDashboardUrl()}
                />
              ) : null}
              {canAskJev ? (
                <section className="stage-stack" aria-labelledby="jev-heading">
                  <div className="jev-section-heading">
                    <h2 id="jev-heading">Go further with Jev</h2>
                    <p>The dashboard above is computed from your columns. Jev reads each row with a model, for questions the columns cannot answer on their own.</p>
                  </div>
                  {!runRequested ? <div className="analysis-confirm"><div><h3>Have Jev read every row?</h3><p>Runs up to 4 model insights across {formatCount(activeDataset.acceptedRowCount)} rows. Each insight may use up to {formatCount(activeDataset.acceptedRowCount * 2)} model calls, including retries. Results are public.</p></div><Button variant="run" onClick={() => setRunRequested(true)}>Analyze dataset <ArrowUpRight /></Button></div> : (
                    <DatasetDashboard
                      tiles={tiles}
                      proposing={proposing}
                      sourceRows={activeDataset.previewRows}
                      onResume={(insightId) => void handleResumeTile(insightId)}
                      resumingId={resumingId}
                      shareMessage={shareMessage}
                      onCopyShare={(analysisId) => void copyShareUrl(analysisId)}
                    />
                  )}
                </section>
              ) : null}
              <SchemaStrip dataset={activeDataset} />
              <DatasetPreviewCard dataset={activeDataset} />
            </div>
          ) : null}
        </StageFold>
        {manualShareUrl ? <div className="share-fallback" role="status"><Label htmlFor="share-url">Copy this public link</Label><input id="share-url" readOnly value={manualShareUrl} onFocus={(event) => event.currentTarget.select()} /><a href={manualShareUrl} target="_blank" rel="noreferrer">Open link <ArrowUpRight /></a></div> : null}
        {demoShare ? <p className="demo-disclosure">{demoReplayDisclosure(shareAnalysisId!)}</p> : null}
        {isShareView && shareLoading && <p className="empty-copy" role="status">Loading public snapshot…</p>}
        {isShareView && error && (
          <div className="error-banner" role="alert">
            <b>Public snapshot unavailable</b>
            <span>{error}</span>
          </div>
        )}
        <StageFold open={showRun} animate={foldAnimate}>
          {snapshot ? (
            <AnalysisRunView
              snapshot={snapshot}
              shareUrl={shareUrl}
              shareMessage={shareMessage}
              onCopyShare={() => void copyShareUrl()}
            />
          ) : null}
        </StageFold>
      </div>
    </main>
  )
}

export { App }
