import type { AnalysisRowInput, DatasetColumn } from './csvTypes.js'

const columnType = (values: unknown[]): DatasetColumn['inferredType'] => {
  const present = values.filter((value) => value !== null && value !== undefined && value !== '')
  if (present.length === 0) return 'empty'
  if (present.every((value) => typeof value === 'number')) return 'number'
  if (present.every((value) => typeof value === 'boolean')) return 'boolean'
  return 'string'
}

export const inferSampleColumns = (rows: readonly AnalysisRowInput[], names: readonly string[]): DatasetColumn[] => (
  names.map((name) => ({
    name,
    normalizedName: name,
    inferredType: columnType(rows.map((row) => row[name])),
  }))
)
