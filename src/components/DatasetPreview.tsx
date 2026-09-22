import { useEffect, useMemo, useRef, useState } from 'react'
import type { DatasetPreview } from '../shared/dataset'
import { PREVIEW_VIEWPORT_SIZE, previewWindow } from '../dataset/previewWindow'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardFooter, CardHeader } from './ui/card'

const previewValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

const sourceLabel = (sourceType: DatasetPreview['sourceType']) => {
  if (sourceType === 'fixture') return 'Sample'
  if (sourceType === 'upload') return 'Uploaded CSV'
  return 'Public CSV'
}

export const isNarrowPreview = (): boolean => {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia === 'function') return window.matchMedia('(max-width: 390px)').matches
  return window.innerWidth <= 390
}

export const DatasetPreviewCard = ({ dataset, onChange }: { dataset: DatasetPreview; onChange?: () => void }) => {
  const columns = dataset.columns
  const rows = dataset.previewRows
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(PREVIEW_VIEWPORT_SIZE)
  const [previewOpen, setPreviewOpen] = useState(() => !isNarrowPreview())
  const narrowRef = useRef(isNarrowPreview())

  useEffect(() => {
    const sync = () => {
      const next = isNarrowPreview()
      if (narrowRef.current === next) return
      narrowRef.current = next
      setPreviewOpen(!next)
    }
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return undefined
    const measure = () => setViewportHeight(node.clientHeight || PREVIEW_VIEWPORT_SIZE)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [rows.length, columns.length])

  const window = useMemo(
    () => previewWindow({
      rowCount: rows.length,
      columnCount: columns.length,
      scrollOffset: scrollTop,
      viewportSize: viewportHeight,
    }),
    [columns.length, rows.length, scrollTop, viewportHeight],
  )
  const visible = window.virtualized ? rows.slice(window.start, window.end) : rows

  return (
    <Card className="dataset-preview is-secondary" aria-labelledby="dataset-heading">
      <CardHeader className="section-heading flex-row items-start justify-between space-y-0">
        <div>
          <p className="eyebrow">{sourceLabel(dataset.sourceType)}</p>
          <h2 id="dataset-heading">{dataset.displayName}</h2>
        </div>
        <Badge variant="secondary">{dataset.acceptedRowCount} rows</Badge>
      </CardHeader>
      <CardContent>
        {columns.length > 0 ? (
          <p className="preview-meta">{columns.length} columns</p>
        ) : null}
        <details className="preview-fold" open={previewOpen} onToggle={(event) => setPreviewOpen((event.currentTarget as HTMLDetailsElement).open)}>
          <summary className="preview-fold-summary">Preview table</summary>
          <div
            ref={scrollRef}
            className={`table-scroll preview-table${window.virtualized ? ' is-virtualized' : ''}`}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
          <table aria-label="Dataset preview" aria-rowcount={1 + rows.length}>
            <thead>
              <tr>
                {columns.map((column, index) => (
                  <th key={column.name} className={index === 0 ? 'is-sticky' : undefined}>{column.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {window.virtualized && window.padStart > 0 ? (
                <tr aria-hidden="true">
                  <td
                    className="preview-spacer"
                    colSpan={Math.max(1, columns.length)}
                    style={{ height: window.padStart }}
                  />
                </tr>
              ) : null}
              {visible.map((row, offset) => {
                const rowIndex = window.virtualized ? window.start + offset : offset
                return (
                  <tr key={rowIndex} aria-rowindex={rowIndex + 2}>
                    {columns.map((column, index) => (
                      <td key={column.name} className={index === 0 ? 'is-sticky' : undefined}>{previewValue(row[column.name])}</td>
                    ))}
                  </tr>
                )
              })}
              {window.virtualized && window.padEnd > 0 ? (
                <tr aria-hidden="true">
                  <td
                    className="preview-spacer"
                    colSpan={Math.max(1, columns.length)}
                    style={{ height: window.padEnd }}
                  />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        </details>
      </CardContent>
      {onChange && (
        <CardFooter className="preview-actions">
          <Button variant="ghost" type="button" onClick={onChange}>Change dataset</Button>
        </CardFooter>
      )}
    </Card>
  )
}
