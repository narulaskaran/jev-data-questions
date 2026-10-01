import rawFixture from './data/nyc-squirrel-census-2018.json' with { type: 'json' }
import { asAnalysisRow, type DatasetPreview } from '../shared/dataset.js'
import { inferSampleColumns } from '../dataset/sampleColumns.js'
import type { AnalysisRowInput } from '../dataset/csvTypes.js'
import {
  SQUIRREL_EATING_NOUL_QUERY,
  SQUIRREL_EATING_TASK,
} from '../shared/questionKind.js'
import {
  SQUIRREL_DATASET_NAME,
  SQUIRREL_FIXTURE_ID,
  SQUIRREL_FIXTURE_SCHEMA,
  type SquirrelSighting,
} from './squirrelCensusMeta.js'

export {
  SQUIRREL_DATASET_NAME,
  SQUIRREL_FIXTURE_ID,
  SQUIRREL_FIXTURE_SCHEMA,
  type SquirrelFixtureField,
  type SquirrelSighting,
} from './squirrelCensusMeta.js'
export { SQUIRREL_EATING_NOUL_QUERY, SQUIRREL_EATING_TASK }

interface SquirrelFixtureFile {
  manifest: {
    source_url: string
    download_url: string
    license_url: string
    attribution: string
    source_sha256: string
    source_rows: number
    rows: number
    note: string
  }
  columns: string[]
  flags: string[]
  rows: Array<Array<string | number | null>>
}

const fixture = rawFixture as SquirrelFixtureFile

export const squirrelFixtureManifest = Object.freeze({ ...fixture.manifest })

const buildRows = (): SquirrelSighting[] => {
  const flags = new Set(fixture.flags)
  return fixture.rows.map((values) => {
    const row: Record<string, string | number | boolean | null> = {}
    fixture.columns.forEach((name, index) => {
      const value = values[index] ?? null
      row[name] = flags.has(name) ? value === 1 : value
    })
    return row as unknown as SquirrelSighting
  })
}

export const squirrelFixtureRows: readonly SquirrelSighting[] = Object.freeze(buildRows())

export const squirrelFixtureDisclosure =
  'All 3,023 sightings from the 2018 Central Park Squirrel Census, with a subset of the public columns.'

export const squirrelFixtureSourceLinks = Object.freeze({
  sourceUrl: fixture.manifest.source_url,
  licenseUrl: fixture.manifest.license_url,
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
