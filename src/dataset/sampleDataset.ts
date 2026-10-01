import sample from '../fixtures/data/sample-run-pass.json' with { type: 'json' }
import { CSV_PREVIEW_ROWS, type DatasetColumn, type DatasetRowValues } from './csvTypes.js'
import type { DatasetPreview, DatasetRecord } from '../shared/dataset.js'

export const SAMPLE_DATASET_ID = 'sample-super-bowl-lx-run-pass'
export const SAMPLE_DATASET_NAME = 'Super Bowl LX — every Seattle play'
export const SAMPLE_LABEL_COLUMN = 'play_call'

const columnNames = sample.columns as string[]
const rows = sample.rows as DatasetRowValues[]

const columns: DatasetColumn[] = columnNames.map((name, index) => ({
  name,
  inferredType: typeof rows[0][index] === 'number' ? 'number' : 'string',
}))

export const sampleRows = (): DatasetRowValues[] => rows.map((row) => [...row])

export const sampleRecord = (): DatasetRecord => ({
  datasetId: SAMPLE_DATASET_ID,
  sourceType: 'sample',
  displayName: SAMPLE_DATASET_NAME,
  byteSize: 0,
  contentHash: 'sample',
  delimiter: ',',
  columns: columns.map((column) => ({ ...column })),
  acceptedRowCount: rows.length,
  previewRows: sampleRows().slice(0, CSV_PREVIEW_ROWS),
  validationWarnings: [],
  createdAt: Date.UTC(2026, 1, 8),
})

export const samplePreview = (): DatasetPreview => {
  const { contentHash: _contentHash, createdAt: _createdAt, ...record } = sampleRecord()
  return {
    ...record,
    attribution: {
      label: 'Play-by-play from nflverse',
      sourceUrl: 'https://github.com/nflverse/nflverse-data/releases/tag/pbp',
      licenseLabel: 'CC BY 4.0',
      licenseUrl: 'https://raw.githubusercontent.com/nflverse/nflverse-data/main/LICENSE.md',
    },
    suggestion: {
      task: 'Before each snap, predict whether Seattle runs or passes.',
      query: 'Given only the situation before the snap, will the offense call a run or a pass on this play?',
      classes: [
        { name: 'Run', description: 'A designed rushing play.' },
        { name: 'Pass', description: 'A called pass play, including sacks and scrambles.' },
      ],
      labelColumn: SAMPLE_LABEL_COLUMN,
    },
  }
}
