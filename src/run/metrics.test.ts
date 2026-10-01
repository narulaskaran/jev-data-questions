import { describe, expect, it } from 'vitest'
import type { AnalysisClass, AnalysisViewRow } from '../shared/analysis'
import type { AnalysisRowValue } from '../dataset/csvTypes'
import { countClasses, estimateSecondsLeft, formatBytes, formatCell, formatCount, formatDuration, formatPercent, isCorrect, labelIndexOf, scoreRows } from './metrics'

const classes: AnalysisClass[] = [{ name: 'Run', description: '' }, { name: 'Pass', description: '' }]

const row = (rowIndex: number, selectedClass: string | undefined, actual: AnalysisRowValue, extra: Partial<AnalysisViewRow> = {}): AnalysisViewRow => ({
  rowIndex,
  model: 'm',
  selectedClass,
  values: [rowIndex, actual],
  ...extra,
})
const failedRow = (rowIndex: number, actual: AnalysisRowValue = 'Run'): AnalysisViewRow => row(rowIndex, undefined, actual, { error: { code: 'MODEL_FAILED', retryable: true } })

describe('labelIndexOf', () => {
  it('finds the held-out column, or -1 when there is none or it is unknown', () => {
    expect(labelIndexOf({ columns: ['a', 'b'], labelColumn: 'b' })).toBe(1)
    expect(labelIndexOf({ columns: ['a', 'b'] })).toBe(-1)
    expect(labelIndexOf({ columns: ['a', 'b'], labelColumn: 'zzz' })).toBe(-1)
  })
})

describe('countClasses', () => {
  const rows = [row(0, 'Run', 'Run'), row(1, 'Pass', 'Run'), failedRow(2), row(3, 'Pass', 'Pass'), row(4, 'Run', 'Run')]

  it('tallies every row when upto covers the list', () => {
    expect(countClasses(rows, classes, 5)).toEqual({ counts: [2, 2], failed: 1, classified: 4 })
  })

  it('tallies only the prefix', () => {
    expect(countClasses(rows, classes, 2)).toEqual({ counts: [1, 1], failed: 0, classified: 2 })
    expect(countClasses(rows, classes, 3)).toEqual({ counts: [1, 1], failed: 1, classified: 2 })
  })

  it('treats upto beyond the length like the full list and negative or zero as empty', () => {
    expect(countClasses(rows, classes, 999)).toEqual(countClasses(rows, classes, 5))
    expect(countClasses(rows, classes, -3)).toEqual({ counts: [0, 0], failed: 0, classified: 0 })
    expect(countClasses(rows, classes, 0)).toEqual({ counts: [0, 0], failed: 0, classified: 0 })
  })

  it('counts a selectedClass that is not in the class list as failed, not as a class', () => {
    const result = countClasses([row(0, 'Kick', 'Run'), row(1, 'Run', 'Run')], classes, 2)
    expect(result).toEqual({ counts: [1, 0], failed: 1, classified: 1 })
  })

  it('handles an empty row list and an empty class list', () => {
    expect(countClasses([], classes, 10)).toEqual({ counts: [0, 0], failed: 0, classified: 0 })
    expect(countClasses(rows, [], 5)).toEqual({ counts: [], failed: 5, classified: 0 })
  })
})

describe('scoreRows', () => {
  it('returns undefined without a label column', () => {
    expect(scoreRows([row(0, 'Run', 'Run')], classes, -1, 1)).toBeUndefined()
  })

  it('computes accuracy and a confusion matrix indexed matrix[actual][predicted]', () => {
    const rows = [
      row(0, 'Run', 'Run'),
      row(1, 'Run', 'Run'),
      row(2, 'Pass', 'Run'), // actual Run, predicted Pass
      row(3, 'Pass', 'Pass'),
      row(4, 'Run', 'Pass'), // actual Pass, predicted Run
      row(5, 'Run', 'Pass'), // actual Pass, predicted Run
    ]
    const score = scoreRows(rows, classes, 1, rows.length)
    expect(score?.scored).toBe(6)
    expect(score?.correct).toBe(3)
    expect(score?.accuracy).toBeCloseTo(0.5)
    expect(score?.matrix).toEqual([
      [2, 1],
      [2, 1],
    ])
    expect(score?.matrix[0][1]).toBe(1) // actual Run, predicted Pass
    expect(score?.matrix[1][0]).toBe(2) // actual Pass, predicted Run
  })

  it('matches case- and whitespace-insensitively', () => {
    const rows = [row(0, ' run ', 'RUN'), row(1, 'PASS', ' pass')]
    const score = scoreRows(rows, classes, 1, 2)
    expect(score).toMatchObject({ scored: 2, correct: 2, unmatched: 0 })
  })

  it('compares numeric and boolean answers as strings', () => {
    const numeric: AnalysisClass[] = [{ name: '1', description: '' }, { name: '2', description: '' }]
    const score = scoreRows([row(0, '1', 1), row(1, '2', 1)], numeric, 1, 2)
    expect(score).toMatchObject({ scored: 2, correct: 1 })

    const bool: AnalysisClass[] = [{ name: 'true', description: '' }, { name: 'false', description: '' }]
    const boolScore = scoreRows([row(0, 'true', true), row(1, 'true', false), row(2, 'false', false)], bool, 1, 3)
    expect(boolScore).toMatchObject({ scored: 3, correct: 2 })
    expect(boolScore?.matrix).toEqual([[1, 0], [1, 1]])
  })

  it('skips failed rows entirely', () => {
    const score = scoreRows([row(0, 'Run', 'Run'), failedRow(1), failedRow(2, 'Pass')], classes, 1, 3)
    expect(score).toMatchObject({ scored: 1, correct: 1, unmatched: 0 })
  })

  it('counts unmatched when the actual value is not one of the labels', () => {
    const score = scoreRows([row(0, 'Run', 'Run'), row(1, 'Run', 'Kick'), row(2, 'Pass', null)], classes, 1, 3)
    expect(score).toMatchObject({ scored: 1, correct: 1, unmatched: 2 })
  })

  it('does not count a prediction outside the labels as unmatched or scored', () => {
    const score = scoreRows([row(0, 'Kick', 'Run'), row(1, 'Run', 'Run')], classes, 1, 2)
    expect(score).toMatchObject({ scored: 1, unmatched: 0 })
  })

  it('reports the majority-class baseline of the actual answers', () => {
    const rows = [row(0, 'Pass', 'Run'), row(1, 'Pass', 'Run'), row(2, 'Pass', 'Run'), row(3, 'Pass', 'Pass')]
    const score = scoreRows(rows, classes, 1, 4)
    expect(score?.baseline).toEqual({ label: 'Run', accuracy: 0.75 })
  })

  it('breaks baseline ties in favour of the earlier label, deterministically', () => {
    const rows = [row(0, 'Run', 'Pass'), row(1, 'Run', 'Run')]
    expect(scoreRows(rows, classes, 1, 2)?.baseline).toEqual({ label: 'Run', accuracy: 0.5 })
    const reversed = [row(0, 'Run', 'Run'), row(1, 'Run', 'Pass')]
    expect(scoreRows(reversed, classes, 1, 2)?.baseline).toEqual({ label: 'Run', accuracy: 0.5 })
  })

  it('has undefined accuracy and baseline for an empty prefix', () => {
    const score = scoreRows([row(0, 'Run', 'Run')], classes, 1, 0)
    expect(score?.accuracy).toBeUndefined()
    expect(score?.baseline).toBeUndefined()
    expect(score).toMatchObject({ scored: 0, correct: 0, unmatched: 0, matrix: [[0, 0], [0, 0]] })
  })

  it('only scores the requested prefix', () => {
    const rows = [row(0, 'Run', 'Run'), row(1, 'Pass', 'Run'), row(2, 'Run', 'Run')]
    expect(scoreRows(rows, classes, 1, 2)).toMatchObject({ scored: 2, correct: 1 })
    expect(scoreRows(rows, classes, 1, 100)).toMatchObject({ scored: 3, correct: 2 })
    expect(scoreRows(rows, classes, 1, -1)).toMatchObject({ scored: 0 })
  })
})

describe('isCorrect', () => {
  it('compares the answer with the held-out value, ignoring case and whitespace', () => {
    expect(isCorrect(row(0, 'Run', ' run'), 1)).toBe(true)
    expect(isCorrect(row(0, 'Run', 'Pass'), 1)).toBe(false)
  })

  it('is undefined with no label column, no answer, or an empty held-out value', () => {
    expect(isCorrect(row(0, 'Run', 'Run'), -1)).toBeUndefined()
    expect(isCorrect(failedRow(0), 1)).toBeUndefined()
    expect(isCorrect(row(0, 'Run', null), 1)).toBeUndefined()
    expect(isCorrect(row(0, 'Run', '  '), 1)).toBeUndefined()
  })

  it('treats 0 and false as real answers rather than empty', () => {
    expect(isCorrect(row(0, '0', 0), 1)).toBe(true)
    expect(isCorrect(row(0, 'false', false), 1)).toBe(true)
  })

  // The table's "Misses" filter and the scoreboard should agree on which rows are wrong:
  // an actual value outside the labels is "unmatched" (unscored) in scoreRows but a miss here.
  it.fails('does not call a row a miss when scoreRows leaves it unscored (actual value is not a label)', () => {
    const odd = row(0, 'Run', 'Kick')
    expect(scoreRows([odd], classes, 1, 1)?.unmatched).toBe(1)
    expect(isCorrect(odd, 1)).toBeUndefined()
  })
})

describe('estimateSecondsLeft', () => {
  const base = { status: 'running' as const, startedAt: 1_000, updatedAt: 11_000, progress: { totalRows: 100, completedRows: 10, failedRows: 0 } }

  it('extrapolates the observed pace', () => {
    // 10 rows in 10 s => 90 more rows take 90 s
    expect(estimateSecondsLeft(base)).toBe(90)
  })

  it('scales with rows remaining', () => {
    expect(estimateSecondsLeft({ ...base, progress: { totalRows: 50, completedRows: 10, failedRows: 0 } })).toBe(40)
  })

  it('is undefined unless running', () => {
    for (const status of ['queued', 'complete', 'error', 'cancelled'] as const) expect(estimateSecondsLeft({ ...base, status })).toBeUndefined()
  })

  it('is undefined with too few rows, no start time, zero elapsed time or nothing left', () => {
    expect(estimateSecondsLeft({ ...base, progress: { totalRows: 100, completedRows: 3, failedRows: 0 } })).toBeUndefined()
    expect(estimateSecondsLeft({ ...base, startedAt: undefined })).toBeUndefined()
    expect(estimateSecondsLeft({ ...base, updatedAt: 1_000 })).toBeUndefined()
    expect(estimateSecondsLeft({ ...base, updatedAt: 500 })).toBeUndefined()
    expect(estimateSecondsLeft({ ...base, progress: { totalRows: 10, completedRows: 10, failedRows: 0 } })).toBeUndefined()
  })
})

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('1s')
    expect(formatDuration(-5)).toBe('1s')
    expect(formatDuration(0.2)).toBe('1s')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(60)).toBe('1m')
    expect(formatDuration(90)).toBe('1m 30s')
    expect(formatDuration(3_600)).toBe('1h 0m')
    expect(formatDuration(3_660)).toBe('1h 1m')
  })

  // Rounding the remainder after the minute split produces "60s" / "1m 60s".
  it.fails('never prints 60 seconds (59.6 s should read 1m)', () => {
    expect(formatDuration(59.6)).toBe('1m')
  })

  it.fails('never prints 60 seconds after a minute (119.6 s should read 2m)', () => {
    expect(formatDuration(119.6)).toBe('2m')
  })
})

describe('formatPercent / formatCount', () => {
  it('formats fractions, digits and the empty case', () => {
    expect(formatPercent(undefined)).toBe('—')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(0.4567)).toBe('46%')
    expect(formatPercent(0.4567, 1)).toBe('45.7%')
  })

  it('groups thousands', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(5000)).toBe('5,000')
    expect(formatCount(1234567)).toBe('1,234,567')
  })
})

describe('formatBytes', () => {
  it('uses B, KB and MB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(50 * 1024)).toBe('50 KB')
    expect(formatBytes(4 * 1024 * 1024)).toBe('4.0 MB')
  })

  it.fails('does not print 1024 KB just under a megabyte', () => {
    expect(formatBytes(1024 * 1024 - 1)).not.toBe('1024 KB')
  })
})

describe('formatCell', () => {
  it('shows a dash for null, undefined and the empty string', () => {
    expect(formatCell(null)).toBe('—')
    expect(formatCell(undefined)).toBe('—')
    expect(formatCell('')).toBe('—')
  })

  it('keeps falsy-but-real values', () => {
    expect(formatCell(0)).toBe('0')
    expect(formatCell(false)).toBe('false')
    expect(formatCell(true)).toBe('true')
    expect(formatCell('Run')).toBe('Run')
    expect(formatCell(-1.5)).toBe('-1.5')
  })
})
