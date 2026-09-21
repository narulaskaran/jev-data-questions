import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { areRailPropsEqual } from '../runView/chartProps'
import { railMetaLine } from '../runView/format'
import { RAIL_ITEM_SIZE, railWindow } from '../runView/railWindow'
import type { ChartVisualKind } from '../shared/questionKind'
import type { AnalysisResultRow } from '../shared/analysis'
import { Progress } from './ui/progress'

const RailItem = memo(function RailItem({
  index,
  label,
  meta,
  selected,
  onSelect,
}: {
  index: number
  label: string
  meta?: string
  selected: boolean
  onSelect: (index: number) => void
}) {
  return (
    <li>
      <button
        type="button"
        className={`rail-item${selected ? ' is-selected' : ''}`}
        aria-current={selected ? 'true' : undefined}
        aria-label={meta ? `${label} ${meta}` : label}
        onClick={() => onSelect(index)}
      >
        <span className="rail-index">{label}</span>
        {meta ? <span className="rail-meta">{meta}</span> : null}
      </button>
    </li>
  )
})

export const RowRail = memo(function RowRail({
  rows,
  totalRows,
  playheadIndex,
  chartKind = 'bars',
  perspectiveLabel,
  onSelect,
}: {
  rows: readonly AnalysisResultRow[]
  totalRows: number
  playheadIndex: number
  classes?: readonly string[]
  chartKind?: ChartVisualKind
  perspectiveLabel?: string
  onSelect: (index: number) => void
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(320)

  useEffect(() => {
    const node = listRef.current
    if (!node) return undefined
    const measure = () => setViewportHeight(node.clientHeight || 320)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [])

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [playheadIndex, rows.length])

  const window = useMemo(
    () => railWindow({
      count: rows.length,
      scrollOffset: scrollTop,
      viewportSize: viewportHeight,
      itemSize: RAIL_ITEM_SIZE,
      includeIndex: playheadIndex,
    }),
    [playheadIndex, rows.length, scrollTop, viewportHeight],
  )

  const visible = rows.slice(window.start, window.end)
  const playheadRatio = totalRows ? Math.min(100, Math.round(((playheadIndex + 1) / totalRows) * 100)) : 0

  return (
    <aside className="run-rail" aria-label="Processed rows">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Rows</p>
          <h3>{rows.length ? `Row ${playheadIndex + 1} of ${totalRows}` : 'Waiting'}</h3>
        </div>
      </div>
      <Progress
        className="mb-2 mx-1.5"
        value={rows.length ? playheadRatio : 0}
        aria-hidden="true"
      />
      <ul
        ref={listRef}
        className={`rail-list${window.virtualized ? ' is-virtualized' : ''}`}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {window.virtualized ? <li className="rail-spacer" style={{ height: window.padStart }} aria-hidden="true" /> : null}
        {visible.map((row, offset) => {
          const index = window.start + offset
          return (
            <RailItem
              key={row.rowIndex}
              index={index}
              label={`Row ${row.rowIndex + 1} of ${totalRows}`}
              meta={railMetaLine(row, chartKind, perspectiveLabel) || undefined}
              selected={index === playheadIndex}
              onSelect={onSelect}
            />
          )
        })}
        {window.virtualized ? <li className="rail-spacer" style={{ height: window.padEnd }} aria-hidden="true" /> : null}
      </ul>
    </aside>
  )
}, areRailPropsEqual)
