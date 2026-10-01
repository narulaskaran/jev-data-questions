import { memo } from 'react'
import type { AnalysisClass } from '../shared/analysis'
import { formatCount, formatPercent, type Score } from '../run/metrics'

const MATRIX_MAX_CLASSES = 6

/** Single-hue tint: darker means more rows. The count is always printed, so colour is never the only channel. */
const tint = (value: number, max: number): string => (
  value === 0 || max === 0 ? 'transparent' : `color-mix(in oklab, var(--series-1) ${Math.round(12 + 58 * (value / max))}%, transparent)`
)

export const Scoreboard = memo(function Scoreboard({ score, classes, labelColumn }: { score: Score; classes: readonly AnalysisClass[]; labelColumn: string }) {
  const lift = score.accuracy !== undefined && score.baseline ? score.accuracy - score.baseline.accuracy : undefined
  const max = Math.max(0, ...score.matrix.flat())
  return (
    <section className="card score-card" aria-labelledby="score-heading">
      <header className="card-head compact">
        <h3 id="score-heading">Scored against “{labelColumn}”</h3>
        <p className="meta">Jev never saw this column</p>
      </header>
      <div className="score-tiles">
        <div className="tile hero">
          <span className="tile-label">Correct</span>
          <span className="tile-value">{formatPercent(score.accuracy)}</span>
          <span className="tile-note">{formatCount(score.correct)} of {formatCount(score.scored)} rows</span>
        </div>
        <div className="tile">
          <span className="tile-label">Always guessing “{score.baseline?.label ?? '—'}”</span>
          <span className="tile-value">{formatPercent(score.baseline?.accuracy)}</span>
          <span className="tile-note">
            {lift === undefined ? 'The simplest possible strategy'
              : Math.abs(lift) < 0.005 ? 'Jev is level with it'
                : `Jev is ${Math.abs(lift * 100).toFixed(0)} points ${lift > 0 ? 'ahead' : 'behind'}`}
          </span>
        </div>
      </div>
      {classes.length <= MATRIX_MAX_CLASSES && score.scored > 0 && (
        <div className="table-scroll">
          <table className="matrix">
            <caption>Rows by actual answer (down) and Jev’s answer (across)</caption>
            <thead>
              <tr><td />{classes.map((item) => <th key={item.name} scope="col">Jev: {item.name}</th>)}</tr>
            </thead>
            <tbody>
              {classes.map((actual, row) => (
                <tr key={actual.name}>
                  <th scope="row">Was {actual.name}</th>
                  {classes.map((predicted, column) => (
                    <td key={predicted.name} className={row === column ? 'is-diagonal' : undefined} style={{ background: tint(score.matrix[row][column], max) }}>{formatCount(score.matrix[row][column])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {score.unmatched > 0 && <p className="hint">{formatCount(score.unmatched)} rows have an answer that is not one of the labels, so they are not scored.</p>}
    </section>
  )
})
