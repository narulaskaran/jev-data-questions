import type { AnalysisSnapshot } from '../shared/analysis'
import { inferQuestionKind } from '../shared/questionKind'

const FORMULA_PREFIX = /^[=+\-@\t\r]/

export const escapeCsvCell = (value: string): string => {
  const prefixed = FORMULA_PREFIX.test(value) ? `'${value}` : value
  if (/[",\n\r]/.test(prefixed)) return `"${prefixed.replace(/"/g, '""')}"`
  return prefixed
}

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return String(value)
}

const probability = (value: number | undefined): string => (
  value === undefined || !Number.isFinite(value) ? '' : String(value)
)

export const resultsCsv = (snapshot: AnalysisSnapshot): string => {
  const kind = inferQuestionKind(snapshot.query, snapshot.classes, snapshot.questionKind)
  const classes = kind === 'choice' ? [...snapshot.classes] : []
  const header = kind === 'choice' ? ['row_id', 'selected_class', ...classes] : ['row_id', kind === 'score' ? 'score' : 'probability']
  const lines = [header.map(escapeCsvCell).join(',')]
  for (const row of [...snapshot.resultRows].sort((left, right) => left.rowIndex - right.rowIndex)) {
    const rowId = String(row.rowIndex + 1)
    if (kind === 'choice') {
      lines.push([rowId, cell(row.selectedClass), ...classes.map((name) => probability(row.probabilities?.[name]))].map(escapeCsvCell).join(','))
      continue
    }
    lines.push([rowId, probability(row.value)].map(escapeCsvCell).join(','))
  }
  return `${lines.join('\n')}\n`
}

export const resultsCsvFilename = (snapshot: AnalysisSnapshot): string => {
  const id = snapshot.analysisId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'run'
  return `jev-results-${id}.csv`
}

export const downloadTextFile = (filename: string, contents: string, mime = 'text/csv;charset=utf-8'): void => {
  const blob = new Blob([contents], { type: mime })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}
