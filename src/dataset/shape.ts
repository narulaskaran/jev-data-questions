import { profileTable, type FieldProfile } from '../insights/profile.js'
import type { AnalysisRowInput, DatasetColumn, DatasetColumnType } from './csvTypes.js'

export type ColumnRole = 'id' | 'numeric' | 'categorical' | 'boolean' | 'time' | 'geo' | 'place' | 'empty'

export interface ColumnShape {
  name: string
  normalizedName: string
  inferredType: DatasetColumnType
  role: ColumnRole
  cardinality: number
  uniqueRatio: number
}

export interface GeoPair {
  lat: string
  lng: string
}

export interface DatasetShape {
  rowCount: number
  columnCount: number
  columns: ColumnShape[]
  geo?: GeoPair
  placeColumns: string[]
  timeColumns: string[]
  booleanColumns: string[]
  sequential: boolean
  hasEating: boolean
  hasPlayState: boolean
}

const PLACE_NAME_RE = /^(location|specific_location|hectare|place|park|neighborhood|venue|city|area)$/i
const EATING_NAME_RE = /^(eating|foraging)$/i
const ACTIVITY_NAME_RE = /^(activity|activities|behavior|behaviours?|action)$/i
const EATING_VALUE_RE = /^(eating|foraging|eat)$/i

/** Column roles come from the dashboard profiler, so both views agree on what each column is. */
const roleFor = (column: DatasetColumn, field: FieldProfile): ColumnRole => {
  if (field.kind === 'empty') return 'empty'
  if (field.kind === 'latitude' || field.kind === 'longitude') return 'geo'
  if (PLACE_NAME_RE.test(column.name) || PLACE_NAME_RE.test(column.normalizedName)) return 'place'
  if (field.kind === 'flag' || EATING_NAME_RE.test(column.name)) return 'boolean'
  if (field.kind === 'time' || field.kind === 'sequence') return 'time'
  if (field.kind === 'id') return 'id'
  if (field.kind === 'measure' || field.kind === 'ordinal') return 'numeric'
  if (field.kind === 'constant') return column.inferredType === 'number' ? 'numeric' : 'categorical'
  return 'categorical'
}

const numericValues = (rows: readonly AnalysisRowInput[], name: string): number[] => {
  const values: number[] = []
  for (const row of rows) {
    const value = row[name]
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
    if (Number.isFinite(parsed)) values.push(parsed)
  }
  return values
}

const isMonotonic = (values: readonly number[]): boolean => {
  if (values.length < 3) return false
  let increases = 0
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]! >= values[index - 1]!) increases += 1
  }
  return increases / (values.length - 1) >= 0.85
}

const isEatingValue = (value: unknown): boolean => {
  if (value === true) return true
  if (typeof value === 'string') return EATING_VALUE_RE.test(value.trim())
  return false
}

const hasEatingSignal = (
  columns: readonly DatasetColumn[],
  shaped: readonly ColumnShape[],
  rows: readonly AnalysisRowInput[],
  names: ReadonlySet<string>,
): boolean => {
  if (names.has('eating') || names.has('foraging')) return true
  if (shaped.some((column) => column.role === 'boolean' && EATING_NAME_RE.test(column.name))) return true
  const activity = columns.find((column) => ACTIVITY_NAME_RE.test(column.name) || ACTIVITY_NAME_RE.test(column.normalizedName))
  if (!activity) return false
  return rows.some((row) => isEatingValue(row[activity.name]))
}

export const inspectDatasetShape = (
  columns: readonly DatasetColumn[],
  rows: readonly AnalysisRowInput[],
): DatasetShape => {
  const rowCount = rows.length
  const { fields } = profileTable(columns.map((column) => column.name), rows)
  const shaped: ColumnShape[] = columns.map((column, index) => {
    const field = fields[index]!
    return {
      name: column.name,
      normalizedName: column.normalizedName,
      inferredType: column.inferredType,
      role: roleFor(column, field),
      cardinality: field.distinct,
      uniqueRatio: rowCount === 0 ? 0 : field.distinct / rowCount,
    }
  })
  const lat = fields.find((field) => field.kind === 'latitude')
  const lng = fields.find((field) => field.kind === 'longitude')
  const geo = lat && lng ? { lat: lat.name, lng: lng.name } : undefined
  const placeColumns = shaped.filter((column) => column.role === 'place').map((column) => column.name)
  const timeColumns = shaped.filter((column) => column.role === 'time').map((column) => column.name)
  const booleanColumns = shaped.filter((column) => column.role === 'boolean').map((column) => column.name)
  const names = new Set(columns.map((column) => column.normalizedName || column.name))
  const playId = columns.find((column) => column.normalizedName === 'play_id' || column.name === 'play_id')
  const sequential = playId ? isMonotonic(numericValues(rows, playId.name)) : timeColumns.some((name) => isMonotonic(numericValues(rows, name)))
  const hasPlayState = ['play_id', 'score_differential', 'posteam_score'].every((name) => names.has(name) || columns.some((column) => column.name === name))
  return {
    rowCount,
    columnCount: columns.length,
    columns: shaped,
    geo,
    placeColumns,
    timeColumns,
    booleanColumns,
    sequential,
    hasEating: hasEatingSignal(columns, shaped, rows, names),
    hasPlayState,
  }
}

export const HUMAN_TYPE_LABELS = {
  geo: 'Places',
  place: 'Places',
  number: 'Numbers',
  numeric: 'Numbers',
  string: 'Text',
  boolean: 'Yes/no',
  empty: 'Empty',
  time: 'Time',
} as const

export const schemaStripParts = (shape: DatasetShape): string[] => {
  const parts = [`${shape.rowCount} × ${shape.columnCount}`]
  if (shape.geo || shape.placeColumns.length > 0) parts.push(HUMAN_TYPE_LABELS.geo)
  const typeCounts = new Map<string, number>()
  for (const column of shape.columns) {
    if (column.role === 'geo' || column.role === 'place') continue
    const key = column.inferredType
    typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1)
  }
  for (const key of ['number', 'string', 'boolean', 'empty'] as const) {
    const count = typeCounts.get(key)
    if (!count) continue
    parts.push(count === 1 ? HUMAN_TYPE_LABELS[key] : `${HUMAN_TYPE_LABELS[key]} ${count}`)
  }
  return parts
}

export const schemaColumnLabel = (column: ColumnShape): string => {
  if (column.role === 'geo' || column.role === 'place') return `${column.name} ${HUMAN_TYPE_LABELS.geo}`
  if (column.role === 'boolean') return `${column.name} ${HUMAN_TYPE_LABELS.boolean}`
  if (column.role === 'categorical') return `${column.name} ${column.cardinality}`
  if (column.role === 'time') return `${column.name} ${HUMAN_TYPE_LABELS.time}`
  if (column.inferredType === 'number') return `${column.name} ${HUMAN_TYPE_LABELS.number}`
  if (column.inferredType === 'string') return `${column.name} ${HUMAN_TYPE_LABELS.string}`
  if (column.inferredType === 'boolean') return `${column.name} ${HUMAN_TYPE_LABELS.boolean}`
  return `${column.name} ${HUMAN_TYPE_LABELS.empty}`
}
