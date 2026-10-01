import { useEffect, useState } from 'react'
import { ApiClientError, type PlaygroundApi } from '../api/client'
import { Composer, type ComposerValue } from '../components/Composer'
import { DatasetIntake } from '../components/DatasetIntake'
import { DatasetPreviewCard } from '../components/DatasetPreview'
import { AlertIcon } from '../components/Icons'
import { CSV_MAX_BYTES, DatasetError } from '../dataset/csvTypes'
import { samplePreview } from '../dataset/sampleDataset'
import { validateCsvBytes } from '../dataset/validateDataset'
import { formatCount } from '../run/metrics'
import type { DatasetPreview, PlaygroundStatus } from '../shared/dataset'
import { rememberControlToken } from '../state/controlTokens'

const EMPTY_COMPOSER: ComposerValue = { task: '', query: '', classes: [{ name: '', description: '' }, { name: '', description: '' }] }

const messageOf = (error: unknown, fallback: string): string => (
  error instanceof ApiClientError || error instanceof DatasetError ? error.message : fallback
)

export const Workbench = ({ api, status, onStarted }: { api: PlaygroundApi; status: PlaygroundStatus | undefined; onStarted: (analysisId: string) => void }) => {
  const [dataset, setDataset] = useState<DatasetPreview>()
  const [labelColumn, setLabelColumn] = useState('')
  const [composer, setComposer] = useState<ComposerValue>(EMPTY_COMPOSER)
  const [intakeBusy, setIntakeBusy] = useState<'upload' | 'url'>()
  const [drafting, setDrafting] = useState(false)
  const [draftNote, setDraftNote] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => { if (dataset) window.scrollTo({ top: 0 }) }, [dataset])

  const choose = (next: DatasetPreview) => {
    setDataset(next)
    setError(undefined)
    setDraftNote(undefined)
    setLabelColumn(next.suggestion?.labelColumn ?? '')
    setComposer(next.suggestion
      ? { task: next.suggestion.task, query: next.suggestion.query, classes: next.suggestion.classes.map((item) => ({ ...item })) }
      : EMPTY_COMPOSER)
  }

  const handleFile = async (file: File) => {
    setError(undefined)
    if (file.size > CSV_MAX_BYTES) { setError(`That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${CSV_MAX_BYTES / (1024 * 1024)} MB.`); return }
    setIntakeBusy('upload')
    try {
      // Parse locally first: bad files fail instantly and never leave the browser.
      const checked = validateCsvBytes(new Uint8Array(await file.arrayBuffer()))
      if (status && checked.acceptedRowCount > status.limits.maxRows) throw new DatasetError('CSV_TOO_MANY_ROWS', `That file has ${formatCount(checked.acceptedRowCount)} rows. This playground runs at most ${formatCount(status.limits.maxRows)}.`, 413)
      choose(await api.uploadCsv(file, file.name))
    } catch (uploadError) {
      setError(messageOf(uploadError, 'We could not read that file.'))
    } finally {
      setIntakeBusy(undefined)
    }
  }

  const handleUrl = async (url: string) => {
    setError(undefined)
    setIntakeBusy('url')
    try {
      choose(await api.datasetFromUrl(url))
    } catch (urlError) {
      setError(messageOf(urlError, 'We could not fetch that link.'))
    } finally {
      setIntakeBusy(undefined)
    }
  }

  const handleDraft = async () => {
    if (!dataset) return
    setDrafting(true); setError(undefined)
    try {
      const draft = await api.draft({ datasetId: dataset.datasetId, task: composer.task.trim(), ...(labelColumn ? { labelColumn } : {}) })
      setComposer((current) => ({ ...current, query: draft.query, classes: draft.classes }))
      setDraftNote(draft.mode === 'mock' ? 'Simulated draft. No drafting model is connected, so this is a template. Edit it freely.' : `Drafted by ${draft.model}. Edit anything before you run.`)
    } catch (draftError) {
      setError(messageOf(draftError, 'We could not draft that. You can write the question and labels yourself.'))
    } finally {
      setDrafting(false)
    }
  }

  const handleRun = async () => {
    if (!dataset) return
    setStarting(true); setError(undefined)
    try {
      const started = await api.start({
        datasetId: dataset.datasetId,
        query: composer.query.trim(),
        classes: composer.classes.map((item) => ({ name: item.name.trim(), description: item.description.trim() })).filter((item) => item.name),
        ...(labelColumn ? { labelColumn } : {}),
      })
      rememberControlToken(started.analysis.analysisId, started.controlToken)
      onStarted(started.analysis.analysisId)
    } catch (runError) {
      setError(messageOf(runError, 'We could not start the run.'))
      setStarting(false)
    }
  }

  const unavailable = !status ? undefined
    : !status.storage ? 'This deployment has no storage configured yet, so runs are unavailable.'
      : status.classifier === 'off' ? 'Jev is not connected on this deployment yet, so runs are unavailable.'
        : !status.runsEnabled ? 'New runs are paused on this playground right now.'
          : undefined

  const errorBanner = error && (
    <div className="banner error" role="alert"><AlertIcon /><span>{error}</span></div>
  )

  if (!dataset) {
    return (
      <>
        <section className="hero">
          <h1>Ask one question of <em>every row</em>.</h1>
          <p>Bring a spreadsheet, say what you want to know, and watch Jev answer row by row. Every run gets a link you can share.</p>
        </section>
        {errorBanner}
        <DatasetIntake
          busy={intakeBusy}
          storageReady={status?.storage}
          maxRows={status?.limits.maxRows ?? 5000}
          onSample={() => choose(samplePreview())}
          onFile={(file) => { void handleFile(file) }}
          onUrl={(url) => { void handleUrl(url) }}
        />
        <section className="steps" aria-label="How it works">
          <div><span>1</span><h3>Pick the data</h3><p>The sample, a CSV from your computer, or a public link.</p></div>
          <div><span>2</span><h3>Write the question</h3><p>One question and a short list of labels. An assistant can draft them for you.</p></div>
          <div><span>3</span><h3>Watch and share</h3><p>Answers arrive live. Replay the run, download the results, or send the link.</p></div>
        </section>
      </>
    )
  }

  return (
    <div className="stack">
      <DatasetPreviewCard dataset={dataset} labelColumn={labelColumn} onLabelColumn={setLabelColumn} onChange={() => { setDataset(undefined); setError(undefined) }} />
      <Composer
        value={composer}
        onChange={setComposer}
        rowCount={dataset.acceptedRowCount}
        drafting={drafting}
        draftNote={draftNote}
        draftingMode={status?.drafting}
        simulated={status?.classifier === 'mock'}
        unavailable={unavailable}
        starting={starting}
        onDraft={() => { void handleDraft() }}
        onRun={() => { void handleRun() }}
      />
      {errorBanner}
    </div>
  )
}
