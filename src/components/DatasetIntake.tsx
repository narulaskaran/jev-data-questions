import { useEffect, useRef, useState } from 'react'
import { ANALYSIS_STALL_AFTER_MS } from '../shared/analysis'
import { STILL_WORKING_COPY } from '../runView/format'
import { plainDatasetError } from '../dataset/csvTypes'
import type { DatasetIntakeStatus } from '../shared/dataset'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Progress } from './ui/progress'

const INTAKE_ERROR_HEADING = "Couldn't load dataset"
const EMPTY_URL_MESSAGE = 'Enter a public HTTPS CSV URL first.'
export const UPLOAD_CSV_COPY = 'Upload CSV'
export const LOADING_DATASET_COPY = 'Loading dataset…'

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
  const byodBlocked = status?.convex === false || status?.uploadThing === false
  const [csvUrl, setCsvUrl] = useState('')
  const [urlHint, setUrlHint] = useState<string>()
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
      <h2 id="intake-heading">Choose a dataset</h2>
      <div className="intake-cards">
        <Card className={`intake-card ${disabled || byodBlocked ? 'is-disabled' : ''}`}>
          <CardHeader>
            <p className="eyebrow">Bring your own</p>
            <CardTitle>Upload CSV or public HTTPS CSV URL</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="byod-file">
              <Label htmlFor="csv-file">{UPLOAD_CSV_COPY}</Label>
              <input
                ref={fileInputRef}
                id="csv-file"
                className="sr-only"
                type="file"
                accept=".csv,text/csv"
                aria-label={UPLOAD_CSV_COPY}
                disabled={disabled || byodBlocked}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) onUploadFile(file)
                }}
              />
              <Button
                variant="secondary"
                type="button"
                disabled={disabled || byodBlocked}
                onClick={() => fileInputRef.current?.click()}
              >
                {UPLOAD_CSV_COPY}
              </Button>
            </div>
            <form
              className="byod-url"
              onSubmit={(event) => {
                event.preventDefault()
                const url = csvUrl.trim()
                if (!url) {
                  setUrlHint(EMPTY_URL_MESSAGE)
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
                disabled={disabled || byodBlocked}
                aria-invalid={Boolean(urlHint) || undefined}
                aria-describedby={urlHint ? 'csv-url-hint' : undefined}
                onChange={(event) => {
                  setCsvUrl(event.target.value)
                  if (urlHint) setUrlHint(undefined)
                }}
              />
              {urlHint ? <p id="csv-url-hint" className="field-hint" role="alert">{urlHint}</p> : null}
              <Button variant="secondary" type="submit" disabled={disabled || byodBlocked}>Use public CSV URL</Button>
            </form>
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
