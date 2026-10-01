import { describe, expect, it } from 'vitest'
import { columnQuestionCopy, columnQuestionFor } from './columnQuestion'

// Headers as they appear in the public census export.
const columns = ['Location', 'Specific Location', 'Other Activities', 'Eating', 'Runs from', 'Shift']
const rows = [
  { Location: 'Ground Plane', 'Specific Location': null, 'Other Activities': 'digging', Eating: true, 'Runs from': false, Shift: 'AM' },
  { Location: 'Above Ground', 'Specific Location': 'oak', 'Other Activities': null, Eating: false, 'Runs from': true, Shift: 'PM' },
  { Location: 'Ground Plane', 'Specific Location': null, 'Other Activities': null, Eating: true, 'Runs from': false, Shift: 'PM' },
]

describe('columnQuestionFor', () => {
  it('catches Choice classes that name columns instead of values (issue #56)', () => {
    const question = columnQuestionFor({
      query: 'Identify common locations where squirrels are spotted eating.',
      questionKind: 'choice',
      classes: ['Location', 'Activity'],
      columns,
      rows,
    })
    expect(question).toEqual({ columns: ['Location', 'Other activities'], reason: 'classes-name-columns' })
    expect(columnQuestionCopy(question!)).toMatch(/columns already in this table \(Location, Other activities\)/)
  })

  it('catches a yes/no question about something the table already records', () => {
    expect(columnQuestionFor({ query: 'Is this squirrel eating given this sighting?', questionKind: 'noul', columns, rows })).toEqual({
      columns: ['Eating'],
      reason: 'asks-for-existing-column',
    })
    expect(columnQuestionFor({ query: 'Where they eat.', columns, rows })?.columns).toEqual(['Eating'])
    // Multi-word columns need every word.
    expect(columnQuestionFor({ query: 'Does it run from people?', questionKind: 'noul', columns, rows })?.columns).toEqual(['Runs from'])
    expect(columnQuestionFor({ query: 'Does it run?', questionKind: 'noul', columns, rows })).toBeUndefined()
  })

  it('lets real per-row judgments through', () => {
    // A column named after "given" is an input, not the subject.
    expect(columnQuestionFor({ query: 'Is this squirrel used to people, given eating and location?', questionKind: 'noul', columns, rows })).toBeUndefined()
    // Classes that are values or free labels.
    expect(columnQuestionFor({ query: 'Sort each sighting.', questionKind: 'choice', classes: ['Calm', 'Skittish'], columns, rows })).toBeUndefined()
    expect(columnQuestionFor({ query: 'Sort each sighting.', questionKind: 'choice', classes: ['Location', 'Skittish'], columns, rows })).toBeUndefined()
    // Score levels are a scale even when a column shares a word with them.
    expect(columnQuestionFor({
      query: 'Rate the day.',
      questionKind: 'score',
      classes: ['Low', 'High'],
      columns: ['AAPL.Low', 'AAPL.High'],
      rows: [{ 'AAPL.Low': 1, 'AAPL.High': 2 }, { 'AAPL.Low': 2, 'AAPL.High': 3 }],
    })).toBeUndefined()
  })
})
