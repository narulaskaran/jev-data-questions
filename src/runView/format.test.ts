import { describe, expect, it } from 'vitest'
import { railMetaLine, runErrorCopy, runErrorHint, runProgressCount, runProgressPercent, runStallCopy, runSubsetCopy, runViewHeading, chartHeading, plainAnalysisError, savedRunCopy, resumeRunLabel, STILL_WORKING_COPY, STUCK_RUN_COPY } from './format'

describe('rail meta line', () => {
  it('keeps one compact play_id · qtr · class-or-percent line', () => {
    expect(railMetaLine({
      rowIndex: 0,
      input: { play_id: 57, qtr: 1, wpa: 0.91, message: 'hello' },
      model: 'jev',
      selectedClass: 'K.Walker',
    }, 'bars')).toBe('57 · Q1 · K.Walker')
    expect(railMetaLine({
      rowIndex: 2,
      input: { play_id: 184, qtr: 2, wpa: 0.4 },
      model: 'jev',
      questionKind: 'noul',
      value: 0.42,
    }, 'series')).toBe('184 · Q2 · 42%')
  })

  it('falls back to a short native field instead of dumping the row', () => {
    expect(railMetaLine({
      rowIndex: 0,
      input: { message: 'hello', tier: 'gold' },
      model: 'jev',
      selectedClass: 'gold',
    }, 'bars')).toBe('hello · gold')
  })
})

describe('run view copy', () => {
  it('uses Results for the panel and chart labels for the plot', () => {
    expect(runViewHeading()).toBe('Results')
    expect(chartHeading('noul')).toBe('Win probability')
    expect(chartHeading('noul', 'places')).toBe('Places')
    expect(chartHeading('score')).toBe('Score')
    expect(chartHeading('choice')).toBe('Class distribution')
  })

  it('surfaces completedRows/totalRows as a header percent without count-up', () => {
    expect(runProgressPercent(12, 39, 'running')).toBe(31)
    expect(runProgressPercent(0, 39, 'queued')).toBe(0)
    expect(runProgressPercent(38, 39, 'complete')).toBe(100)
    expect(runProgressCount(12, 39, 'running')).toBe('12 / 39')
    expect(runProgressCount(38, 39, 'complete')).toBe('39 of 39')
  })

  it('humanizes retryable vs stopped run errors', () => {
    expect(runErrorHint(true)).toBe('You can try again.')
    expect(runErrorHint(false)).toBe('This run stopped.')
    expect(plainAnalysisError('JEV_MALFORMED_RESPONSE')).toMatch(/could not use/i)
    expect(plainAnalysisError('JEV_MALFORMED_RESPONSE')).not.toMatch(/JEV_MALFORMED_RESPONSE/)
    expect(runErrorCopy({ code: 'JEV_MALFORMED_RESPONSE', retryable: false }, 31)).toEqual({
      title: "Couldn't finish this run",
      detail: 'Jev returned a response this run could not use. Saved rows are kept. You can resume from row 32.',
    })
    expect(resumeRunLabel(31)).toBe('Resume from row 32')
    expect(savedRunCopy()).toBe('')
    expect(runErrorCopy({ code: 'ANALYSIS_RUN_STALLED', retryable: true }, 728)).toEqual({
      title: STUCK_RUN_COPY,
      detail: 'Saved rows are kept. You can resume from row 729.',
    })
    expect(runStallCopy('running', new Date(1_800_000_000_000 - 59_000).toISOString(), 1_800_000_000_000)).toBeUndefined()
    expect(runStallCopy('running', new Date(1_800_000_000_000 - 60_000).toISOString(), 1_800_000_000_000)).toBe(STILL_WORKING_COPY)
    expect(runStallCopy('complete', new Date(1_800_000_000_000 - 120_000).toISOString(), 1_800_000_000_000)).toBeUndefined()
  })

  it('explains fixture H1 subset runs without changing the 39 vs 71 split', () => {
    expect(runSubsetCopy({ analyzedRows: 39, datasetRows: 71, sourceType: 'fixture', inputHalf: 'H1' })).toBe('Classifying 39 of 71 rows (H1 plays).')
    expect(runSubsetCopy({ analyzedRows: 39, sourceType: 'fixture', tense: 'analyzed' })).toBe('Classified 39 of 71 rows (H1 plays).')
    expect(runSubsetCopy({ analyzedRows: 71, datasetRows: 71, sourceType: 'fixture' })).toBeUndefined()
    expect(runSubsetCopy({ analyzedRows: 10, datasetRows: 40, sourceType: 'upload' })).toBe('Classifying 10 of 40 rows.')
  })
})
