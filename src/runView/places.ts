import type { AnalysisResultRow, AnalysisRowInput } from '../shared/analysis'

export interface GeoPoint {
  rowIndex: number
  x: number
  y: number
  weight: number
  eating?: boolean
  label: string
}

export interface PlaceRank {
  name: string
  count: number
  eating: number
  unknown: number
  weight: number
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const asNumber = (value: unknown): number | undefined => {
  if (finite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const asBool = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    if (trimmed === 'true' || trimmed === 'yes') return true
    if (trimmed === 'false' || trimmed === 'no') return false
  }
  return undefined
}

const LAT_NAME_RE = /^(y|lat|latitude)$/i
const LNG_NAME_RE = /^(x|lng|lon|long|longitude)$/i
const PLACE_NAME_RE = /^(location|specific_location|hectare|place|park|neighborhood)$/i
const EATING_NAME_RE = /^(eating|foraging)$/i

export const findLatLngColumns = (input: Record<string, unknown>): { lat: string; lng: string } | undefined => {
  const keys = Object.keys(input)
  const lat = keys.find((name) => LAT_NAME_RE.test(name))
  const lng = keys.find((name) => LNG_NAME_RE.test(name))
  if (!lat || !lng) return undefined
  const latitude = asNumber(input[lat])
  const longitude = asNumber(input[lng])
  if (latitude === undefined || longitude === undefined) return undefined
  // Named latitude/longitude are geographic coordinates. Generic x/y columns
  // may be local projected coordinates, so retain those when finite.
  if (/^(lat|latitude)$/i.test(lat) && (latitude < -90 || latitude > 90)) return undefined
  if (/^(lng|lon|long|longitude)$/i.test(lng) && (longitude < -180 || longitude > 180)) return undefined
  return { lat, lng }
}

export const findPlaceColumn = (input: Record<string, unknown>, preferred?: readonly string[]): string | undefined => {
  if (preferred) {
    for (const name of preferred) {
      if (input[name] !== undefined && input[name] !== null && input[name] !== '') return name
    }
  }
  return Object.keys(input).find((name) => PLACE_NAME_RE.test(name) && input[name] !== undefined && input[name] !== null && input[name] !== '')
}

const eatingStatus = (input: AnalysisRowInput): boolean | undefined => {
  for (const [key, value] of Object.entries(input)) {
    if (!EATING_NAME_RE.test(key)) continue
    const flag = asBool(value)
    if (flag !== undefined) return flag
  }
  return undefined
}

const PLACE_ALIASES: Record<string, string> = {
  'ground plane': 'On the ground',
  ground: 'On the ground',
  'above ground': 'In the trees',
  above_ground: 'In the trees',
}

export const humanPlaceLabel = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return PLACE_ALIASES[trimmed.toLowerCase()] ?? trimmed
}

const placeLabel = (input: AnalysisRowInput): string => {
  const column = findPlaceColumn(input)
  if (!column) return ''
  const value = input[column]
  if (value === null || value === undefined) return ''
  return humanPlaceLabel(String(value))
}

export const projectPlaces = (
  rows: readonly Pick<AnalysisResultRow, 'rowIndex' | 'input' | 'value'>[],
): { points: GeoPoint[]; ranks: PlaceRank[]; hasMap: boolean } => {
  const points: GeoPoint[] = []
  const ranks = new Map<string, PlaceRank>()
  let hasMap = false
  for (const row of rows) {
    const geo = findLatLngColumns(row.input)
    const eating = eatingStatus(row.input)
    // Unknown eating values remain visually neutral and never become an
    // invented eating/not-eating count. Jev scores are unrelated to this
    // dataset attribute and must not override it.
    const weight = eating === true ? 1 : eating === false ? 0 : 0.35
    const label = placeLabel(row.input)
    if (geo) {
      const x = asNumber(row.input[geo.lng])
      const y = asNumber(row.input[geo.lat])
      if (x !== undefined && y !== undefined) {
        hasMap = true
        points.push({ rowIndex: row.rowIndex, x, y, weight, eating, label })
      }
    }
    if (label) {
      const current = ranks.get(label) ?? { name: label, count: 0, eating: 0, unknown: 0, weight: 0 }
      current.count += 1
      if (eating === true) current.eating += 1
      else if (eating === undefined) current.unknown += 1
      current.weight += weight
      ranks.set(label, current)
    }
  }
  const ranked = [...ranks.values()].sort((left, right) => right.eating - left.eating || right.weight - left.weight || right.count - left.count || left.name.localeCompare(right.name))
  return { points, ranks: ranked, hasMap }
}

export const normalizePoints = (points: readonly GeoPoint[]): Array<GeoPoint & { px: number; py: number }> => {
  if (points.length === 0) return []
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1e-6)
  const spanY = Math.max(maxY - minY, 1e-6)
  const pad = 0.08
  return points.map((point) => ({
    ...point,
    px: pad + ((point.x - minX) / spanX) * (1 - pad * 2),
    py: pad + (1 - (point.y - minY) / spanY) * (1 - pad * 2),
  }))
}

export const placeCountLabel = (name: string, count: number): string => `${name} · ${count}`
