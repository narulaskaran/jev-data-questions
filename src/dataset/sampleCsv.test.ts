import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateCsvText } from './validateDataset'
import {
  footballSampleCsv,
  SAMPLE_CSV_FILES,
  squirrelSampleCsv,
} from './sampleCsv'
import { footballFixtureWinLikelihoodInputFields, getWinLikelihoodModelInput } from '../fixtures/footballTimeline'
import { getSquirrelModelInput, SQUIRREL_FIXTURE_SCHEMA } from '../fixtures/squirrelCensus'

describe('public sample CSVs for BYOD', () => {
  it('keeps Super Bowl and squirrel fixtures as raw CSV assets', () => {
    const footballCsv = readFileSync(SAMPLE_CSV_FILES.football.relPath, 'utf8')
    const squirrelCsv = readFileSync(SAMPLE_CSV_FILES.squirrel.relPath, 'utf8')
    expect(footballCsv).toBe(footballSampleCsv())
    expect(squirrelCsv).toBe(squirrelSampleCsv())

    const football = validateCsvText(footballCsv)
    expect(football.acceptedRowCount).toBe(getWinLikelihoodModelInput().length)
    expect(football.columns.map((column) => column.name)).toEqual([...footballFixtureWinLikelihoodInputFields])
    expect(SAMPLE_CSV_FILES.football.publicPath).toBe('/samples/seahawks-super-bowl-2026.csv')

    const squirrel = validateCsvText(squirrelCsv)
    expect(squirrel.acceptedRowCount).toBe(getSquirrelModelInput().length)
    expect(squirrel.columns.map((column) => column.name)).toEqual([...SQUIRREL_FIXTURE_SCHEMA])
    expect(SAMPLE_CSV_FILES.squirrel.publicPath).toBe('/samples/nyc-squirrel-census.csv')
  })
})
