import type { AnalysisMeta, AnalysisViewRow } from '../shared/analysis'
import type { AnalysisRowValue } from '../dataset/csvTypes'

/**
 * Spreadsheets execute cells that start with = + - @ (and tab / CR). The data is
 * untrusted, so such text cells are prefixed with an apostrophe. Numbers are
 * left alone.
 */
const neutralize = (value: string): string => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value)

const cell = (value: AnalysisRowValue | undefined): string => {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? neutralize(value) : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The original columns plus Jev's answer, confidence, per-label probabilities and any error. */
export const analysisToCsv = (analysis: AnalysisMeta, rows: readonly AnalysisViewRow[]): string => {
  const header = [
    ...analysis.columns,
    'jev_label',
    'jev_confidence',
    ...analysis.classes.map((item) => `p(${item.name})`),
    'jev_error',
  ]
  const lines = [header.map(cell).join(',')]
  for (const row of rows) {
    lines.push([
      ...analysis.columns.map((_, index) => cell(row.values[index])),
      cell(row.selectedClass),
      row.confidence === undefined ? '' : String(row.confidence),
      ...analysis.classes.map((_, index) => (row.probabilities?.[index] === undefined ? '' : String(row.probabilities[index]))),
      cell(row.error?.code),
    ].join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

export const exportFilename = (analysis: Pick<AnalysisMeta, 'datasetName'>): string => {
  const base = analysis.datasetName.replace(/\.csv$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'dataset'
  return `${base}-jev-results.csv`
}
