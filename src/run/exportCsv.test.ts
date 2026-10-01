import { describe, expect, it } from 'vitest'
import { parseCsvText } from '../dataset/parseCsv'
import type { AnalysisMeta, AnalysisViewRow } from '../shared/analysis'
import { analysisToCsv, exportFilename } from './exportCsv'

const meta = (patch: Partial<AnalysisMeta> = {}): AnalysisMeta => ({
  analysisId: 'abc',
  datasetId: 'ds',
  datasetName: 'plays.csv',
  sourceType: 'upload',
  query: 'q',
  classes: [{ name: 'Run', description: '' }, { name: 'Pass', description: '' }],
  columns: ['down', 'note', 'play_call'],
  labelColumn: 'play_call',
  status: 'complete',
  mode: 'live',
  createdAt: 1,
  updatedAt: 2,
  progress: { totalRows: 2, completedRows: 2, failedRows: 0 },
  ...patch,
})

const row = (rowIndex: number, values: AnalysisViewRow['values'], patch: Partial<AnalysisViewRow> = {}): AnalysisViewRow => ({
  rowIndex,
  model: 'm',
  selectedClass: 'Run',
  probabilities: [0.8, 0.2],
  confidence: 0.8,
  values,
  ...patch,
})

const lines = (csv: string): string[] => csv.split('\r\n')

describe('analysisToCsv', () => {
  it('writes the original columns, then label, confidence, one probability per class and the error', () => {
    const csv = analysisToCsv(meta(), [row(0, [1, 'hello', 'Run'])])
    const [header, first, end] = lines(csv)
    expect(header).toBe('down,note,play_call,jev_label,jev_confidence,p(Run),p(Pass),jev_error')
    expect(first).toBe('1,hello,Run,Run,0.8,0.8,0.2,')
    expect(end).toBe('')
  })

  it('uses CRLF line endings throughout and ends with one', () => {
    const csv = analysisToCsv(meta(), [row(0, [1, 'a', 'Run']), row(1, [2, 'b', 'Pass'])])
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(lines(csv)).toHaveLength(4)
  })

  it('writes just the header when there are no rows', () => {
    expect(analysisToCsv(meta(), [])).toBe('down,note,play_call,jev_label,jev_confidence,p(Run),p(Pass),jev_error\r\n')
  })

  it('writes null and missing values as empty cells', () => {
    const csv = analysisToCsv(meta(), [row(0, [null, 'x'], { confidence: undefined, probabilities: undefined })])
    expect(lines(csv)[1]).toBe(',x,,Run,,,,')
  })

  it('quotes commas, double quotes and newlines (RFC 4180)', () => {
    const csv = analysisToCsv(meta(), [row(0, [1, 'a, b', 'Run']), row(1, [2, 'say "hi"', 'Run']), row(2, [3, 'line1\nline2', 'Run'])])
    expect(csv).toContain('1,"a, b",Run')
    expect(csv).toContain('2,"say ""hi""",Run')
    expect(csv).toContain('3,"line1\nline2",Run')
  })

  it('exports failed rows with the error code and a blank label and probabilities', () => {
    const failed = row(0, [1, 'x', 'Run'], { selectedClass: undefined, confidence: undefined, probabilities: undefined, error: { code: 'MODEL_TIMEOUT', retryable: true } })
    expect(lines(analysisToCsv(meta(), [failed]))[1]).toBe('1,x,Run,,,,,MODEL_TIMEOUT')
  })

  describe('spreadsheet formula injection', () => {
    it.each(['=1+1', '+1+1', '-1+1', '@SUM(A1)', '\tfoo', '\rfoo'])('prefixes a text cell starting with %j with an apostrophe', (text) => {
      const csv = analysisToCsv(meta(), [row(0, [1, text, 'Run'])])
      const parsed = parseCsvText(csv)
      expect(parsed.rows[0][1]).toBe(`'${text}`)
    })

    it('leaves genuine numbers, including negative ones, untouched', () => {
      const csv = analysisToCsv(meta(), [row(0, [-5, -0.25, 'Run'], { confidence: 0.5 })])
      expect(lines(csv)[1].startsWith('-5,-0.25,Run,')).toBe(true)
      expect(lines(csv)[1]).not.toContain("'")
    })

    it('does not touch text that merely contains a trigger character later on', () => {
      const csv = analysisToCsv(meta(), [row(0, [1, 'a=b+c-d@e', 'Run'])])
      expect(lines(csv)[1]).toBe('1,a=b+c-d@e,Run,Run,0.8,0.8,0.2,')
    })

    it('neutralises a class name used as the exported label', () => {
      const classes = [{ name: '=cmd|"/c calc"!A1', description: '' }, { name: 'Pass', description: '' }]
      const csv = analysisToCsv(meta({ classes }), [row(0, [1, 'x', 'Pass'], { selectedClass: classes[0].name })])
      const parsed = parseCsvText(csv)
      expect(parsed.rows[0][3]).toBe(`'${classes[0].name}`)
    })

    it('neutralises header names that start with a trigger character', () => {
      const columns = ['=HYPERLINK("http://evil","x")', '@user', 'play_call']
      const csv = analysisToCsv(meta({ columns, labelColumn: 'play_call' }), [row(0, [1, 2, 'Run'])])
      const parsed = parseCsvText(csv)
      expect(parsed.header[0]).toBe(`'${columns[0]}`)
      expect(parsed.header[1]).toBe("'@user")
    })

    it('neutralises the error code cell too', () => {
      const failed = row(0, [1, 'x', 'Run'], { selectedClass: undefined, error: { code: '=BAD', retryable: false } })
      expect(parseCsvText(analysisToCsv(meta(), [failed])).rows[0].at(-1)).toBe("'=BAD")
    })

    it('does not use a class name inside p(...) as a formula trigger', () => {
      const classes = [{ name: '=x', description: '' }, { name: '-y', description: '' }]
      const header = lines(analysisToCsv(meta({ classes }), []))[0]
      expect(header).toContain('p(=x),p(-y)')
    })
  })

  it('round-trips through parseCsvText: shape and values survive', () => {
    const rows = [
      row(0, [1, 'plain', 'Run']),
      row(1, [2, 'comma, quote " and\nnewline', 'Pass'], { selectedClass: 'Pass', probabilities: [0.1, 0.9], confidence: 0.9 }),
      row(2, [3, '', 'Run'], { selectedClass: undefined, confidence: undefined, probabilities: undefined, error: { code: 'X_FAIL', retryable: false } }),
    ]
    const parsed = parseCsvText(analysisToCsv(meta(), rows))
    expect(parsed.header).toEqual(['down', 'note', 'play_call', 'jev_label', 'jev_confidence', 'p(Run)', 'p(Pass)', 'jev_error'])
    expect(parsed.rows).toHaveLength(3)
    expect(parsed.rows[0]).toEqual(['1', 'plain', 'Run', 'Run', '0.8', '0.8', '0.2', ''])
    expect(parsed.rows[1]).toEqual(['2', 'comma, quote " and\nnewline', 'Pass', 'Pass', '0.9', '0.1', '0.9', ''])
    expect(parsed.rows[2]).toEqual(['3', '', 'Run', '', '', '', '', 'X_FAIL'])
    for (const record of parsed.rows) expect(record).toHaveLength(parsed.header.length)
  })
})

describe('exportFilename', () => {
  it('drops the .csv extension and appends -jev-results.csv', () => {
    expect(exportFilename({ datasetName: 'plays.csv' })).toBe('plays-jev-results.csv')
    expect(exportFilename({ datasetName: 'PLAYS.CSV' })).toBe('PLAYS-jev-results.csv')
  })

  it('replaces unsafe characters and collapses runs', () => {
    expect(exportFilename({ datasetName: 'Super Bowl LX — every Seattle play' })).toBe('Super-Bowl-LX-every-Seattle-play-jev-results.csv')
  })

  it('never contains path separators or control characters', () => {
    const name = exportFilename({ datasetName: '../../etc/passwd\u0000\n\\x:*?"<>|' })
    expect(name).not.toMatch(/[/\\\u0000-\u001f:*?"<>|]/)
    expect(name.endsWith('-jev-results.csv')).toBe(true)
  })

  it('falls back to "dataset" when nothing usable is left', () => {
    expect(exportFilename({ datasetName: '***' })).toBe('dataset-jev-results.csv')
    expect(exportFilename({ datasetName: '' })).toBe('dataset-jev-results.csv')
  })

  it('caps the base name at 60 characters', () => {
    const name = exportFilename({ datasetName: 'a'.repeat(200) })
    expect(name).toBe(`${'a'.repeat(60)}-jev-results.csv`)
  })
})
