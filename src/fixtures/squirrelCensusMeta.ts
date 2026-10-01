/**
 * Squirrel fixture constants and types without the 3,023 bundled rows, so the
 * main browser chunk can name the fixture while `squirrelCensus` loads lazily.
 */

/** v2: the real census export. v1 was a 96-row synthetic table with the same shape. */
export const SQUIRREL_FIXTURE_ID = 'nyc-squirrel-census-2018-jev-v2'
export const SQUIRREL_DATASET_NAME = 'Squirrel census'

export const SQUIRREL_FIXTURE_SCHEMA = [
  'unique_squirrel_id',
  'longitude',
  'latitude',
  'hectare',
  'shift',
  'date',
  'age',
  'primary_fur_color',
  'location',
  'running',
  'chasing',
  'climbing',
  'eating',
  'foraging',
  'approaches',
  'indifferent',
  'runs_from',
] as const

export type SquirrelFixtureField = typeof SQUIRREL_FIXTURE_SCHEMA[number]

export interface SquirrelSighting {
  unique_squirrel_id: string
  longitude: number
  latitude: number
  hectare: string
  shift: 'AM' | 'PM'
  /** ISO 8601 calendar date of the sighting. */
  date: string
  /** null where the census recorded no value or "?". */
  age: 'Adult' | 'Juvenile' | null
  primary_fur_color: 'Gray' | 'Cinnamon' | 'Black' | null
  location: 'Ground Plane' | 'Above Ground' | null
  running: boolean
  chasing: boolean
  climbing: boolean
  eating: boolean
  foraging: boolean
  approaches: boolean
  indifferent: boolean
  runs_from: boolean
}
