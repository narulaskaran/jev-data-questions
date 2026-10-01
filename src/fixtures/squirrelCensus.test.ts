import { describe, expect, it } from 'vitest'
import { getSampleDatasetPreview } from '../dataset/sampleDataset'
import {
  SQUIRREL_FIXTURE_ID,
  SQUIRREL_FIXTURE_SCHEMA,
  getSquirrelDatasetPreview,
  squirrelFixtureManifest,
  squirrelFixtureRows,
} from './squirrelCensus'

describe('squirrel census fixture', () => {
  it('holds every sighting from the public census export, not synthetic rows', () => {
    expect(squirrelFixtureManifest.rows).toBe(3023)
    expect(squirrelFixtureManifest.source_rows).toBe(3023)
    expect(squirrelFixtureManifest.source_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(squirrelFixtureRows).toHaveLength(3023)
    // Central Park's bounding box.
    expect(squirrelFixtureRows.every((row) => row.longitude < -73.94 && row.longitude > -73.99)).toBe(true)
    expect(squirrelFixtureRows.every((row) => row.latitude > 40.76 && row.latitude < 40.81)).toBe(true)
    expect(squirrelFixtureRows.every((row) => /^2018-10-\d{2}$/.test(row.date))).toBe(true)
    // Counts published with the census.
    expect(squirrelFixtureRows.filter((row) => row.eating).length).toBe(760)
    expect(squirrelFixtureRows.filter((row) => row.primary_fur_color === 'Gray').length).toBe(2473)
    expect(squirrelFixtureRows.filter((row) => row.location === 'Ground Plane').length).toBe(2116)
  })

  it('keeps unrecorded values as null instead of a placeholder category', () => {
    expect(new Set(squirrelFixtureRows.map((row) => row.age))).toEqual(new Set(['Adult', 'Juvenile', null]))
    expect(new Set(squirrelFixtureRows.map((row) => row.location))).toEqual(new Set(['Ground Plane', 'Above Ground', null]))
    expect(squirrelFixtureRows.every((row) => typeof row.eating === 'boolean' && typeof row.runs_from === 'boolean')).toBe(true)
  })

  it('exposes the rows as a public fixture dataset with its source', () => {
    const preview = getSquirrelDatasetPreview()
    expect(preview.datasetId).toBe(SQUIRREL_FIXTURE_ID)
    expect(preview.displayName).toBe('Squirrel census')
    expect(preview.acceptedRowCount).toBe(squirrelFixtureRows.length)
    expect(preview.columns.map((column) => column.name)).toEqual([...SQUIRREL_FIXTURE_SCHEMA])
    expect(preview.attribution?.sourceUrl).toMatch(/^https:\/\/data\.cityofnewyork\.us\//)
  })

  it('stays a separate sample from the Super Bowl fixture', () => {
    expect(getSampleDatasetPreview().datasetId).not.toBe(SQUIRREL_FIXTURE_ID)
    expect(getSampleDatasetPreview().displayName).toBe('2026 Super Bowl Demo')
  })
})
