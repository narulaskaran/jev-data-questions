import { ANALYSIS_MAX_CLASSES, ANALYSIS_MAX_CLASS_DESCRIPTION_LENGTH, ANALYSIS_MAX_CLASS_LENGTH, ANALYSIS_MAX_QUERY_LENGTH, ANALYSIS_MAX_TASK_LENGTH, ANALYSIS_MIN_CLASSES, type AnalysisClass } from '../shared/analysis'
import type { ProviderMode } from '../shared/dataset'
import { classColorVar } from '../run/classColor'
import { formatCount } from '../run/metrics'
import { CrossIcon, PlusIcon, SparkIcon } from './Icons'

export interface ComposerValue {
  task: string
  query: string
  classes: AnalysisClass[]
}

/** Why the run cannot start yet, or undefined when it can. */
export const composerProblem = (value: ComposerValue): string | undefined => {
  if (!value.query.trim()) return 'Write the question Jev should answer for each row.'
  const names = value.classes.map((item) => item.name.trim().toLowerCase()).filter(Boolean)
  if (names.length < ANALYSIS_MIN_CLASSES) return 'Add at least two labels for Jev to choose from.'
  if (new Set(names).size !== names.length) return 'Two labels have the same name.'
  return undefined
}

export const Composer = ({
  value,
  onChange,
  rowCount,
  drafting,
  draftNote,
  draftingMode,
  simulated,
  unavailable,
  starting,
  onDraft,
  onRun,
}: {
  value: ComposerValue
  onChange: (value: ComposerValue) => void
  rowCount: number
  drafting: boolean
  draftNote?: string
  draftingMode: ProviderMode | undefined
  /** Runs use the simulated classifier, so no real Jev calls are made. */
  simulated: boolean
  /** Why this deployment cannot run anything right now. */
  unavailable?: string
  starting: boolean
  onDraft: () => void
  onRun: () => void
}) => {
  const problem = composerProblem(value)
  const setClass = (index: number, patch: Partial<AnalysisClass>) => onChange({ ...value, classes: value.classes.map((item, position) => (position === index ? { ...item, ...patch } : item)) })

  return (
    <section className="card composer" aria-labelledby="composer-heading">
      <header className="card-head">
        <div>
          <p className="eyebrow">The question</p>
          <h2 id="composer-heading">What should Jev decide for each row?</h2>
        </div>
      </header>

      {draftingMode !== 'off' && (
        <div className="draft-box">
          <div className="field">
            <label htmlFor="task">Describe it in your own words</label>
            <textarea id="task" rows={2} maxLength={ANALYSIS_MAX_TASK_LENGTH} value={value.task} onChange={(event) => onChange({ ...value, task: event.target.value })} placeholder="e.g. Sort these support tickets into urgent and routine." />
          </div>
          <div className="draft-actions">
            <button className="button" type="button" onClick={onDraft} disabled={drafting || !value.task.trim()}>
              <SparkIcon /> {drafting ? 'Drafting…' : 'Draft question and labels'}
            </button>
            <span className="hint">{draftNote ?? 'An assistant turns this into the question and labels below. You can edit both.'}</span>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="query">Question asked about every row</label>
        <textarea id="query" rows={3} maxLength={ANALYSIS_MAX_QUERY_LENGTH} value={value.query} onChange={(event) => onChange({ ...value, query: event.target.value })} placeholder="e.g. Is this ticket urgent?" />
      </div>

      <fieldset className="classes">
        <legend>Labels Jev chooses from</legend>
        <ul>
          {value.classes.map((item, index) => (
            <li key={index} className="class-row">
              <span className="swatch" style={{ background: classColorVar(index) }} aria-hidden="true" />
              <input aria-label={`Label ${index + 1} name`} className="class-name" maxLength={ANALYSIS_MAX_CLASS_LENGTH} value={item.name} placeholder="Label" onChange={(event) => setClass(index, { name: event.target.value })} />
              <input aria-label={`Label ${index + 1} meaning`} className="class-description" maxLength={ANALYSIS_MAX_CLASS_DESCRIPTION_LENGTH} value={item.description} placeholder="When does it apply? (helps Jev)" onChange={(event) => setClass(index, { description: event.target.value })} />
              <button className="icon-button" type="button" aria-label={`Remove label ${item.name || index + 1}`} disabled={value.classes.length <= ANALYSIS_MIN_CLASSES} onClick={() => onChange({ ...value, classes: value.classes.filter((_, position) => position !== index) })}><CrossIcon /></button>
            </li>
          ))}
        </ul>
        <button className="button quiet" type="button" disabled={value.classes.length >= ANALYSIS_MAX_CLASSES} onClick={() => onChange({ ...value, classes: [...value.classes, { name: '', description: '' }] })}><PlusIcon /> Add a label</button>
      </fieldset>

      <footer className="run-bar">
        <p>
          <b>{formatCount(rowCount)} rows</b> means {formatCount(rowCount)} Jev calls, one per row.
          {simulated ? ' This deployment is in simulated mode, so no real calls are made.' : ' The results page is public.'}
        </p>
        <button className="button primary large" type="button" onClick={onRun} disabled={starting || Boolean(problem) || Boolean(unavailable)}>
          {starting ? 'Starting…' : `Run Jev on ${formatCount(rowCount)} rows`}
        </button>
      </footer>
      {(unavailable ?? problem) && <p className="hint run-hint" role="status">{unavailable ?? problem}</p>}
    </section>
  )
}
