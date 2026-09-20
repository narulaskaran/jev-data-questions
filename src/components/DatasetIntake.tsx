import { useEffect, useState } from 'react'
import { SAMPLE_FIXTURE_CARDS } from '../dataset/sampleDataset'
import { plainDatasetError } from '../dataset/csvTypes'
import type { DatasetIntakeStatus } from '../shared/dataset'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'

const INTAKE_ERROR_HEADING = "Couldn't load dataset"
const EMPTY_URL_MESSAGE = 'Enter a public HTTPS CSV URL first.'

export const DatasetIntake = ({
  status,
  intakeError,
  onUploadFile,
  onSubmitUrl,
  onTrySample,
  disabled,
  resetToken = 0,
}: {
  status?: DatasetIntakeStatus
  intakeError?: string
  onUploadFile: (file: File) => void
  onSubmitUrl: (url: string) => void
  onTrySample: (datasetId: string) => void
  disabled?: boolean
  resetToken?: number
}) => {
  const byodBlocked = status?.convex === false || status?.uploadThing === false
  const [csvUrl, setCsvUrl] = useState('')
  const [urlHint, setUrlHint] = useState<string>()

  useEffect(() => {
    setCsvUrl('')
    setUrlHint(undefined)
  }, [resetToken])

  return (
    <section className="intake-panel" aria-labelledby="intake-heading" aria-busy={disabled || undefined}>
      <h2 id="intake-heading">Choose a dataset</h2>
      <div className="intake-samples">
        {SAMPLE_FIXTURE_CARDS.map((sample) => (
          <Card key={sample.datasetId} className="intake-card">
            <CardHeader>
              <p className="eyebrow">{sample.eyebrow}</p>
              <CardTitle>{sample.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="intake-blurb">{sample.blurb}</p>
              <Button type="button" onClick={() => onTrySample(sample.datasetId)} disabled={disabled}>
                {sample.name}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="intake-cards">
        <Card className={`intake-card ${disabled || byodBlocked ? 'is-disabled' : ''}`}>
          <CardHeader>
            <p className="eyebrow">Bring your own</p>
            <CardTitle>Upload .csv or public HTTPS CSV URL</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="byod-file">
              <Label htmlFor="csv-file">Upload .csv</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                aria-label="Upload CSV"
                disabled={disabled || byodBlocked}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) onUploadFile(file)
                }}
              />
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
        <p className="thinking" role="status">
          <span className="thinking-dot" aria-hidden="true" />
          Loading dataset…
        </p>
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
