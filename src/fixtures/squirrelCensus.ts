import { asAnalysisRow, type DatasetPreview } from '../shared/dataset.js'
import { inferSampleColumns } from '../dataset/sampleColumns.js'
import type { AnalysisRowInput } from '../dataset/csvTypes.js'
import {
  SQUIRREL_EATING_NOUL_QUERY,
  SQUIRREL_EATING_TASK,
} from '../shared/questionKind.js'

export const SQUIRREL_FIXTURE_ID = 'nyc-squirrel-census-2018-jev-v1'
export const SQUIRREL_DATASET_NAME = 'Squirrel census'
export { SQUIRREL_EATING_NOUL_QUERY, SQUIRREL_EATING_TASK }

export const SQUIRREL_FIXTURE_SCHEMA = [
  'unique_squirrel_id',
  'x',
  'y',
  'hectare',
  'shift',
  'date',
  'age',
  'primary_fur_color',
  'location',
  'specific_location',
  'eating',
  'foraging',
  'running',
  'climbing',
] as const

export type SquirrelFixtureField = typeof SQUIRREL_FIXTURE_SCHEMA[number]

export interface SquirrelSighting {
  unique_squirrel_id: string
  x: number
  y: number
  hectare: string
  shift: 'AM' | 'PM'
  date: string
  age: 'Adult' | 'Juvenile'
  primary_fur_color: 'Gray' | 'Cinnamon' | 'Black'
  location: 'Ground Plane' | 'Above Ground'
  specific_location: string | null
  eating: boolean
  foraging: boolean
  running: boolean
  climbing: boolean
}

const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0
  return () => {
    t += 0x6D2B79F5
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(rand: () => number, values: readonly T[]): T => values[Math.floor(rand() * values.length)]!

const HECTARES = ['07F', '11B', '13A', '14D', '16C', '22A', '32E', '33B'] as const
const COLORS = ['Gray', 'Cinnamon', 'Black'] as const
const AGES = ['Adult', 'Juvenile'] as const
const GROUND_SPOTS = ['lawn', 'near bench', 'by path', 'under tree'] as const
const ABOVE_SPOTS = ['tree limb', 'trunk', 'branch'] as const

/** Central Park bounds used by the 2018 census (X=lng, Y=lat). */
const LNG_MIN = -73.9814
const LNG_MAX = -73.9494
const LAT_MIN = 40.7648
const LAT_MAX = 40.8003

const buildRows = (count = 96): SquirrelSighting[] => {
  const rand = mulberry32(2018_10_13)
  const rows: SquirrelSighting[] = []
  for (let index = 0; index < count; index += 1) {
    const hectare = HECTARES[index % HECTARES.length]!
    const shift = index % 3 === 0 ? 'PM' : 'AM'
    const above = rand() < 0.32
    const location: SquirrelSighting['location'] = above ? 'Above Ground' : 'Ground Plane'
    const eating = above ? rand() < 0.22 : rand() < 0.48
    const foraging = eating ? rand() < 0.55 : rand() < 0.28
    const climbing = above && rand() < 0.6
    const running = !climbing && rand() < 0.2
    const day = 6 + (index % 20)
    rows.push({
      unique_squirrel_id: `${hectare}-${shift}-${String(1000 + index).slice(1)}-${String((index % 9) + 1).padStart(2, '0')}`,
      x: LNG_MIN + (index % 12) * ((LNG_MAX - LNG_MIN) / 11) + (rand() - 0.5) * 0.0012,
      y: LAT_MIN + Math.floor(index / 12) * ((LAT_MAX - LAT_MIN) / 7) + (rand() - 0.5) * 0.001,
      hectare,
      shift,
      date: `101${String(day).padStart(2, '0')}2018`,
      age: pick(rand, AGES),
      primary_fur_color: pick(rand, COLORS),
      location,
      specific_location: location === 'Above Ground' ? pick(rand, ABOVE_SPOTS) : pick(rand, GROUND_SPOTS),
      eating,
      foraging,
      running,
      climbing,
    })
  }
  return rows
}

export const squirrelFixtureRows: readonly SquirrelSighting[] = Object.freeze(buildRows())

export const squirrelFixtureDisclosure =
  'Slim demo fixture from the 2018 Central Park Squirrel Census schema (place, eating, lat/lng). Not the full 3k-row public table.'

export const squirrelFixtureSourceLinks = Object.freeze({
  sourceUrl: 'https://data.cityofnewyork.us/Environment/2018-Central-Park-Squirrel-Census-Squirrel-Data/vfnx-vebw',
  licenseUrl: 'https://www.nyc.gov/home/terms-of-use.page',
})

export const getSquirrelModelInput = (rows: readonly SquirrelSighting[] = squirrelFixtureRows): AnalysisRowInput[] => (
  rows.map((row) => asAnalysisRow(row))
)

export const getSquirrelDatasetPreview = (): DatasetPreview => {
  const rows = getSquirrelModelInput()
  return {
    datasetId: SQUIRREL_FIXTURE_ID,
    sourceType: 'fixture',
    displayName: SQUIRREL_DATASET_NAME,
    byteSize: 0,
    contentHash: 'fixture-squirrel',
    encoding: 'utf-8',
    delimiter: ',',
    columns: inferSampleColumns(rows, [...SQUIRREL_FIXTURE_SCHEMA]),
    acceptedRowCount: rows.length,
    previewRows: rows,
    validationWarnings: [],
    publicDataWarning: 'Sample rows are a checked-in demo fixture. They are public.',
    attribution: {
      disclosure: squirrelFixtureDisclosure,
      sourceUrl: squirrelFixtureSourceLinks.sourceUrl,
      licenseUrl: squirrelFixtureSourceLinks.licenseUrl,
    },
  }
}
