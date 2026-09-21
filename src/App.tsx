import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnalysisRunView } from './components/AnalysisRunView'
import { DatasetIntake } from './components/DatasetIntake'
import { DatasetPreviewCard } from './components/DatasetPreview'
import { InsightCards } from './components/InsightCards'
import { SchemaStrip } from './components/SchemaStrip'
import { StageFold } from './components/StageFold'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from './components/ui/card'
import { Label } from './components/ui/label'
import { Textarea } from './components/ui/textarea'
import { getFixtureDatasetPreview, getSampleDatasetPreview } from './dataset/sampleDataset'
import { proposeInsights, type InsightProposal } from './dataset/insight'
import { DatasetError, DATASET_ERROR_COPY, plainDatasetError } from './dataset/csvTypes'
import { validateCsvText } from './dataset/validateDataset'
import type {
  AnalysisDraftResult,
  AnalysisSnapshot,
} from './shared/analysis'
import {
  INVALID_CLASSES_COPY,
} from './shared/questionKind'
import {
  classesFromJevQuery,
  formatDraftQueryForEditor,
  looksLikeJevQueryJson,
  parseJevQueryJson,
} from './shared/jevQuery'
import type { DatasetIntakeStatus, DatasetPreview } from './shared/dataset'
import { ANALYSIS_ERROR_COPY, plainAnalysisError, runSubsetCopy } from './runView/format'
import { useTheme } from './theme'
import './styles.css'

export const INTAKE_TIMEOUT_MS = 45_000

export interface AnalysisApiClient {
  draft: (input: { fixtureId?: string; datasetId?: string; task: string }) => Promise<AnalysisDraftResult>
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
  const timeoutMs = options.timeoutMs
  const controller = timeoutMs ? new AbortController() : undefined
  const timer = timeoutMs ? window.setTimeout(() => controller?.abort(), timeoutMs) : undefined
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller?.signal ?? init.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    if (!response.ok) throw await apiError(response)
    return response.json() as Promise<T>
  } catch (error) {
    if (isAbortError(error)) {
      throw new DatasetError('URL_TIMEOUT', 'This CSV took too long to load. Try a smaller file or another URL.', 504)
    }
    throw error
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

export const defaultAnalysisApi: AnalysisApiClient = {
  draft: (input) => json<AnalysisDraftResult>('/api/analysis/draft', { method: 'POST', body: JSON.stringify(input) }),
  start: (input) => json<AnalysisSnapshot>('/api/analysis/run', { method: 'POST', body: JSON.stringify(input) }),
  read: (analysisId) => json<AnalysisSnapshot>(`/api/analysis/${encodeURIComponent(analysisId)}`, { method: 'GET' }),
  share: (analysisId) => json<AnalysisSnapshot>(`/api/share/${encodeURIComponent(analysisId)}`, { method: 'GET' }),
  intakeStatus: () => json<DatasetIntakeStatus>('/api/datasets/status', { method: 'GET' }),
  createFromCsv: (input) => json<DatasetPreview>('/api/datasets/from-csv', { method: 'POST', body: JSON.stringify(input) }, { timeoutMs: INTAKE_TIMEOUT_MS }),
  createFromUrl: (input) => json<DatasetPreview>('/api/datasets/from-url', { method: 'POST', body: JSON.stringify(input) }, { timeoutMs: INTAKE_TIMEOUT_MS }),
}

const DEFAULT_TASK = 'Classify each row using the visible columns.'
export const PRODUCT_TITLE = 'Dynamic insights from your data.'
export const ENGINEER_MODE_PARAM = 'mode'
export const ENGINEER_MODE_VALUE = 'engineer'

const fixtureIdFor = (dataset?: { sourceType?: string; datasetId?: string }): string | undefined => (
  dataset?.sourceType === 'fixture' ? dataset.datasetId : undefined
)

export const isEngineerMode = (search = typeof window === 'undefined' ? '' : window.location.search): boolean => (
  new URLSearchParams(search.startsWith('?') || search.length === 0 ? search : `?${search}`).get(ENGINEER_MODE_PARAM) === ENGINEER_MODE_VALUE
)

const engineerHref = (on: boolean): string => {
  const path = typeof window === 'undefined' ? '/' : window.location.pathname || '/'
  const hash = typeof window === 'undefined' ? '' : window.location.hash
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
  if (on) params.set(ENGINEER_MODE_PARAM, ENGINEER_MODE_VALUE)
  else params.delete(ENGINEER_MODE_PARAM)
  const query = params.toString()
  return `${path}${query ? `?${query}` : ''}${hash}`
}

const queryFromInsight = (insight: InsightProposal): string => (
  formatDraftQueryForEditor({
    query: insight.cannedQuery ?? insight.task,
    questionKind: insight.questionKind,
    classes: insight.classes,
  })
)

export const hasRunnableQuery = (query: string): boolean => looksLikeJevQueryJson(query)

export const canConfirmJevRun = ({ query, starting }: { query: string; starting: boolean }): boolean =>
  hasRunnableQuery(query) && !starting

export const queryRunFooter = ({
  query,
  starting,
  hasSnapshot,
}: {
  query: string
  starting: boolean
  hasSnapshot: boolean
}): string | undefined => {
  if (starting) return 'Starting…'
  if (hasSnapshot) return undefined
  if (hasRunnableQuery(query)) return undefined
  if (query.trim().length > 0) return 'Valid Jev JSON required.'
  return 'Enter Jev query JSON before running.'
}

const shortError = (error: unknown, fallback: string) => {
  if (error instanceof DatasetError) return error.message.trim() || plainDatasetError(error.code, fallback)
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) {
    return ANALYSIS_ERROR_COPY[error.message]
      ?? DATASET_ERROR_COPY[error.message]
      ?? plainAnalysisError(error.message, fallback)
  }
  return fallback
}

const sharePathId = (): string | undefined => {
  if (typeof window === 'undefined') return undefined
  const match = window.location.pathname.match(/^\/share\/([^/]+)\/?$/)
  if (!match) return undefined
  try { return decodeURIComponent(match[1]) } catch { return undefined }
}

const Thinking = ({ children }: { children: string }) => (
  <p className="thinking" role="status">
    <span className="thinking-dot" aria-hidden="true" />
    {children}
  </p>
)

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
  const shareAnalysisId = sharePathId()
  const isShareView = shareAnalysisId !== undefined
  const [dataset, setDataset] = useState<DatasetPreview | undefined>()
  const [intakeStatus, setIntakeStatus] = useState<DatasetIntakeStatus>()
  const [task, setTask] = useState(DEFAULT_TASK)
  const [draft, setDraft] = useState<AnalysisDraftResult | undefined>()
  const [query, setQuery] = useState('')
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | undefined>()
  const [drafting, setDrafting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [intakeBusy, setIntakeBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [intakeError, setIntakeError] = useState<string | undefined>()
  const [intakeResetToken, setIntakeResetToken] = useState(0)
  const [shareMessage, setShareMessage] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [queryCopyMessage, setQueryCopyMessage] = useState('')
  const [foldAnimate, setFoldAnimate] = useState(false)
  const [runLatency, setRunLatency] = useState<'saved' | 'live' | undefined>()
  const [selectedInsight, setSelectedInsight] = useState<InsightProposal | undefined>()
  const [jsonOpen, setJsonOpen] = useState(() => isEngineerMode())
  const [insightRunning, setInsightRunning] = useState(false)
  const [insightVisual, setInsightVisual] = useState<InsightProposal['visual'] | undefined>()
  const [engineerMode, setEngineerMode] = useState(() => isEngineerMode())

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setFoldAnimate(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const sync = () => {
      const next = isEngineerMode()
      setEngineerMode(next)
      setJsonOpen(next)
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
    if (isShareView || !api.intakeStatus) return undefined
    let active = true
    void api.intakeStatus().then((status) => { if (active) setIntakeStatus(status) }).catch(() => {
      if (active) setIntakeStatus({ convex: false, uploadThing: false, sampleAvailable: true })
    })
    return () => { active = false }
  }, [api, isShareView])

  useEffect(() => {
    if (!shareAnalysisId) return undefined
    let active = true
    setShareLoading(true)
    setError(undefined)
    setSnapshot(undefined)
    setDraft(undefined)
    void api.share(shareAnalysisId).then((nextSnapshot) => {
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
    const poll = async () => {
      try {
        const next = await (isShareView ? api.share(snapshot.analysisId) : api.read(snapshot.analysisId))
        if (!active) return
        setSnapshot(next)
        if (next.status !== 'complete' && next.status !== 'error') timer = window.setTimeout(poll, 350)
      } catch (readError) {
        if (active) setError(shortError(readError, 'Could not read analysis progress'))
      }
    }
    timer = window.setTimeout(poll, 250)
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer) }
  }, [api, isShareView, snapshot?.analysisId, snapshot?.status])

  const shareUrl = snapshot ? `${window.location.origin}/share/${encodeURIComponent(snapshot.analysisId)}` : ''
  const datasetId = dataset?.datasetId

  const resetIntakeForm = () => setIntakeResetToken((token) => token + 1)

  const resetRunState = () => {
    setDraft(undefined)
    setQuery('')
    setSnapshot(undefined)
    setShareMessage('')
    setQueryCopyMessage('')
    setError(undefined)
    setRunLatency(undefined)
    setSelectedInsight(undefined)
    setJsonOpen(engineerMode)
    setInsightRunning(false)
    setInsightVisual(undefined)
  }

  const handleDraft = async () => {
    if (!datasetId) { setError('Choose a dataset first.'); return }
    if (!task.trim()) { setError('Enter a task before drafting a query.'); return }
    setDrafting(true); setError(undefined); setIntakeError(undefined); setDraft(undefined); setQuery(''); setQueryCopyMessage(''); setShareMessage('')
    try {
      const result = await api.draft({ datasetId, fixtureId: fixtureIdFor(dataset), task: task.trim() })
      setDraft(result)
      setQuery(formatDraftQueryForEditor({
        query: result.query,
        questionKind: result.metadata.questionKind,
        classes: result.metadata.classes,
      }))
    } catch (draftError) { setError(shortError(draftError, 'Could not draft a Jev query'))
    } finally { setDrafting(false) }
  }

  const handleRun = async (nextQuery = query) => {
    if (!hasRunnableQuery(nextQuery) || !datasetId) return
    const parsed = parseJevQueryJson(nextQuery)
    if (!parsed) return
    setStarting(true); setError(undefined); setIntakeError(undefined); setShareMessage(''); setRunLatency(undefined)
    try {
      const started = await api.start({
        datasetId,
        fixtureId: fixtureIdFor(dataset),
        query: nextQuery.trim(),
        classes: classesFromJevQuery(parsed),
        questionKind: parsed.type,
      })
      setRunLatency(started.status === 'complete' ? 'saved' : 'live')
      setSnapshot(started)
    } catch (runError) { setError(shortError(runError, 'Could not start Jev analysis'))
    } finally { setStarting(false) }
  }

  const selectInsight = (insight: InsightProposal) => {
    setSelectedInsight(insight)
    setTask(insight.task)
    const nextQuery = queryFromInsight(insight)
    if (hasRunnableQuery(nextQuery)) setQuery(nextQuery)
  }

  const handleRunInsight = async (insight: InsightProposal) => {
    if (!datasetId) { setError('Choose a dataset first.'); return }
    selectInsight(insight)
    setInsightVisual(insight.visual)
    const nextQuery = queryFromInsight(insight)
    setInsightRunning(true); setError(undefined); setIntakeError(undefined); setQueryCopyMessage(''); setShareMessage('')
    try {
      if (hasRunnableQuery(nextQuery)) {
        await handleRun(nextQuery)
        return
      }
      setDrafting(true)
      const result = await api.draft({ datasetId, fixtureId: fixtureIdFor(dataset), task: insight.task })
      setDraft(result)
      const drafted = formatDraftQueryForEditor({
        query: result.query,
        questionKind: result.metadata.questionKind,
        classes: result.metadata.classes,
      })
      setQuery(drafted)
      setDrafting(false)
      await handleRun(drafted)
    } catch (draftError) {
      setDrafting(false)
      setError(shortError(draftError, 'Could not draft a Jev query'))
    } finally {
      setInsightRunning(false)
    }
  }

  const handleResume = async () => {
    if (!snapshot || snapshot.status !== 'error' || !datasetId) return
    setStarting(true); setError(undefined); setIntakeError(undefined); setShareMessage(''); setRunLatency('live')
    try {
      const started = await api.start({
        datasetId,
        fixtureId: fixtureIdFor(dataset),
        query: snapshot.query,
        classes: [...snapshot.classes],
        questionKind: snapshot.questionKind,
        analysisId: snapshot.analysisId,
        resume: true,
      })
      setRunLatency(started.status === 'complete' ? 'saved' : 'live')
      setSnapshot(started)
    } catch (runError) { setError(shortError(runError, 'Could not resume Jev analysis'))
    } finally { setStarting(false) }
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

  const applyDataset = (preview: DatasetPreview, preferredTask?: string) => {
    resetRunState()
    resetIntakeForm()
    setIntakeError(undefined)
    setDataset(preview)
    const insights = proposeInsights(preview)
    const insight = insights[0]
    setSelectedInsight(insight)
    const nextTask = preferredTask ?? insight?.task ?? DEFAULT_TASK
    setTask(nextTask)
    if (insight) {
      const nextQuery = queryFromInsight(insight)
      if (hasRunnableQuery(nextQuery)) setQuery(nextQuery)
    }
  }

  const handleUpload = async (file: File) => {
    setIntakeBusy(true); setError(undefined); setIntakeError(undefined)
    try {
      const csvText = await readCsvText(file)
      validateCsvText(csvText)
      if (!api.createFromCsv) throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', DATASET_ERROR_COPY.UPLOADTHING_NOT_CONFIGURED, 503)
      const preview = await api.createFromCsv({ csvText, filename: file.name })
      applyDataset(preview)
    } catch (uploadError) {
      setIntakeError(shortError(uploadError, 'Could not use this CSV'))
    } finally { setIntakeBusy(false) }
  }

  const handleUrl = async (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) {
      setIntakeError('Enter a public HTTPS CSV URL first.')
      return
    }
    setIntakeBusy(true); setError(undefined); setIntakeError(undefined)
    try {
      if (!api.createFromUrl) throw new DatasetError('UPLOADTHING_NOT_CONFIGURED', DATASET_ERROR_COPY.UPLOADTHING_NOT_CONFIGURED, 503)
      const preview = await api.createFromUrl({ url: trimmed })
      applyDataset(preview)
    } catch (urlError) {
      setIntakeError(shortError(urlError, 'Could not use this CSV URL'))
    } finally { setIntakeBusy(false) }
  }

  const handleSample = (datasetId: string) => {
    const preview = getFixtureDatasetPreview(datasetId) ?? getSampleDatasetPreview()
    applyDataset(preview)
  }

  const copyShareUrl = useCallback(async () => {
    if (!shareUrl) return
    try { await navigator.clipboard?.writeText(shareUrl); setShareMessage('Copied')
    } catch { setShareMessage('Share URL ready') }
  }, [shareUrl])

  const copyQuery = useCallback(async () => {
    if (!query.trim()) return
    try {
      await navigator.clipboard?.writeText(query)
      setQueryCopyMessage('Copied')
    } catch {
      setQueryCopyMessage('Copy failed')
    }
  }, [query])

  const insights = useMemo(() => (dataset ? proposeInsights(dataset) : []), [dataset])
  const showIntake = !isShareView
  const showShape = !isShareView && Boolean(dataset)
  const showAdvanced = showShape && engineerMode
  const showRun = Boolean(snapshot)
  const toggleEngineerMode = () => {
    const next = !engineerMode
    window.history.pushState({}, '', engineerHref(next))
    setEngineerMode(next)
    setJsonOpen(next)
  }
  const canRun = Boolean(datasetId && canConfirmJevRun({ query, starting: starting || drafting }))
  const parsedQuery = parseJevQueryJson(query)
  const querySummary = parsedQuery?.instructions
  const queryInvalid = query.trim().length > 0 && !parsedQuery
  const runFooter = queryRunFooter({ query, starting: starting || drafting, hasSnapshot: Boolean(snapshot) })
  const subsetCopy = draft
    ? runSubsetCopy({
      analyzedRows: draft.metadata.rowCount,
      datasetRows: dataset?.acceptedRowCount,
      sourceType: draft.sourceType,
      inputHalf: draft.metadata.inputHalf,
    })
    : undefined
  const choiceClasses = parsedQuery?.type === 'choice' ? Object.keys(parsedQuery.criteria) : []
  const stage = isShareView ? 'share' : snapshot ? 'run' : dataset ? 'shape' : 'intake'

  return (
    <main className="analysis-shell" data-stage={stage} data-mode={engineerMode ? 'engineer' : 'product'}>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Jev home">Jev</a>
        <div className="site-header-actions">
          <ThemeToggle />
        </div>
      </header>
      <section className="hero" aria-labelledby="page-title">
        <h1 id="page-title">{isShareView ? 'Inspect a saved run.' : PRODUCT_TITLE}</h1>
        {isShareView ? <p className="hero-copy">A saved Jev run, replayed from stored predictions.</p> : null}
      </section>
      <div className="workspace">
        <StageFold open={showIntake} animate={foldAnimate}>
          <DatasetIntake
            status={intakeStatus}
            intakeError={intakeError}
            resetToken={intakeResetToken}
            disabled={intakeBusy}
            onUploadFile={(file) => void handleUpload(file)}
            onSubmitUrl={(url) => void handleUrl(url)}
            onTrySample={handleSample}
          />
        </StageFold>
        <StageFold open={showShape} animate={foldAnimate}>
          {dataset ? (
            <div className="stage-stack">
              <SchemaStrip dataset={dataset} />
              <DatasetPreviewCard dataset={dataset} onChange={() => { setDataset(undefined); resetRunState(); setIntakeError(undefined); resetIntakeForm() }} />
              <InsightCards
                insights={insights}
                selectedId={selectedInsight?.id}
                running={insightRunning}
                onSelect={selectInsight}
                onRun={(insight) => void handleRunInsight(insight)}
              />
            </div>
          ) : null}
        </StageFold>
        <StageFold open={showAdvanced} animate={foldAnimate}>
          {dataset && engineerMode ? (
            <details className="advanced-json query-card" open={jsonOpen} onToggle={(event) => setJsonOpen((event.currentTarget as HTMLDetailsElement).open)}>
              <summary className="advanced-json-summary">Edit Jev JSON</summary>
              <Card className="query-card advanced-json-body">
                <CardHeader className="section-heading flex-row items-start justify-between space-y-0">
                  <div>
                    <p className="eyebrow">Advanced</p>
                    <h2 id="query-heading">Jev query</h2>
                  </div>
                  {drafting ? <Badge variant="running">Drafting</Badge> : null}
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2">
                    <Label htmlFor="analysis-task">Analysis task</Label>
                    <Textarea
                      id="analysis-task"
                      value={task}
                      onChange={(event) => setTask(event.target.value)}
                      rows={2}
                      placeholder="What should Jev answer per row?"
                    />
                  </div>
                  {querySummary ? <p className="query-summary">{querySummary}</p> : null}
                  {subsetCopy ? <p className="query-scope" role="status">{subsetCopy}</p> : null}
                  {choiceClasses.length >= 2 ? (
                    <ul className="class-chips" aria-label="Choice classes">
                      {choiceClasses.map((name) => (
                        <li key={name} className="class-chip">{name}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="grid gap-2 min-w-0">
                    <div className="query-editor-head">
                      <Label htmlFor="jev-query">Jev query JSON</Label>
                      <Button variant="ghost" size="sm" type="button" onClick={() => void copyQuery()} disabled={!query.trim()}>
                        {queryCopyMessage || 'Copy'}
                      </Button>
                    </div>
                    <Textarea
                      id="jev-query"
                      className="query-json"
                      value={query}
                      onChange={(event) => { setQuery(event.target.value); setQueryCopyMessage('') }}
                      rows={10}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      aria-invalid={queryInvalid || undefined}
                    />
                  </div>
                  {drafting ? <Thinking>Drafting query…</Thinking> : null}
                  {starting ? <Thinking>Starting run…</Thinking> : null}
                </CardContent>
                <CardFooter className="form-footer">
                  {runFooter ? <span>{runFooter}</span> : null}
                  <Button type="button" variant="secondary" onClick={() => void handleDraft()} disabled={drafting}>
                    {drafting ? 'Drafting…' : 'Draft task'}
                  </Button>
                  <Button
                    className="run-button"
                    variant="run"
                    type="button"
                    onClick={() => void handleRun()}
                    disabled={!canRun}
                  >
                    {starting ? 'Starting…' : 'Run Jev'}
                  </Button>
                </CardFooter>
              </Card>
            </details>
          ) : null}
        </StageFold>
        {!isShareView && error && (dataset || !showIntake) && (
          <div className="error-banner" role="alert">
            <b>{error === INVALID_CLASSES_COPY ? "Couldn't draft" : "Couldn't run"}</b>
            <span>{error}</span>
          </div>
        )}
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
              onCopyShare={copyShareUrl}
              onResume={isShareView ? undefined : () => void handleResume()}
              resuming={starting}
              datasetRowCount={dataset?.acceptedRowCount}
              inputHalf={draft?.metadata.inputHalf}
              latencyHint={isShareView ? undefined : runLatency}
              chartKind={insightVisual}
              sourceRows={dataset?.previewRows}
            />
          ) : null}
        </StageFold>
      </div>
      {!isShareView ? (
        <footer className="site-footer">
          <a
            className="engineer-link"
            href={engineerHref(!engineerMode)}
            onClick={(event) => {
              event.preventDefault()
              toggleEngineerMode()
            }}
          >
            {engineerMode ? 'Product' : 'Engineer'}
          </a>
        </footer>
      ) : null}
    </main>
  )
}

export { App }
