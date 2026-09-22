import type { AnalysisResultRow, AnalysisRowInput } from '../shared/analysis'
import { clamp01 } from '../shared/questionKind'

export interface GeoPoint {
  rowIndex: number
  x: number
  y: number
  weight: number
  label: string
}

export interface PlaceRank {
  name: string
  count: number
  eating: number
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
  if (lat && lng && asNumber(input[lat]) !== undefined && asNumber(input[lng]) !== undefined) {
    return { lat, lng }
  }
  return undefined
}

export const findPlaceColumn = (input: Record<string, unknown>, preferred?: readonly string[]): string | undefined => {
  if (preferred) {
    for (const name of preferred) {
      if (input[name] !== undefined && input[name] !== null && input[name] !== '') return name
    }
  }
  return Object.keys(input).find((name) => PLACE_NAME_RE.test(name) && input[name] !== undefined && input[name] !== null && input[name] !== '')
}

const rowWeight = (row: { value?: number; input: AnalysisRowInput }): number => {
  if (finite(row.value)) return clamp01(row.value)
  for (const [key, value] of Object.entries(row.input)) {
    if (!EATING_NAME_RE.test(key)) continue
    const flag = asBool(value)
    if (flag === true) return 1
    if (flag === false) return 0
  }
  return 0.35
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
    const weight = rowWeight(row)
    const label = placeLabel(row.input)
    if (geo) {
      const x = asNumber(row.input[geo.lng])
      const y = asNumber(row.input[geo.lat])
      if (x !== undefined && y !== undefined) {
        hasMap = true
        points.push({ rowIndex: row.rowIndex, x, y, weight, label })
      }
    }
    if (label) {
      const current = ranks.get(label) ?? { name: label, count: 0, eating: 0, weight: 0 }
      current.count += 1
      current.eating += weight >= 0.5 ? 1 : 0
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

export interface PlaceLabel {
  name: string
  px: number
  py: number
  eating: number
  count: number
}

export const placeCountLabel = (name: string, count: number): string => `${name} · ${count}`

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0.5
  const sorted = [...values].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export const placeCentroids = (
  points: readonly (GeoPoint & { px: number; py: number })[],
): PlaceLabel[] => {
  const groups = new Map<string, { xs: number[]; ys: number[]; eatXs: number[]; eatYs: number[]; eating: number; count: number }>()
  for (const point of points) {
    const name = point.label.trim() || 'Place'
    const current = groups.get(name) ?? { xs: [], ys: [], eatXs: [], eatYs: [], eating: 0, count: 0 }
    current.xs.push(point.px)
    current.ys.push(point.py)
    current.count += 1
    if (point.weight >= 0.5) {
      current.eating += 1
      current.eatXs.push(point.px)
      current.eatYs.push(point.py)
    }
    groups.set(name, current)
  }
  return [...groups.entries()].map(([name, value]) => ({
    name,
    px: median(value.eatXs.length > 0 ? value.eatXs : value.xs),
    py: median(value.eatYs.length > 0 ? value.eatYs : value.ys),
    eating: value.eating,
    count: value.count,
  }))
}

type LabelBox = { left: number; right: number; top: number; bottom: number }

const MAP_LABEL_CHAR_W = 0.016
const MAP_LABEL_PAD_W = 0.06
const MAP_LABEL_H = 0.12
const MAP_LABEL_MAX_W = 0.7
const MAP_EDGE = 0.03

const OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: -0.1 },
  { dx: 0.18, dy: -0.1 },
  { dx: -0.18, dy: -0.1 },
  { dx: 0.26, dy: 0.02 },
  { dx: -0.26, dy: 0.02 },
  { dx: 0, dy: 0.14 },
  { dx: 0.22, dy: 0.14 },
  { dx: -0.22, dy: 0.14 },
  { dx: 0.32, dy: -0.04 },
  { dx: -0.32, dy: -0.04 },
  { dx: 0.28, dy: -0.18 },
  { dx: -0.28, dy: -0.18 },
  { dx: 0.08, dy: -0.2 },
  { dx: -0.08, dy: -0.2 },
]

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const mapLabelText = (label: Pick<PlaceLabel, 'name' | 'eating'>): string => (
  `${label.name} · ${label.eating} eating`
)

export const estimateMapLabelSize = (label: Pick<PlaceLabel, 'name' | 'eating'>): { width: number; height: number } => {
  const width = Math.min(MAP_LABEL_MAX_W, MAP_LABEL_PAD_W + mapLabelText(label).length * MAP_LABEL_CHAR_W)
  return { width, height: MAP_LABEL_H }
}

export const boxesOverlap = (left: LabelBox, right: LabelBox, pad = 0.03): boolean => (
  left.left < right.right + pad
  && left.right + pad > right.left
  && left.top < right.bottom + pad
  && left.bottom + pad > right.top
)

const boxAt = (px: number, py: number, width: number, height: number): LabelBox => ({
  left: px - width / 2,
  right: px + width / 2,
  top: py - height / 2,
  bottom: py + height / 2,
})

const fitsPlot = (box: LabelBox): boolean => (
  box.left >= MAP_EDGE && box.right <= 1 - MAP_EDGE && box.top >= MAP_EDGE && box.bottom <= 0.82
)

/** Keep the highest-eating labels; offset or hide the rest so pins don't collide. */
export const declutterPlaceLabels = (
  labels: readonly PlaceLabel[],
  options: { maxVisible?: number } = {},
): PlaceLabel[] => {
  if (labels.length === 0) return []
  const maxVisible = Math.max(1, options.maxVisible ?? 4)
  const ranked = [...labels].sort((left, right) => (
    right.eating - left.eating
    || right.count - left.count
    || left.name.localeCompare(right.name)
  ))
  const placed: Array<PlaceLabel & { box: LabelBox }> = []
  for (const label of ranked) {
    if (placed.length >= maxVisible) break
    const { width, height } = estimateMapLabelSize(label)
    let next: (PlaceLabel & { box: LabelBox }) | undefined
    for (const offset of OFFSETS) {
      const px = clamp(label.px + offset.dx, MAP_EDGE + width / 2, 1 - MAP_EDGE - width / 2)
      const py = clamp(label.py + offset.dy, MAP_EDGE + height / 2, 0.82 - height / 2)
      const box = boxAt(px, py, width, height)
      if (!fitsPlot(box)) continue
      if (placed.some((item) => boxesOverlap(item.box, box))) continue
      next = { ...label, px, py, box }
      break
    }
    if (!next && placed.length === 0) {
      const px = clamp(label.px, MAP_EDGE + width / 2, 1 - MAP_EDGE - width / 2)
      const py = clamp(label.py - 0.1, MAP_EDGE + height / 2, 0.82 - height / 2)
      next = { ...label, px, py, box: boxAt(px, py, width, height) }
    }
    if (next) placed.push(next)
  }
  return placed.map((item) => ({
    name: item.name,
    px: item.px,
    py: item.py,
    eating: item.eating,
    count: item.count,
  }))
}
