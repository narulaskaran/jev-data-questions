import { describe, expect, it } from 'vitest'
// @ts-expect-error The generator is plain ESM with no type declarations.
import { SAMPLE_COLUMNS, deriveSampleRows } from '../../scripts/generate-sample-dataset.mjs'
import fixture from '../fixtures/data/seahawks-super-bowl-2026.json'
import compact from '../fixtures/data/sample-run-pass.json'
import { SAMPLE_DATASET_ID, SAMPLE_LABEL_COLUMN, sampleRecord, sampleRows, samplePreview } from './sampleDataset'

const derive = deriveSampleRows as (input: unknown) => (string | number | null)[][]
const generatorColumns = SAMPLE_COLUMNS as string[]

const PRE_SNAP_COLUMNS = ['quarter', 'clock', 'down', 'yards_to_go', 'yards_to_end_zone', 'score_margin']

describe('compact sample dataset', () => {
  it('is exactly what the generator derives from the pinned fixture', () => {
    expect(compact.columns).toEqual(generatorColumns)
    expect(compact.rows).toEqual(derive(fixture))
  })

  it('has 71 rows and 7 columns', () => {
    expect(compact.rows).toHaveLength(71)
    expect(compact.columns).toHaveLength(7)
    for (const row of compact.rows) expect(row).toHaveLength(7)
    expect(sampleRows()).toHaveLength(71)
  })

  it('puts the label column last, and it is only ever Run or Pass (32 Run, 39 Pass)', () => {
    expect(compact.columns.at(-1)).toBe('play_call')
    expect(SAMPLE_LABEL_COLUMN).toBe('play_call')
    const labels = compact.rows.map((row) => row[6])
    expect(new Set(labels)).toEqual(new Set(['Run', 'Pass']))
    expect(labels.filter((label) => label === 'Run')).toHaveLength(32)
    expect(labels.filter((label) => label === 'Pass')).toHaveLength(39)
  })

  it('has no empty cells and numeric inputs are real numbers', () => {
    for (const row of compact.rows) {
      for (const cell of row) expect(cell).not.toBeNull()
      expect(typeof row[0]).toBe('number')
      expect(row[1]).toMatch(/^\d{1,2}:\d{2}$/)
      for (const index of [2, 3, 4, 5]) expect(typeof row[index]).toBe('number')
    }
  })

  it('is described correctly by the dataset record', () => {
    const record = sampleRecord()
    expect(record.datasetId).toBe(SAMPLE_DATASET_ID)
    expect(record.sourceType).toBe('sample')
    expect(record.acceptedRowCount).toBe(71)
    expect(record.columns.map((column) => column.name)).toEqual(generatorColumns)
    expect(record.columns.find((column) => column.name === 'clock')?.inferredType).toBe('string')
    expect(record.columns.find((column) => column.name === 'down')?.inferredType).toBe('number')
    expect(record.previewRows.length).toBeGreaterThan(0)
    expect(record.previewRows.length).toBeLessThanOrEqual(8)
  })
})

describe('samplePreview', () => {
  it('suggests a Run / Pass question scored against play_call', () => {
    const preview = samplePreview()
    expect(preview.suggestion?.classes.map((item) => item.name)).toEqual(['Run', 'Pass'])
    expect(preview.suggestion?.labelColumn).toBe('play_call')
    expect(preview.suggestion?.query.trim()).not.toBe('')
    expect(preview.suggestion?.task.trim()).not.toBe('')
    for (const item of preview.suggestion?.classes ?? []) expect(item.description.trim()).not.toBe('')
  })

  it('does not expose server-only fields and carries attribution', () => {
    const preview = samplePreview() as unknown as Record<string, unknown>
    expect(preview).not.toHaveProperty('contentHash')
    expect(preview).not.toHaveProperty('createdAt')
    expect(samplePreview().attribution?.licenseLabel).toBeTruthy()
    expect(samplePreview().validationWarnings).toEqual([])
  })

  it('returns an independent suggestion each call', () => {
    const first = samplePreview()
    first.suggestion!.classes[0].name = 'Mutated'
    expect(samplePreview().suggestion?.classes[0].name).toBe('Run')
  })
})

describe('sampleRows', () => {
  it('returns copies: mutating one result does not change later calls', () => {
    const first = sampleRows()
    const original = first[0][0]
    first[0][0] = 999
    first[1].length = 0
    first.pop()
    const second = sampleRows()
    expect(second).toHaveLength(71)
    expect(second[0][0]).toBe(original)
    expect(second[1]).toHaveLength(7)
    expect(second).toEqual(compact.rows)
  })
})

describe('no leakage of the outcome into the inputs', () => {
  it('has exactly the pre-snap input columns, then the held-out label', () => {
    expect(compact.columns.slice(0, -1)).toEqual(PRE_SNAP_COLUMNS)
  })

  it('derives every input column without reading anything that happens on the play', () => {
    const outcomeFields = ['play_type', 'passer_player_id', 'passer_player_name', 'receiver_player_id', 'receiver_player_name', 'rusher_player_id', 'rusher_player_name', 'yards_gained', 'air_yards', 'yards_after_catch', 'epa', 'wpa', 'posteam_score', 'defteam_score', 'complete_pass', 'sack', 'penalty', 'fumble']
    const scrambled = {
      ...fixture,
      rows: fixture.rows.map((row, index) => {
        const copy: Record<string, unknown> = { ...row }
        for (const field of outcomeFields) copy[field] = field === 'play_type' ? row.play_type : (index % 2 ? 99 : 'zzz')
        return copy
      }),
    }
    const original = derive(fixture)
    const changed = derive(scrambled)
    expect(changed.map((row) => row.slice(0, 6))).toEqual(original.map((row) => row.slice(0, 6)))
    // And the label really does come from the play type.
    const flipped = derive({ ...fixture, rows: fixture.rows.map((row) => ({ ...row, play_type: row.play_type === 'run' ? 'pass' : 'run' })) })
    expect(flipped.map((row) => row[6])).toEqual(original.map((row) => (row[6] === 'Run' ? 'Pass' : 'Run')))
  })

  it('has no column that names an outcome', () => {
    for (const name of PRE_SNAP_COLUMNS) expect(name).not.toMatch(/yards_gained|epa|wpa|sack|complete|penalty|fumble|rusher|passer|receiver|air_yards|result|outcome|play_type|play_call/)
  })

  it('never includes a column that equals the label in another form', () => {
    const labelIndex = compact.columns.indexOf('play_call')
    for (const row of compact.rows) {
      for (let index = 0; index < labelIndex; index += 1) expect(String(row[index]).toLowerCase()).not.toMatch(/^(run|pass|rush)$/)
    }
  })
})
