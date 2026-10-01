import { memo } from 'react'
import type { AnalysisClass } from '../shared/analysis'
import { classColorVar } from '../run/classColor'
import { formatCount, formatPercent, type ClassCounts } from '../run/metrics'

/**
 * Share of rows per label so far. Labels keep their order and colour for the
 * whole run, so bars grow in place instead of reshuffling while you scrub.
 */
export const ClassChart = memo(function ClassChart({ classes, tally, animate }: { classes: readonly AnalysisClass[]; tally: ClassCounts; animate: boolean }) {
  const total = tally.classified
  return (
    <section className="card chart-card" aria-labelledby="chart-heading">
      <header className="card-head compact">
        <h3 id="chart-heading">Jev’s answers</h3>
        <p className="meta">{total === 0 ? 'Waiting for the first row' : `${formatCount(total)} classified${tally.failed ? ` · ${formatCount(tally.failed)} failed` : ''}`}</p>
      </header>
      <ul className={`bars${classes.length > 8 ? ' is-dense' : ''}${animate ? ' is-animated' : ''}`}>
        {classes.map((item, index) => {
          const count = tally.counts[index] ?? 0
          const share = total > 0 ? count / total : 0
          return (
            <li key={item.name} title={`${item.name}: ${formatCount(count)} rows (${formatPercent(share)})${item.description ? `. ${item.description}` : ''}`}>
              <span className="bar-label">{item.name}</span>
              <span className="bar-track"><span className="bar-fill" style={{ width: `${share * 100}%`, background: classColorVar(index) }} /></span>
              <span className="bar-value"><b>{formatCount(count)}</b> {formatPercent(share)}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
})
