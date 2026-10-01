import { useId, useState, type FormEvent } from 'react'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { ChartView } from './charts'
import { isWideView, type StoryDashboard as StoryDashboardModel } from '../../insights/dashboard'
import type { StoryView } from '../../insights/views'
import { downloadTextFile, escapeCsvCell } from '../../runView/resultsCsv'

export const EMPTY_STORY_COPY = 'This table has no columns we can chart yet. Dashboards need at least one column of numbers, dates, categories, yes/no values, or coordinates.'
export const NO_QUESTION_MATCH_COPY = 'No column matches that question, so the full dashboard is shown.'

const TABLE_ROW_LIMIT = 50

export const viewCsv = (view: StoryView): string => {
  const lines = [view.table.columns, ...view.table.rows].map((row) => row.map((value) => escapeCsvCell(String(value))).join(','))
  return `${lines.join('\n')}\n`
}

export const viewCsvFilename = (view: StoryView): string => (
  `jev-${view.id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 80) || 'chart'}.csv`
)

/** A sample question built from this table's own columns. */
const askExample = ({ profile }: StoryDashboardModel): string => {
  const group = profile.fields.find((field) => field.kind === 'category' || field.kind === 'ordinal')
  const subject = profile.fields.find((field) => field.kind === 'flag' || field.kind === 'measure')
  if (group && subject) return `For example: ${subject.label.toLowerCase()} by ${group.label.toLowerCase()}`
  const any = subject ?? group
  return any ? `For example: ${any.label.toLowerCase()}` : 'Name a column to see it first'
}

const DataTable = ({ view }: { view: StoryView }) => {
  const rows = view.table.rows.slice(0, TABLE_ROW_LIMIT)
  return (
    <div className="story-table" tabIndex={0} role="region" aria-label={`Data for ${view.title}`}>
      <table>
        <thead>
          <tr>{view.table.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{row.map((value, cell) => <td key={cell}>{typeof value === 'number' ? value.toLocaleString('en-US') : value}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {view.table.rows.length > rows.length ? (
        <p className="story-footnote">First {rows.length} of {view.table.rows.length.toLocaleString('en-US')} rows. Download the CSV for all of them.</p>
      ) : null}
    </div>
  )
}

const StoryCard = ({ view, wide }: { view: StoryView; wide: boolean }) => {
  const headingId = useId()
  const [showTable, setShowTable] = useState(false)
  return (
    <Card className="story-card" data-view-kind={view.kind} data-chart={view.chart.type} data-wide={wide || undefined} aria-labelledby={headingId}>
      <header className="story-card-head">
        <div className="story-card-copy">
          <p className="eyebrow">{view.eyebrow}</p>
          <h2 id={headingId}>{view.title}</h2>
          <p className="story-subtitle">{view.subtitle}</p>
        </div>
        <div className="story-card-actions">
          <Button variant="ghost" size="sm" type="button" aria-pressed={showTable} onClick={() => setShowTable((value) => !value)} aria-label={`${showTable ? 'Show chart' : 'Show data table'} for ${view.title}`}>
            {showTable ? 'Chart' : 'Table'}
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={() => downloadTextFile(viewCsvFilename(view), viewCsv(view))} aria-label={`Download CSV for ${view.title}`}>
            CSV
          </Button>
        </div>
      </header>
      <div className="story-card-body">
        {showTable ? <DataTable view={view} /> : <ChartView chart={view.chart} label={`${view.title}. ${view.subtitle}.`} />}
      </div>
      {view.footnote ? <p className="story-footnote">{view.footnote}</p> : null}
    </Card>
  )
}

export const StoryDashboard = ({
  dashboard,
  question = '',
  onAsk,
  shareLabel,
  onShare,
}: {
  dashboard: StoryDashboardModel
  /** The question currently applied, if any. */
  question?: string
  onAsk?: (question: string) => void
  shareLabel?: string
  onShare?: () => void
}) => {
  const [draft, setDraft] = useState(question)
  const inputId = useId()
  const { kpis, views, focus } = dashboard

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onAsk?.(draft.trim())
  }

  if (views.length === 0 && !question) {
    return (
      <section className="story" aria-label="Dashboard">
        <p className="empty-copy story-empty" role="status">{EMPTY_STORY_COPY}</p>
      </section>
    )
  }

  // A lone last card would leave a hole in the two-column grid, so it spans it.
  let narrowSeen = 0
  const layout = views.map((view, index) => {
    const wide = isWideView(view)
    if (!wide) narrowSeen += 1
    const closesRow = wide || index === views.length - 1 || isWideView(views[index + 1]!)
    const orphan = !wide && closesRow && narrowSeen % 2 === 1
    if (closesRow) narrowSeen = 0
    return { view, wide: wide || orphan }
  })

  return (
    <section className="story" aria-label="Dashboard" data-view-count={views.length}>
      {kpis.length > 0 ? (
        <dl className="story-kpis" aria-label="Key figures">
          {kpis.map((kpi) => (
            <div className="story-kpi" key={kpi.label}>
              <dt>{kpi.label}</dt>
              <dd>
                <strong>{kpi.value}</strong>
                {kpi.detail ? <span>{kpi.detail}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {onAsk || onShare ? (
        <div className="story-toolbar">
          {onAsk ? (
            <form className="story-ask" onSubmit={submit}>
              <label htmlFor={inputId}>Ask about your columns</label>
              <div className="story-ask-row">
                <input
                  id={inputId}
                  type="text"
                  value={draft}
                  maxLength={200}
                  placeholder={askExample(dashboard)}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <Button type="submit" variant="secondary" size="sm">Ask</Button>
                {question ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setDraft(''); onAsk('') }}>Clear</Button>
                ) : null}
              </div>
              {question ? (
                <p className="story-ask-status" role="status">
                  {focus && focus.length > 0 ? `Leading with charts about: ${focus.join(', ')}.` : NO_QUESTION_MATCH_COPY}
                </p>
              ) : null}
            </form>
          ) : null}
          {onShare ? (
            <Button className="story-share" variant="secondary" size="sm" type="button" onClick={onShare} aria-label="Copy a link to this dashboard">
              {shareLabel || 'Share dashboard'}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="story-grid">
        {layout.map(({ view, wide }) => <StoryCard key={view.id} view={view} wide={wide} />)}
      </div>
    </section>
  )
}
