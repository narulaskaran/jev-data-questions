import {
  footballFixtureWinLikelihoodInputFields,
  getWinLikelihoodModelInput,
} from '../fixtures/footballTimeline'
import {
  getSquirrelModelInput,
  SQUIRREL_FIXTURE_SCHEMA,
} from '../fixtures/squirrelCensus'

export const SAMPLE_CSV_FILES = {
  football: {
    filename: 'seahawks-super-bowl-2026.csv',
    relPath: 'public/samples/seahawks-super-bowl-2026.csv',
    publicPath: '/samples/seahawks-super-bowl-2026.csv',
  },
  squirrel: {
    filename: 'nyc-squirrel-census.csv',
    relPath: 'public/samples/nyc-squirrel-census.csv',
    publicPath: '/samples/nyc-squirrel-census.csv',
  },
} as const

export const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export const rowsToCsv = (
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: readonly string[],
): string => {
  const lines = [columns.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(columns.map((key) => csvCell(row[key])).join(','))
  }
  return `${lines.join('\n')}\n`
}

export const footballSampleCsv = (): string => (
  rowsToCsv(
    getWinLikelihoodModelInput() as ReadonlyArray<Record<string, unknown>>,
    footballFixtureWinLikelihoodInputFields,
  )
)

export const squirrelSampleCsv = (): string => (
  rowsToCsv(
    getSquirrelModelInput() as ReadonlyArray<Record<string, unknown>>,
    SQUIRREL_FIXTURE_SCHEMA,
  )
)
