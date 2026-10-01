import { useRef, useState, type DragEvent } from 'react'
import { CSV_MAX_BYTES, CSV_MAX_ROWS } from '../dataset/csvTypes'
import { formatCount } from '../run/metrics'
import { ArrowIcon, UploadIcon } from './Icons'

export const DatasetIntake = ({
  busy,
  storageReady,
  maxRows,
  onSample,
  onFile,
  onUrl,
}: {
  busy: 'upload' | 'url' | undefined
  /** undefined while the deployment status is still loading. */
  storageReady: boolean | undefined
  maxRows: number
  onSample: () => void
  onFile: (file: File) => void
  onUrl: (url: string) => void
}) => {
  const [dragging, setDragging] = useState(false)
  const [url, setUrl] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const blocked = storageReady === false
  const disabled = blocked || busy !== undefined

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file && !disabled) onFile(file)
  }

  return (
    <section className="intake" aria-labelledby="intake-heading">
      <h2 id="intake-heading" className="visually-hidden">Choose a dataset</h2>
      <article className="card intake-card intake-sample">
        <p className="eyebrow">Start here</p>
        <h3>Super Bowl LX: run or pass?</h3>
        <p>Every Seattle play from the game, 71 rows. Jev sees only the situation before the snap and predicts the call. Then we score it against what actually happened.</p>
        <ul className="situations" aria-label="Example rows">
          <li><span>Q1 · 15:00</span><b>1st &amp; 10</b><span>65 yards to go</span><i>Run or pass?</i></li>
          <li><span>Q2 · 8:41</span><b>2nd &amp; 1</b><span>62 yards to go</span><i>Run or pass?</i></li>
          <li><span>Q4 · 2:01</span><b>3rd &amp; 23</b><span>59 yards to go</span><i>Run or pass?</i></li>
        </ul>
        <button className="button primary" type="button" onClick={onSample} disabled={busy !== undefined}>
          Try the sample <ArrowIcon />
        </button>
      </article>
      <article className="card intake-card" aria-disabled={blocked || undefined}>
        <p className="eyebrow">Your data</p>
        <h3>Bring a CSV</h3>
        <label
          className={`dropzone${dragging ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
          onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <UploadIcon />
          <span><b>{busy === 'upload' ? 'Uploading…' : 'Choose a file'}</b> or drop it here</span>
          <small>Up to {CSV_MAX_BYTES / (1024 * 1024)} MB and {formatCount(Math.min(maxRows, CSV_MAX_ROWS))} rows</small>
          <input
            ref={input}
            className="visually-hidden"
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            aria-label="Upload a CSV file"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onFile(file)
            }}
          />
        </label>
        <form
          className="url-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (url.trim()) onUrl(url.trim())
          }}
        >
          <label htmlFor="csv-url">Or paste a public link</label>
          <div className="url-row">
            <input id="csv-url" type="url" inputMode="url" placeholder="https://example.com/data.csv" value={url} onChange={(event) => setUrl(event.target.value)} disabled={disabled} required />
            <button className="button" type="submit" disabled={disabled || !url.trim()}>{busy === 'url' ? 'Fetching…' : 'Fetch'}</button>
          </div>
        </form>
        {blocked
          ? <p className="note warning" role="status">Uploads are switched off on this deployment because it has no storage configured. The sample still works.</p>
          : <p className="note">Uploads are public: anyone with the link can see the data and the results. Don’t upload anything private.</p>}
      </article>
    </section>
  )
}
