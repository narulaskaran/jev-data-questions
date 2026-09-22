import {
  FOOTBALL_FIXTURE_ID,
  footballFixtureDisclosure,
  footballFixtureSourceLinks,
  footballFixtureWinLikelihoodInputFields,
  getWinLikelihoodModelInput,
} from '../fixtures/footballTimeline'
import {
  SQUIRREL_DATASET_NAME,
  SQUIRREL_FIXTURE_ID,
  getSquirrelDatasetPreview,
} from '../fixtures/squirrelCensus'
import { asAnalysisRow, type DatasetPreview } from '../shared/dataset'
import { inferSampleColumns } from './sampleColumns'
import { SAMPLE_DATASET_NAME } from '../shared/sampleDatasetName'

const rows = getWinLikelihoodModelInput().map((row) => asAnalysisRow(row))

export const SAMPLE_DATASET_ID = FOOTBALL_FIXTURE_ID
export { SAMPLE_DATASET_NAME, SQUIRREL_FIXTURE_ID, SQUIRREL_DATASET_NAME }

export const getFootballDatasetPreview = (): DatasetPreview => ({
  datasetId: SAMPLE_DATASET_ID,
  sourceType: 'fixture',
  displayName: SAMPLE_DATASET_NAME,
  byteSize: 0,
  contentHash: 'fixture',
  encoding: 'utf-8',
  delimiter: ',',
  columns: inferSampleColumns(rows, [...footballFixtureWinLikelihoodInputFields]),
  acceptedRowCount: rows.length,
  previewRows: rows,
  validationWarnings: [],
  publicDataWarning: 'Sample rows are a checked-in demo fixture. They are public.',
  attribution: {
    disclosure: footballFixtureDisclosure,
    sourceUrl: footballFixtureSourceLinks.csvFallback,
    licenseUrl: footballFixtureSourceLinks.license,
  },
})

export const getSampleDatasetPreview = getFootballDatasetPreview

export const getFixtureDatasetPreview = (datasetId: string): DatasetPreview | undefined => {
  if (datasetId === SQUIRREL_FIXTURE_ID) return getSquirrelDatasetPreview()
  if (datasetId === SAMPLE_DATASET_ID || datasetId === FOOTBALL_FIXTURE_ID) return getFootballDatasetPreview()
  return undefined
}
