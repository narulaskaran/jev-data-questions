import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { AnalysisMeta, AnalysisViewRow } from '../shared/analysis'
import { classColorVar } from '../run/classColor'
import { formatCell, formatCount, formatPercent, isCorrect } from '../run/metrics'
import { TABLE_ROW_HEIGHT, visibleWindow } from '../run/windowing'
import { CheckIcon, CrossIcon } from './Icons'

type Filter = 'all' | 'misses' | 'failed'
const MAX_INPUT_COLUMNS = 8
const VIEWPORT_HEIGHT = 432

export const ResultsTable = memo(function ResultsTable({
  analysis,
  rows,
  labelIndex,
  selectedRowIndex,
  autoScroll,
  onSelect,
}: {
  analysis: AnalysisMeta
  rows: readonly AnalysisViewRow[]
  labelIndex: number
  /** The dataset row index under the playhead. */
  selectedRowIndex: number | undefined
  /** Keep the selected row in view (while following live or replaying). */
  autoScroll: boolean
  onSelect: (position: number) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [scrollTop, setScrollTop] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const hovering = useRef(false)

  const misses = useMemo(() => (labelIndex < 0 ? 0 : rows.reduce((total, row) => total + (isCorrect(row, labelIndex) === false ? 1 : 0), 0)), [rows, labelIndex])
  const failed = analysis.progress.failedRows
  const active: Filter = (filter === 'misses' && misses === 0) || (filter === 'failed' && failed === 0) ? 'all' : filter

  /** Positions into `rows`, so a click can move the playhead whatever the filter. */
  const positions = useMemo(() => {
    if (active === 'all') return undefined
    const kept: number[] = []
    rows.forEach((row, position) => {
      if (active === 'misses' ? isCorrect(row, labelIndex) === false : row.error !== undefined) kept.push(position)
    })
    return kept
  }, [active, rows, labelIndex])

  const count = positions ? positions.length : rows.length
  const window = visibleWindow(count, scrollTop, VIEWPORT_HEIGHT)
  const inputColumns = analysis.columns.map((name, index) => ({ name, index })).filter((column) => column.index !== labelIndex)
  const shownColumns = inputColumns.slice(0, MAX_INPUT_COLUMNS)
  const classIndexByName = useMemo(() => new Map(analysis.classes.map((item, index) => [item.name, index])), [analysis.classes])

  // Scroll only this table's own viewport. Never scrollIntoView: that moves the whole page.
  useEffect(() => {
    const node = scroller.current
    if (!node || !autoScroll || hovering.current || active !== 'all' || selectedRowIndex === undefined) return
    const top = selectedRowIndex * TABLE_ROW_HEIGHT
    if (top < node.scrollTop || top + TABLE_ROW_HEIGHT > node.scrollTop + node.clientHeight - TABLE_ROW_HEIGHT) {
      node.scrollTop = Math.max(0, top - node.clientHeight + TABLE_ROW_HEIGHT * 3)
    }
  }, [active, autoScroll, selectedRowIndex])

  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; setScrollTop(0) }, [active])

  const visible = Array.from({ length: Math.max(0, window.end - window.start) }, (_, offset) => {
    const slot = window.start + offset
    const position = positions ? positions[slot] : slot
    return { position, row: rows[position] }
  })
  const columnCount = 3 + (labelIndex >= 0 ? 1 : 0) + shownColumns.length

  return (
    <section className="card results-card" aria-labelledby="results-heading">
      <header className="card-head compact">
        <div>
          <h3 id="results-heading">Every row</h3>
          <p className="meta">{formatCount(rows.length)} of {formatCount(analysis.progress.totalRows)} answered. Select a row to inspect it.</p>
        </div>
        {(misses > 0 || failed > 0) && (
          <div className="filters" role="group" aria-label="Filter rows">
            <button type="button" className="chip" aria-pressed={active === 'all'} onClick={() => setFilter('all')}>All</button>
            {misses > 0 && <button type="button" className="chip" aria-pressed={active === 'misses'} onClick={() => setFilter('misses')}>Misses {formatCount(misses)}</button>}
            {failed > 0 && <button type="button" className="chip" aria-pressed={active === 'failed'} onClick={() => setFilter('failed')}>Failed {formatCount(failed)}</button>}
          </div>
        )}
      </header>
      {rows.length === 0 ? <p className="empty">Rows appear here as Jev answers them.</p> : (
        <div
          ref={scroller}
          className="results-scroll"
          style={{ maxHeight: VIEWPORT_HEIGHT }}
          tabIndex={0}
          role="region"
          aria-label="Results"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          onPointerEnter={() => { hovering.current = true }}
          onPointerLeave={() => { hovering.current = false }}
        >
          <table className="data-table results-table" aria-rowcount={count + 1}>
            <thead>
              <tr>
                <th scope="col" className="is-number">#</th>
                <th scope="col">Jev says</th>
                <th scope="col" className="is-number">Confidence</th>
                {labelIndex >= 0 && <th scope="col">Actual</th>}
                {shownColumns.map((column) => <th key={column.name} scope="col" className={typeof rows[0]?.values[column.index] === 'number' ? 'is-number' : undefined}>{column.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {window.padTop > 0 && <tr aria-hidden="true" style={{ height: window.padTop }}><td colSpan={columnCount} /></tr>}
              {visible.map(({ position, row }) => {
                const correct = isCorrect(row, labelIndex)
                const selected = row.rowIndex === selectedRowIndex
                return (
                  <tr key={row.rowIndex} className={selected ? 'is-selected' : undefined} aria-selected={selected} aria-rowindex={position + 2} onClick={() => onSelect(position)}>
                    <td className="is-number">
                      <button type="button" className="row-button" onClick={(event) => { event.stopPropagation(); onSelect(position) }} aria-label={`Inspect row ${row.rowIndex + 1}`}>{row.rowIndex + 1}</button>
                    </td>
                    <td>
                      {row.error
                        ? <span className="status-text is-failed">Failed</span>
                        : <span className="class-cell"><span className="swatch" style={{ background: classColorVar(classIndexByName.get(row.selectedClass ?? '') ?? -1) }} aria-hidden="true" />{row.selectedClass}</span>}
                    </td>
                    <td className="is-number">{formatPercent(row.confidence)}</td>
                    {labelIndex >= 0 && (
                      <td>
                        <span className={`class-cell${correct === false ? ' is-wrong' : correct ? ' is-right' : ''}`}>
                          {correct === undefined ? null : correct ? <CheckIcon /> : <CrossIcon />}
                          {formatCell(row.values[labelIndex])}
                        </span>
                      </td>
                    )}
                    {shownColumns.map((column) => <td key={column.name} className={typeof row.values[column.index] === 'number' ? 'is-number' : undefined}>{formatCell(row.values[column.index])}</td>)}
                  </tr>
                )
              })}
              {window.padBottom > 0 && <tr aria-hidden="true" style={{ height: window.padBottom }}><td colSpan={columnCount} /></tr>}
            </tbody>
          </table>
        </div>
      )}
      {inputColumns.length > shownColumns.length && <p className="meta table-caption">Showing {shownColumns.length} of {inputColumns.length} columns. Select a row to see all of them, or download the CSV.</p>}
    </section>
  )
})
