import { memo } from 'react'
import { sameStringList } from '../runView/chartProps'
import { cell, percent } from '../runView/format'
import type { AnalysisResultRow } from '../shared/analysis'

const sameVisibleResults = (
  left: readonly AnalysisResultRow[],
  right: readonly AnalysisResultRow[],
): boolean => left === right || (
  left.length === right.length
  && left.every((row, index) => {
    const other = right[index]
    if (!other) return false
    return row.rowIndex === other.rowIndex
      && row.input === other.input
      && row.selectedClass === other.selectedClass
      && row.value === other.value
      && row.confidence === other.confidence
      && row.error?.code === other.error?.code
  })
)

export const ResultsTable = memo(function ResultsTable({
  rows,
  columns,
}: {
  rows: readonly AnalysisResultRow[]
  columns: readonly string[]
}) {
  const previewColumns = columns.slice(0, 2)
  return (
    <section className="results-card is-secondary" aria-labelledby="results-heading">
      <div className="section-heading">
        <div>
          <h3 id="results-heading">Incremental results</h3>
        </div>
        <span className="table-count">{rows.length} rows</span>
      </div>
      {rows.length === 0 ? (
        <p className="empty-copy">Results append here as each row prediction is persisted.</p>
      ) : (
        <div className="table-scroll">
          <table aria-label="Incremental analysis results">
            <thead>
              <tr>
                <th>Row</th>
                {previewColumns.map((name) => <th key={name}>{name}</th>)}
                <th>Selected class</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rowIndex}>
                  <td>#{row.rowIndex + 1}</td>
                  {previewColumns.map((name) => <td key={name}>{cell(row.input[name])}</td>)}
                  <td><span className="class-chip">{row.selectedClass ?? (row.value !== undefined ? percent(row.value) : row.error?.code ?? 'Pending')}</span></td>
                  <td>{percent(row.confidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}, (prev, next) => (
  sameVisibleResults(prev.rows, next.rows)
  && sameStringList(prev.columns, next.columns)
))
