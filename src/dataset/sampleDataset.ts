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
import { SAMPLE_WIN_LIKELIHOOD_TASK, SQUIRREL_EATING_TASK } from '../shared/questionKind'

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

export interface SampleFixtureCard {
  datasetId: string
  name: string
  eyebrow: string
  blurb: string
  task: string
}

export const SAMPLE_FIXTURE_CARDS: readonly SampleFixtureCard[] = [
  {
    datasetId: SAMPLE_DATASET_ID,
    name: SAMPLE_DATASET_NAME,
    eyebrow: 'Sample',
    blurb: 'Sequential plays. Win likelihood as a P(win) line.',
    task: SAMPLE_WIN_LIKELIHOOD_TASK,
  },
  {
    datasetId: SQUIRREL_FIXTURE_ID,
    name: SQUIRREL_DATASET_NAME,
    eyebrow: 'Sample',
    blurb: 'Places where they eat. Map, not Location vs Activity.',
    task: SQUIRREL_EATING_TASK,
  },
]
