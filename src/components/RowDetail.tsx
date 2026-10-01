import { memo } from 'react'
import type { AnalysisMeta, AnalysisViewRow } from '../shared/analysis'
import { classColorVar } from '../run/classColor'
import { formatCell, formatPercent, isCorrect } from '../run/metrics'
import { CheckIcon, CrossIcon } from './Icons'

export const RowDetail = memo(function RowDetail({ analysis, row, labelIndex }: { analysis: AnalysisMeta; row: AnalysisViewRow | undefined; labelIndex: number }) {
  if (!row) {
    return (
      <aside className="card detail-card" aria-label="Row detail">
        <header className="card-head compact"><h3>Row detail</h3></header>
        <p className="empty">Each row appears here as Jev answers it.</p>
      </aside>
    )
  }
  const classIndex = analysis.classes.findIndex((item) => item.name === row.selectedClass)
  const correct = isCorrect(row, labelIndex)
  return (
    <aside className="card detail-card" aria-label="Row detail">
      <header className="card-head compact">
        <h3>Row {row.rowIndex + 1}</h3>
        {correct !== undefined && (
          <span className={`verdict ${correct ? 'is-right' : 'is-wrong'}`}>{correct ? <CheckIcon /> : <CrossIcon />}{correct ? 'Correct' : `Was ${formatCell(row.values[labelIndex])}`}</span>
        )}
      </header>
      {row.error ? (
        <p className="detail-error">Jev could not answer this row <code>{row.error.code}</code></p>
      ) : (
        <>
          <p className="detail-answer">
            <span className="swatch" style={{ background: classColorVar(classIndex) }} aria-hidden="true" />
            <b>{row.selectedClass}</b>
            {row.confidence !== undefined && <span className="meta">{formatPercent(row.confidence)} confident</span>}
          </p>
          {row.probabilities && (
            <ul className="bars is-compact" aria-label="Probability per label">
              {analysis.classes.map((item, index) => (
                <li key={item.name}>
                  <span className="bar-label">{item.name}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(row.probabilities?.[index] ?? 0) * 100}%`, background: classColorVar(index) }} /></span>
                  <span className="bar-value">{formatPercent(row.probabilities?.[index])}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <h4>What Jev saw</h4>
      <dl className="fields">
        {analysis.columns.map((name, index) => (index === labelIndex ? null : (
          <div key={name}><dt>{name}</dt><dd>{formatCell(row.values[index])}</dd></div>
        )))}
      </dl>
      {labelIndex >= 0 && (
        <>
          <h4>Held out</h4>
          <dl className="fields"><div><dt>{analysis.columns[labelIndex]}</dt><dd>{formatCell(row.values[labelIndex])}</dd></div></dl>
        </>
      )}
    </aside>
  )
})
