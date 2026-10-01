import { describe, expect, it } from 'vitest'
import { CSV_MAX_BYTES, CSV_MAX_COLUMNS, CSV_MAX_ROWS, DatasetError } from './csvTypes'
import { parseCsvBytes, parseCsvText } from './parseCsv'
import { validateCsvText } from './validateDataset'
import { assertPublicHttpsCsvUrl, isResolvedAddressSafe } from './urlSafety'
import { classDistribution, distributionAt } from './classDistribution'
import { getSampleDatasetPreview } from './sampleDataset'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('CSV parser and validator', () => {
  it('parses headers, quoted commas, and coerces types', () => {
    const csv = 'label,count,flag\n"urgent, now",2,true\nroutine,1,false\n'
    const parsed = parseCsvText(csv)
    expect(parsed.header).toEqual(['label', 'count', 'flag'])
    expect(parsed.rows[0]).toEqual(['urgent, now', '2', 'true'])
    const validated = validateCsvText(csv)
    expect(validated.columns.map((column) => column.inferredType)).toEqual(['string', 'number', 'boolean'])
    expect(validated.acceptedRowCount).toBe(2)
    expect(validated.rows[0]).toEqual({ label: 'urgent, now', count: 2, flag: true })
  })

  it('rejects oversized, empty, non-CSV, duplicate headers, and over-wide tables', () => {
    expect(() => parseCsvBytes(new Uint8Array(CSV_MAX_BYTES + 1))).toThrow(DatasetError)
    expect(() => parseCsvText('')).toThrowError(/no data rows/i)
    expect(() => parseCsvText('<html><body>not csv</body></html>')).toThrowError(/not a CSV/i)
    expect(() => parseCsvBytes(bytes('\u0000\u0000\u0000binary'))).toThrowError(/not a CSV/i)
    expect(() => parseCsvText('a,a\n1,2')).toThrowError(/header/i)
    const wideHeader = Array.from({ length: CSV_MAX_COLUMNS + 1 }, (_, index) => `c${index}`).join(',')
    expect(() => parseCsvText(`${wideHeader}\n${wideHeader}`)).toThrow(DatasetError)
  })

  it('rejects more than the accepted row cap', () => {
    const header = 'id,name'
    const rows = Array.from({ length: CSV_MAX_ROWS + 1 }, (_, index) => `${index},n`)
    expect(() => parseCsvText([header, ...rows].join('\n'))).toThrow(DatasetError)
  })

  it('accepts real-world CSVs with stray quotes, matching Excel/pandas', () => {
    const fsu = '"Index", Height(Inches)", "Weight(Pounds)"\n1, 65.78, 112.99\n2, 71.52, 136.49\n'
    const parsed = parseCsvText(fsu)
    expect(parsed.header).toEqual(['Index', 'Height(Inches)', 'Weight(Pounds)'])
    expect(parsed.rows).toEqual([
      ['1', ' 65.78', ' 112.99'],
      ['2', ' 71.52', ' 136.49'],
    ])
    const validated = validateCsvText(fsu)
    expect(validated.acceptedRowCount).toBe(2)
    expect(validated.rows[0]).toEqual({ Index: 1, 'Height(Inches)': 65.78, 'Weight(Pounds)': 112.99 })
  })

  it('closes unclosed quotes at the end of a record instead of rejecting the file', () => {
    const parsed = parseCsvText('a,b\n"unclosed,value')
    expect(parsed.header).toEqual(['a', 'b'])
    expect(parsed.rows[0]).toEqual(['unclosed,value', ''])
  })

  it('keeps quoted commas and newlines inside a field', () => {
    const parsed = parseCsvText('label,note\n"hello, there","line 1\nline 2"\n')
    expect(parsed.rows[0]).toEqual(['hello, there', 'line 1\nline 2'])
  })

  it('treats client and server text validation as the same parser', () => {
    const csv = 'ticket,tier\nhello,gold\n'
    expect(validateCsvText(csv).acceptedRowCount).toBe(parseCsvText(csv).rows.length)
  })
})

describe('public CSV URL safety', () => {
  it('accepts public HTTPS URLs and rejects credentials, http, and local/private targets', () => {
    expect(assertPublicHttpsCsvUrl('https://example.com/data.csv').hostname).toBe('example.com')
    expect(() => assertPublicHttpsCsvUrl('http://example.com/data.csv')).toThrowError(/use an https csv url/i)
    expect(() => assertPublicHttpsCsvUrl('https://user:pass@example.com/data.csv')).toThrowError(/not a public HTTPS CSV/i)
    expect(() => assertPublicHttpsCsvUrl('https://localhost/data.csv')).toThrowError(/not a public csv link/i)
    expect(() => assertPublicHttpsCsvUrl('https://127.0.0.1/data.csv')).toThrowError(/not a public csv link/i)
    expect(() => assertPublicHttpsCsvUrl('https://10.0.0.8/data.csv')).toThrowError(/not a public csv link/i)
    expect(() => assertPublicHttpsCsvUrl('https://192.168.1.9/data.csv')).toThrowError(/not a public csv link/i)
    expect(() => assertPublicHttpsCsvUrl('https://169.254.169.254/latest/meta-data')).toThrowError(/not a public csv link/i)
    expect(() => assertPublicHttpsCsvUrl('https://[::1]/data.csv')).toThrowError(/not a public csv link/i)
    expect(() => assertPublicHttpsCsvUrl('https://[::ffff:7f00:1]/data.csv')).toThrowError(/not a public csv link/i)
    expect(() => assertPublicHttpsCsvUrl('https://[64:ff9b::7f00:1]/data.csv')).toThrowError(/not a public csv link/i)
    expect(() => assertPublicHttpsCsvUrl('https://[2002:7f00:1::]/data.csv')).toThrowError(/not a public csv link/i)
    const syntheticGlobalAddress = [0x2600, 0, 0, 0, 0, 0, 0, 1].map((word) => word.toString(16)).join(':')
    expect(isResolvedAddressSafe(syntheticGlobalAddress)).toBe(true)
    expect(isResolvedAddressSafe('not-an-ip')).toBe(false)
    expect(() => assertPublicHttpsCsvUrl('https://metadata.google.internal/computeMetadata')).toThrowError(/not a public csv link/i)
    expect(isResolvedAddressSafe('1.1.1.1')).toBe(true)
    expect(isResolvedAddressSafe('172.16.0.4')).toBe(false)
    expect(isResolvedAddressSafe('::1')).toBe(false)
  })
})

describe('running class distribution', () => {
  it('counts selected classes as rows arrive and supports replay prefixes', () => {
    const rows = [
      { selectedClass: 'urgent' },
      { selectedClass: 'routine' },
      { selectedClass: 'urgent' },
    ]
    expect(classDistribution([])).toEqual([])
    expect(classDistribution(rows.slice(0, 1), ['urgent', 'routine'])).toEqual([
      { name: 'urgent', count: 1 },
      { name: 'routine', count: 0 },
    ])
    expect(classDistribution(rows)).toEqual([
      { name: 'urgent', count: 2 },
      { name: 'routine', count: 1 },
    ])
    expect(distributionAt(rows, 2)).toEqual([
      { name: 'routine', count: 1 },
      { name: 'urgent', count: 1 },
    ])
  })
})

describe('sample dataset preview', () => {
  it('uses full-game SEA plays with absolute score state for the win-likelihood path', () => {
    const preview = getSampleDatasetPreview()
    expect(preview.acceptedRowCount).toBe(71)
    expect(preview.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'posteam_score',
      'defteam_score',
      'score_differential',
      'game_seconds_remaining',
    ]))
    expect(preview.previewRows[0]).toEqual(expect.objectContaining({
      play_id: 57,
      posteam_score: 0,
      defteam_score: 0,
      score_differential: 0,
    }))
    expect(preview.columns.slice(0, 6).map((column) => column.name)).toEqual([
      'play_id',
      'qtr',
      'game_seconds_remaining',
      'posteam_score',
      'defteam_score',
      'score_differential',
    ])
    expect(preview.columns).toHaveLength(26)
    expect(preview.previewRows).toHaveLength(71)
    expect(preview.previewRows).toHaveLength(preview.acceptedRowCount)
    expect(preview.displayName).toBe('2026 Super Bowl Demo')
  })
})
