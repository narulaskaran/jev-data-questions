import { useEffect, useRef, useState } from 'react'
import { ANALYSIS_STALL_AFTER_MS } from '../shared/analysis'
import { STILL_WORKING_COPY } from '../runView/format'
import { plainDatasetError } from '../dataset/csvTypes'
import type { DatasetIntakeStatus } from '../shared/dataset'
import { Button } from './ui/button'
import { ArrowUpRight } from './ui/arrow'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Progress } from './ui/progress'

const INTAKE_ERROR_HEADING = "Couldn't load dataset"
const EMPTY_URL_MESSAGE = 'Enter a public HTTPS CSV URL first.'
export const UPLOAD_CSV_COPY = 'Upload CSV'
export const USE_PUBLIC_CSV_URL_COPY = 'Use public CSV URL'
export const LOADING_DATASET_COPY = 'Loading dataset…'

export const LOCAL_ONLY_COPY = 'Your CSV is read in your browser and is not uploaded. Loading from a link needs the live service, which is off on this deployment.'

const isServiceOff = (status?: DatasetIntakeStatus): boolean => status?.uploadThing === false || status?.convex === false

/** A file can always be charted in the browser; only a busy intake blocks it. */
export const isFileUploadBlocked = (_status?: DatasetIntakeStatus, busy = false): boolean => busy

/** Fetching a link is done by the server, so it needs the live service. */
export const isPublicUrlBlocked = (status?: DatasetIntakeStatus, busy = false): boolean => busy || isServiceOff(status)

export const DatasetIntake = ({
  status,
  intakeError,
  onUploadFile,
  onSubmitUrl,
  disabled,
  resetToken = 0,
}: {
  status?: DatasetIntakeStatus
  intakeError?: string
  onUploadFile: (file: File) => void
  onSubmitUrl: (url: string) => void
  disabled?: boolean
  resetToken?: number
}) => {
  const fileBlocked = isFileUploadBlocked(status, disabled)
  const urlBlocked = isPublicUrlBlocked(status, disabled)
  const [csvUrl, setCsvUrl] = useState('')
  const [urlHint, setUrlHint] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [busySince, setBusySince] = useState<number>()
  const [nowMs, setNowMs] = useState(() => Date.now())
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCsvUrl('')
    setUrlHint(undefined)
  }, [resetToken])

  useEffect(() => {
    if (!disabled) {
      setBusySince(undefined)
      return undefined
    }
    setBusySince((current) => current ?? Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [disabled])

  const stillWorking = Boolean(busySince && nowMs - busySince >= ANALYSIS_STALL_AFTER_MS)

  return (
    <section className="intake-panel" aria-labelledby="intake-heading" aria-busy={disabled || undefined}>
      <h2 id="intake-heading" className="sr-only">Choose a dataset</h2>
      <div className="intake-cards">
        <Card className={`intake-card${disabled ? ' is-disabled' : ''}`}>
          <CardHeader>
            <p className="eyebrow">Bring your own</p>
            <CardTitle>Bring your own data.</CardTitle>
            <p className="intake-description">Drop in a CSV and get a dashboard in seconds.</p>
          </CardHeader>
          <CardContent>
            <div
              className={`byod-file${dragging ? ' is-dragging' : ''}`}
              onDragOver={(event) => {
                if (fileBlocked) return
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                if (fileBlocked) return
                event.preventDefault()
                setDragging(false)
                const file = event.dataTransfer.files?.[0]
                if (file) onUploadFile(file)
              }}
            >
              <svg className="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>
              <p>Drop a CSV here, or choose a file.</p>
              <input
                ref={fileInputRef}
                id="csv-file"
                className="sr-only"
                type="file"
                accept=".csv,text/csv"
                aria-label={UPLOAD_CSV_COPY}
                disabled={fileBlocked}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) onUploadFile(file)
                }}
              />
              <Button
                variant="secondary"
                type="button"
                disabled={fileBlocked}
                onClick={() => fileInputRef.current?.click()}
              >
                {UPLOAD_CSV_COPY}
              </Button>
              <span className="intake-limits">CSV · Up to 5 MB · 5,000 rows</span>
            </div>
            <div className="intake-divider"><span>or start with a link</span></div>
            <form
              className="byod-url"
              onSubmit={(event) => {
                event.preventDefault()
                const url = csvUrl.trim()
                if (!url) {
                  setUrlHint(EMPTY_URL_MESSAGE)
                  return
                }
                try {
                  const parsed = new URL(url)
                  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
                    setUrlHint('Use a public HTTPS link directly to a CSV file.')
                    return
                  }
                } catch {
                  setUrlHint('Enter a valid public HTTPS CSV URL.')
                  return
                }
                setUrlHint(undefined)
                onSubmitUrl(url)
              }}
            >
              <Label htmlFor="csv-url">Public HTTPS CSV URL</Label>
              <Input
                id="csv-url"
                name="csv-url"
                type="url"
                placeholder="https://example.com/data.csv"
                value={csvUrl}
                disabled={urlBlocked}
                aria-invalid={Boolean(urlHint) || undefined}
                aria-describedby={urlHint ? 'csv-url-hint' : undefined}
                onChange={(event) => {
                  setCsvUrl(event.target.value)
                  if (urlHint) setUrlHint(undefined)
                }}
              />
              {urlHint ? <p id="csv-url-hint" className="field-hint" role="alert">{urlHint}</p> : null}
              <Button variant="secondary" type="submit" disabled={urlBlocked}>{USE_PUBLIC_CSV_URL_COPY} <ArrowUpRight /></Button>
            </form>
            {isServiceOff(status) ? <p className="intake-unavailable" role="status">{LOCAL_ONLY_COPY}</p> : null}
          </CardContent>
        </Card>
      </div>
      {disabled ? (
        <div className="intake-progress" role="status">
          <p className="thinking">
            <span className="thinking-dot" aria-hidden="true" />
            {LOADING_DATASET_COPY}
          </p>
          <Progress indeterminate aria-label={LOADING_DATASET_COPY} />
          {stillWorking ? <p className="run-stall">{STILL_WORKING_COPY}</p> : null}
        </div>
      ) : null}
      {intakeError && (
        <div className="error-banner" role="alert">
          <b>{INTAKE_ERROR_HEADING}</b>
          <span>{plainDatasetError(intakeError, intakeError)}</span>
        </div>
      )}
    </section>
  )
}
