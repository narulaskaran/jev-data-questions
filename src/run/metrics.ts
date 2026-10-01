import type { AnalysisClass, AnalysisMeta, AnalysisViewRow } from '../shared/analysis'
import type { AnalysisRowValue } from '../dataset/csvTypes'

/** Class and answer names are compared case- and whitespace-insensitively. */
export const normalizeLabel = (value: AnalysisRowValue | undefined): string => (
  value === null || value === undefined ? '' : String(value).trim().toLowerCase()
)

export const labelIndexOf = (analysis: Pick<AnalysisMeta, 'columns' | 'labelColumn'>): number => (
  analysis.labelColumn ? analysis.columns.indexOf(analysis.labelColumn) : -1
)

export interface ClassCounts {
  /** Index-aligned with the analysis classes. */
  counts: number[]
  failed: number
  classified: number
}

/** Tally of the first `upto` rows. Linear, so scrubbing 5,000 rows stays instant. */
export const countClasses = (rows: readonly AnalysisViewRow[], classes: readonly AnalysisClass[], upto: number): ClassCounts => {
  const indexByName = new Map(classes.map((item, index) => [item.name, index]))
  const counts = classes.map(() => 0)
  let failed = 0
  let classified = 0
  const end = Math.min(rows.length, Math.max(0, upto))
  for (let index = 0; index < end; index += 1) {
    const row = rows[index]
    const slot = row.selectedClass === undefined ? undefined : indexByName.get(row.selectedClass)
    if (slot === undefined) { failed += 1; continue }
    counts[slot] += 1
    classified += 1
  }
  return { counts, failed, classified }
}

export interface Score {
  /** Rows that have both a prediction and a recognisable answer. */
  scored: number
  correct: number
  accuracy: number | undefined
  /** What always guessing the most common answer so far would have scored. */
  baseline: { label: string; accuracy: number } | undefined
  /** matrix[actual][predicted], index-aligned with the classes. */
  matrix: number[][]
  /** Rows whose answer is not one of the labels, so they cannot be scored. */
  unmatched: number
}

export const scoreRows = (rows: readonly AnalysisViewRow[], classes: readonly AnalysisClass[], labelIndex: number, upto: number): Score | undefined => {
  if (labelIndex < 0) return undefined
  const indexByLabel = new Map(classes.map((item, index) => [normalizeLabel(item.name), index]))
  const matrix = classes.map(() => classes.map(() => 0))
  const actualTotals = classes.map(() => 0)
  let scored = 0
  let correct = 0
  let unmatched = 0
  const end = Math.min(rows.length, Math.max(0, upto))
  for (let index = 0; index < end; index += 1) {
    const row = rows[index]
    if (row.selectedClass === undefined) continue
    const predicted = indexByLabel.get(normalizeLabel(row.selectedClass))
    const actual = indexByLabel.get(normalizeLabel(row.values[labelIndex]))
    if (predicted === undefined) continue
    if (actual === undefined) { unmatched += 1; continue }
    matrix[actual][predicted] += 1
    actualTotals[actual] += 1
    scored += 1
    if (actual === predicted) correct += 1
  }
  const top = actualTotals.reduce((best, value, index) => (value > actualTotals[best] ? index : best), 0)
  return {
    scored,
    correct,
    accuracy: scored > 0 ? correct / scored : undefined,
    baseline: scored > 0 ? { label: classes[top].name, accuracy: actualTotals[top] / scored } : undefined,
    matrix,
    unmatched,
  }
}

/** undefined when the row has no answer to compare against. */
export const isCorrect = (row: AnalysisViewRow, labelIndex: number): boolean | undefined => {
  if (labelIndex < 0 || row.selectedClass === undefined) return undefined
  const actual = normalizeLabel(row.values[labelIndex])
  if (!actual) return undefined
  return actual === normalizeLabel(row.selectedClass)
}

/** Seconds until the run finishes at its observed pace, or undefined when unknowable. */
export const estimateSecondsLeft = (analysis: Pick<AnalysisMeta, 'status' | 'startedAt' | 'updatedAt' | 'progress'>): number | undefined => {
  const { completedRows, totalRows } = analysis.progress
  if (analysis.status !== 'running' || analysis.startedAt === undefined || completedRows < 4 || completedRows >= totalRows) return undefined
  const elapsedMs = analysis.updatedAt - analysis.startedAt
  if (elapsedMs <= 0) return undefined
  return Math.ceil(((totalRows - completedRows) * (elapsedMs / completedRows)) / 1000)
}

export const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export const formatPercent = (value: number | undefined, digits = 0): string => (
  value === undefined ? '—' : `${(value * 100).toFixed(digits)}%`
)

export const formatCount = (value: number): string => value.toLocaleString('en-US')

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const formatCell = (value: AnalysisRowValue | undefined): string => (
  value === null || value === undefined || value === '' ? '—' : String(value)
)
