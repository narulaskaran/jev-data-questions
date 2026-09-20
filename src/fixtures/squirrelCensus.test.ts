import { describe, expect, it } from 'vitest'
import { getSampleDatasetPreview } from '../dataset/sampleDataset'
import { getSquirrelDatasetPreview, squirrelFixtureRows, SQUIRREL_FIXTURE_ID } from './squirrelCensus'

describe('squirrel census fixture', () => {
  it('is a slim place/eating table with lat/lng, not the full 3k census', () => {
    expect(squirrelFixtureRows.length).toBeGreaterThanOrEqual(80)
    expect(squirrelFixtureRows.length).toBeLessThan(250)
    expect(squirrelFixtureRows.every((row) => typeof row.x === 'number' && typeof row.y === 'number')).toBe(true)
    expect(squirrelFixtureRows.every((row) => row.x < -73.9 && row.x > -74.0)).toBe(true)
    expect(squirrelFixtureRows.every((row) => row.y > 40.76 && row.y < 40.81)).toBe(true)
    expect(squirrelFixtureRows.some((row) => row.eating)).toBe(true)
    expect(squirrelFixtureRows.some((row) => !row.eating)).toBe(true)
    expect(new Set(squirrelFixtureRows.map((row) => row.location))).toEqual(new Set(['Ground Plane', 'Above Ground']))
    const preview = getSquirrelDatasetPreview()
    expect(preview.datasetId).toBe(SQUIRREL_FIXTURE_ID)
    expect(preview.displayName).toBe('Squirrel census')
    expect(preview.acceptedRowCount).toBe(squirrelFixtureRows.length)
    expect(preview.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'x', 'y', 'location', 'eating', 'hectare',
    ]))
    expect(preview.previewRows.some((row) => row.eating === true && row.location === 'Ground Plane')).toBe(true)
  })

  it('stays a separate sample from the Super Bowl fixture', () => {
    expect(getSampleDatasetPreview().datasetId).not.toBe(SQUIRREL_FIXTURE_ID)
    expect(getSampleDatasetPreview().displayName).toBe('2026 Super Bowl Demo')
  })
})
