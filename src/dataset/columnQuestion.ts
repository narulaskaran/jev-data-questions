import { humanizeName, profileTable } from '../insights/profile.js'
import type { AnalysisRowInput } from './csvTypes.js'

/**
 * A per-row model run is the wrong tool for a question the table already
 * answers. "Where are squirrels eating?" is a count of the `eating` column by
 * `location`, not a classification of each row, and drafting it as one yields
 * class lists such as Location vs Activity that name columns instead of values.
 */
export interface ColumnQuestion {
  /** Display labels of the columns that already hold the answer. */
  columns: string[]
  reason: 'classes-name-columns' | 'asks-for-existing-column'
}

const words = (text: string): string[] => (
  text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
)

/** Crude stem so "Activity" meets "Activities" and "eat" meets "eating". */
const stem = (word: string): string => {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1)
  return word
}

const stems = (text: string): string[] => words(text).map(stem)

export const columnQuestionFor = (input: {
  query: string
  questionKind?: string
  classes?: readonly string[]
  columns: readonly string[]
  rows: readonly AnalysisRowInput[]
}): ColumnQuestion | undefined => {
  const classes = input.classes ?? []
  // Classes that are column names sort rows by which column they "are", which is meaningless.
  // Score levels (Low, High) are a scale, so they are exempt even if a column shares a name.
  if (input.questionKind !== 'noul' && input.questionKind !== 'score' && classes.length >= 2) {
    const named = classes.map((name) => {
      const wanted = stems(name)
      return wanted.length === 0
        ? undefined
        : input.columns.find((column) => {
          const have = stems(column)
          return wanted.every((word) => have.includes(word))
        })
    })
    if (named.every((column): column is string => column !== undefined)) {
      return { columns: [...new Set(named)].map(humanizeName), reason: 'classes-name-columns' }
    }
  }
  // A yes/no question about something the table already records as yes/no.
  if (input.questionKind === 'noul' || classes.length < 2) {
    // Columns named after "given …" are inputs to the question, not its subject.
    const asked = stems(input.query.split(/\b(?:given|based on|using|considering)\b/i)[0] ?? '')
    const flags = profileTable(input.columns, input.rows).fields.filter((field) => field.kind === 'flag')
    const answered = flags.filter((field) => {
      const name = stems(field.name)
      return name.length > 0 && name.every((word) => asked.includes(word))
    })
    if (answered.length > 0) return { columns: answered.map((field) => field.label), reason: 'asks-for-existing-column' }
  }
  return undefined
}

export const columnQuestionCopy = (question: ColumnQuestion): string => {
  const list = question.columns.join(', ')
  return question.reason === 'classes-name-columns'
    ? `That question is about columns already in this table (${list}), so sorting each row into those labels would not answer it. The dashboard answers it from the columns directly: use its question box.`
    : `This table already records ${list} for every row, so it does not need a model run. The dashboard answers it from the column directly: use its question box.`
}
