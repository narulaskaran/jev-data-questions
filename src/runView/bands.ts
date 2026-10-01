import type { ClassCount } from '../dataset/classDistribution'
import { profileTable } from '../insights/profile'
import type { AnalysisRowInput } from '../shared/analysis'
import { seriesValueFromRow, type JevQuestionKind } from '../shared/questionKind'

/**
 * A line over row number only means something when the rows are in a real
 * order (plays in a game, days in a log). For an unordered table the same
 * values are summarized as how many rows fall in each band instead.
 */
export const hasRowOrder = (columns: readonly string[], rows: readonly AnalysisRowInput[]): boolean => (
  profileTable(columns, rows).fields.some((field) => field.kind === 'sequence' || field.kind === 'time')
)

const NOUL_BANDS = ['Likely yes', 'Unsure', 'Likely no'] as const
const SCORE_BANDS = ['High', 'Medium', 'Low'] as const

/** Counts of rows in the top, middle, and bottom third of a 0–1 value, highest band first. */
export const valueBands = (
  rows: ReadonlyArray<{ value?: number }>,
  kind: JevQuestionKind,
  classes: readonly string[] = [],
): ClassCount[] => {
  // Score levels arrive lowest first (Low, Medium, High).
  const names = kind === 'score'
    ? (classes.length === 3 ? [classes[2]!, classes[1]!, classes[0]!] : [...SCORE_BANDS])
    : [...NOUL_BANDS]
  const counts = [0, 0, 0]
  for (const row of rows) {
    const value = seriesValueFromRow(row)
    if (value === undefined) continue
    counts[value >= 2 / 3 ? 0 : value > 1 / 3 ? 1 : 2] += 1
  }
  return names.map((name, index) => ({ name, count: counts[index]! }))
}
