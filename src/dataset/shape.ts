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

const LAT_NAME_RE = /^(y|lat|latitude)$/i
const LNG_NAME_RE = /^(x|lng|lon|long|longitude)$/i
const TIME_NAME_RE = /(date|time|timestamp|seconds_remaining|play_id|qtr|week)$/i
const PLACE_NAME_RE = /^(location|specific_location|hectare|place|park|neighborhood|venue|city|area)$/i
const ID_NAME_RE = /(^id$|_id$|uuid|unique_)/i
const EATING_NAME_RE = /^(eating|foraging)$/i
const ACTIVITY_NAME_RE = /^(activity|activities|behavior|behaviours?|action)$/i
const EATING_VALUE_RE = /^(eating|foraging|eat)$/i

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const asNumber = (value: unknown): number | undefined => {
  if (finiteNumber(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const uniqueCount = (rows: readonly AnalysisRowInput[], name: string): number => {
  const seen = new Set<string>()
  for (const row of rows) {
    const value = row[name]
    if (value === null || value === undefined || value === '') continue
    seen.add(String(value))
  }
  return seen.size
}

const hasFractional = (values: readonly number[]): boolean => (
  values.some((value) => Math.abs(value - Math.round(value)) > 1e-6)
)

const looksLikeLat = (name: string, values: readonly number[]): boolean => {
  if (LNG_NAME_RE.test(name)) return false
  if (values.length === 0) return false
  if (!values.every((value) => value >= -90 && value <= 90)) return false
  if (LAT_NAME_RE.test(name)) return true
  return hasFractional(values) && values.some((value) => Math.abs(value) > 1 && Math.abs(value) < 90)
}

const looksLikeLng = (name: string, values: readonly number[]): boolean => {
  if (LAT_NAME_RE.test(name)) return false
  if (values.length === 0) return false
  if (!values.every((value) => value >= -180 && value <= 180)) return false
  if (LNG_NAME_RE.test(name)) return true
  return hasFractional(values) && values.some((value) => Math.abs(value) > 90 || Math.abs(value) > 20)
}

const findGeoPair = (columns: readonly ColumnShape[], rows: readonly AnalysisRowInput[]): GeoPair | undefined => {
  const namedLat = columns.find((column) => LAT_NAME_RE.test(column.name) || LAT_NAME_RE.test(column.normalizedName))
  const namedLng = columns.find((column) => LNG_NAME_RE.test(column.name) || LNG_NAME_RE.test(column.normalizedName))
  if (namedLat && namedLng && namedLat.name !== namedLng.name) return { lat: namedLat.name, lng: namedLng.name }
  const lat = columns.find((column) => column.role === 'geo' && LAT_NAME_RE.test(column.name))
  const lng = columns.find((column) => column.role === 'geo' && LNG_NAME_RE.test(column.name))
  if (lat && lng && lat.name !== lng.name) return { lat: lat.name, lng: lng.name }
  const numeric = columns.filter((column) => column.inferredType === 'number' || column.role === 'geo')
  const latGuess = numeric.find((column) => looksLikeLat(column.name, numericValues(rows, column.name)))
  const lngGuess = numeric.find((column) => column.name !== latGuess?.name && looksLikeLng(column.name, numericValues(rows, column.name)))
  if (latGuess && lngGuess) return { lat: latGuess.name, lng: lngGuess.name }
  return undefined
}

const numericValues = (rows: readonly AnalysisRowInput[], name: string): number[] => {
  const values: number[] = []
  for (const row of rows) {
    const value = asNumber(row[name])
    if (value !== undefined) values.push(value)
  }
  return values
}

const roleFor = (
  column: DatasetColumn,
  cardinality: number,
  uniqueRatio: number,
  numeric: readonly number[],
  rowCount: number,
): ColumnRole => {
  if (column.inferredType === 'empty') return 'empty'
  if (LAT_NAME_RE.test(column.name) || LNG_NAME_RE.test(column.name) || LAT_NAME_RE.test(column.normalizedName) || LNG_NAME_RE.test(column.normalizedName)) {
    return 'geo'
  }
  if (column.inferredType === 'number' && (looksLikeLat(column.name, numeric) || looksLikeLng(column.name, numeric))) {
    if (Math.abs(numeric[0] ?? 0) > 1) return 'geo'
  }
  if (PLACE_NAME_RE.test(column.name) || PLACE_NAME_RE.test(column.normalizedName)) return 'place'
  if (column.inferredType === 'boolean' || EATING_NAME_RE.test(column.name)) return 'boolean'
  if (TIME_NAME_RE.test(column.name) || TIME_NAME_RE.test(column.normalizedName)) return 'time'
  if (ID_NAME_RE.test(column.name) || (uniqueRatio > 0.95 && rowCount > 8)) return 'id'
  if (column.inferredType === 'number') return 'numeric'
  if (cardinality >= 1 && cardinality <= 24 && uniqueRatio <= 0.5) return 'categorical'
  if (column.inferredType === 'string') return 'categorical'
  return 'numeric'
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
  const shaped: ColumnShape[] = columns.map((column) => {
    const cardinality = uniqueCount(rows, column.name)
    const uniqueRatio = rowCount === 0 ? 0 : cardinality / rowCount
    const numeric = numericValues(rows, column.name)
    return {
      name: column.name,
      normalizedName: column.normalizedName,
      inferredType: column.inferredType,
      role: roleFor(column, cardinality, uniqueRatio, numeric, rowCount),
      cardinality,
      uniqueRatio,
    }
  })
  const geo = findGeoPair(shaped, rows)
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
