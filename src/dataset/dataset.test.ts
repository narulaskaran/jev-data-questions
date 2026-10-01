import { describe, expect, it } from 'vitest'
import { CSV_MAX_BYTES, CSV_MAX_CELL_LENGTH, CSV_MAX_COLUMNS, CSV_MAX_ROWS, DatasetError } from './csvTypes'
import { decodeUtf8Csv, parseCsvBytes, parseCsvText } from './parseCsv'
import { sniffCsvContentType, validateCsvBytes, validateCsvText } from './validateDataset'

const bytes = (text: string) => new TextEncoder().encode(text)
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (error) {
    return error instanceof DatasetError ? error.code : 'OTHER'
  }
  return undefined
}

describe('CSV parser', () => {
  it('parses headers, quoted commas, and coerces types', () => {
    const csv = 'label,count,flag\n"urgent, now",2,true\nroutine,1,false\n'
    const parsed = parseCsvText(csv)
    expect(parsed.header).toEqual(['label', 'count', 'flag'])
    expect(parsed.rows[0]).toEqual(['urgent, now', '2', 'true'])
    expect(parsed.warnings).toEqual([])
    const validated = validateCsvText(csv)
    expect(validated.columns).toEqual([
      { name: 'label', inferredType: 'string' },
      { name: 'count', inferredType: 'number' },
      { name: 'flag', inferredType: 'boolean' },
    ])
    expect(validated.acceptedRowCount).toBe(2)
    expect(validated.rows[0]).toEqual(['urgent, now', 2, true])
  })

  it.each([
    [',', 'a,b,c\n1,2,3\n'],
    ['\t', 'a\tb\tc\n1\t2\t3\n'],
    [';', 'a;b;c\n1;2;3\n'],
    ['|', 'a|b|c\n1|2|3\n'],
  ])('detects the %j delimiter', (delimiter, csv) => {
    const parsed = parseCsvText(csv)
    expect(parsed.delimiter).toBe(delimiter)
    expect(parsed.header).toEqual(['a', 'b', 'c'])
    expect(parsed.rows).toEqual([['1', '2', '3']])
  })

  it('ignores delimiters inside quoted header fields when detecting', () => {
    const parsed = parseCsvText('"a,b,c";d\n1;2\n')
    expect(parsed.delimiter).toBe(';')
    expect(parsed.header).toEqual(['a,b,c', 'd'])
  })

  it('handles quoted newlines, escaped quotes, and text after a closing quote', () => {
    const parsed = parseCsvText('a,b\n"line1\nline2","say ""hi"""\n"x"y,z\n')
    expect(parsed.rows).toEqual([['line1\nline2', 'say "hi"'], ['xy', 'z']])
  })

  it('REGRESSION: a quote inside an unquoted field is literal and does not fail the file', () => {
    const parsed = parseCsvText('item,size\npipe,5" wide\nrod,2\n')
    expect(parsed.rows).toEqual([['pipe', '5" wide'], ['rod', '2']])
    expect(parseCsvText('a,b\nx"y,"z"\n').rows).toEqual([['x"y', 'z']])
  })

  it('only opens a quote at the first character of a field', () => {
    expect(parseCsvText('a,b\n "x,y",z\n').rows).toEqual([[' "x', 'y"']])
  })

  it('rejects an unclosed quoted field', () => {
    expect(codeOf(() => parseCsvText('a,b\n"unclosed,value'))).toBe('CSV_PARSE_FAILED')
  })

  it('strips a BOM and supports CRLF, CR, and LF', () => {
    const expected = [['1', '2'], ['3', '4']]
    expect(parseCsvText('﻿a,b\r\n1,2\r\n3,4\r\n').header).toEqual(['a', 'b'])
    expect(parseCsvText('a,b\r\n1,2\r\n3,4').rows).toEqual(expected)
    expect(parseCsvText('a,b\r1,2\r3,4\r').rows).toEqual(expected)
    expect(parseCsvText('a,b\n1,2\n3,4').rows).toEqual(expected)
    expect(parseCsvBytes(bytes('﻿a,b\n1,2\n')).header).toEqual(['a', 'b'])
    expect(decodeUtf8Csv(bytes('﻿a,b\n'))).toBe('a,b\n')
  })

  it('skips whitespace-only lines and keeps trailing empty cells', () => {
    const parsed = parseCsvText('a,b\n\n   \n1,\n\t\n')
    expect(parsed.rows).toEqual([['1', '']])
  })

  it('aggregates ragged-row repairs into warnings, never per row', () => {
    const parsed = parseCsvText('a,b,c\n1\n2,3\n4,5,6\n7,8,9,10\n11,12,13,14,15\n')
    expect(parsed.rows).toEqual([['1', '', ''], ['2', '3', ''], ['4', '5', '6'], ['7', '8', '9'], ['11', '12', '13']])
    expect(parsed.warnings).toEqual([
      '2 rows had fewer cells than the header and were padded.',
      '2 rows had extra cells that were dropped.',
    ])
    expect(parseCsvText('a,b\n1\n').warnings).toEqual(['1 row had fewer cells than the header and was padded.'])
  })

  it('validates headers, including case-insensitive duplicates', () => {
    expect(codeOf(() => parseCsvText('a,A\n1,2'))).toBe('CSV_INVALID_HEADER')
    expect(codeOf(() => parseCsvText('a,,c\n1,2,3'))).toBe('CSV_INVALID_HEADER')
    expect(codeOf(() => parseCsvText(',,\n1,2,3'))).toBe('CSV_INVALID_HEADER')
    expect(codeOf(() => parseCsvText(`${'x'.repeat(201)},b\n1,2`))).toBe('CSV_INVALID_HEADER')
    expect(parseCsvText(' a , b \n1,2').header).toEqual(['a', 'b'])
  })

  it('enforces size, emptiness, content, row, column, and cell limits', () => {
    const tooLarge = (fn: () => unknown) => {
      try {
        fn()
      } catch (error) {
        return error as DatasetError
      }
    }
    const large = tooLarge(() => parseCsvBytes(new Uint8Array(CSV_MAX_BYTES + 1)))
    expect(large?.code).toBe('CSV_TOO_LARGE')
    expect(large?.statusCode).toBe(413)
    expect(large?.message).toMatch(/4 MB/)
    expect(tooLarge(() => parseCsvText('a\n1', CSV_MAX_BYTES + 1))?.message).toMatch(/4 MB/)
    expect(codeOf(() => parseCsvText(''))).toBe('CSV_EMPTY')
    expect(codeOf(() => parseCsvText('  \n \n'))).toBe('CSV_EMPTY')
    expect(codeOf(() => parseCsvText('a,b\n'))).toBe('CSV_EMPTY')
    expect(codeOf(() => parseCsvText('<html><body>not csv</body></html>'))).toBe('NOT_CSV')
    expect(codeOf(() => parseCsvBytes(bytes('\u0000\u0000\u0000binary')))).toBe('NOT_CSV')
    expect(codeOf(() => parseCsvBytes(new Uint8Array([0xff, 0xfe, 0x41])))).toBe('NOT_CSV')
    const wideHeader = Array.from({ length: CSV_MAX_COLUMNS + 1 }, (_, index) => `c${index}`).join(',')
    const wide = tooLarge(() => parseCsvText(`${wideHeader}\n${wideHeader}`))
    expect(wide?.code).toBe('CSV_TOO_MANY_COLUMNS')
    expect(wide?.statusCode).toBe(413)
    const rows = Array.from({ length: CSV_MAX_ROWS + 1 }, (_, index) => `${index},n`)
    const many = tooLarge(() => parseCsvText(['id,name', ...rows].join('\n')))
    expect(many?.code).toBe('CSV_TOO_MANY_ROWS')
    expect(many?.statusCode).toBe(413)
    expect(parseCsvText(['id,name', ...rows.slice(0, CSV_MAX_ROWS)].join('\n')).rows).toHaveLength(CSV_MAX_ROWS)
    const cell = tooLarge(() => parseCsvText(`a,b\n${'x'.repeat(CSV_MAX_CELL_LENGTH + 1)},1`))
    expect(cell?.code).toBe('CSV_PARSE_FAILED')
    expect(cell?.statusCode).toBe(413)
    expect(parseCsvText(`a,b\n${'x'.repeat(CSV_MAX_CELL_LENGTH)},1`).rows).toHaveLength(1)
  })

  it('parses a ~3.5 MB, 5,000-row file in under 1.5 s', () => {
    const filler = 'lorem ipsum dolor sit amet '.repeat(25)
    const lines = ['id,text,note']
    for (let index = 0; index < CSV_MAX_ROWS; index += 1) lines.push(`${index},"${filler} ""q"", ${index}",${filler.slice(0, 100)}`)
    const data = bytes(lines.join('\n'))
    expect(data.byteLength).toBeGreaterThan(3_400_000)
    expect(data.byteLength).toBeLessThan(CSV_MAX_BYTES)
    const start = performance.now()
    const parsed = parseCsvBytes(data)
    expect(performance.now() - start).toBeLessThan(1500)
    expect(parsed.rows).toHaveLength(CSV_MAX_ROWS)
    expect(parsed.rows[4999][1]).toContain('"q", 4999')
  })
})

describe('type inference and coercion', () => {
  it('REGRESSION: keeps ZIP codes and long IDs as exact text', () => {
    const dataset = validateCsvText('zip,id,n\n02139,1234567890123456789,1\n10001,9007199254740993,2\n')
    expect(dataset.columns.map((column) => column.inferredType)).toEqual(['string', 'string', 'number'])
    expect(dataset.rows[0]).toEqual(['02139', '1234567890123456789', 1])
    expect(dataset.validationWarnings).toEqual([
      'Column “zip” kept as text to preserve leading zeros or long IDs.',
      'Column “id” kept as text to preserve leading zeros or long IDs.',
    ])
  })

  it.each([
    ['0'], ['0.5'], ['-0.5'], ['12'], ['-3'], ['1.25'], ['1e5'], ['2.5E-3'], ['9007199254740991'], ['123456789012345'],
  ])('treats %s as a number', (value) => {
    const dataset = validateCsvText(`v\n${value}\n`)
    expect(dataset.columns[0].inferredType).toBe('number')
    expect(dataset.rows[0][0]).toBe(Number(value))
    expect(dataset.validationWarnings).toEqual([])
  })

  it.each([['007'], ['02139'], ['-01'], ['+5'], ['9007199254740993'], ['0.1234567890123456'], ['1e400']])('keeps %s as text', (value) => {
    const dataset = validateCsvText(`v\n1\n${value}\n`)
    expect(dataset.columns[0].inferredType).toBe('string')
    expect(dataset.rows[1][0]).toBe(value)
  })

  it('only converts true/false to booleans', () => {
    const bools = validateCsvText('f\nTRUE\nfalse\nTrue\n')
    expect(bools.columns[0].inferredType).toBe('boolean')
    expect(bools.rows.map((row) => row[0])).toEqual([true, false, true])
    const yesNo = validateCsvText('f\nyes\nno\n')
    expect(yesNo.columns[0].inferredType).toBe('string')
    expect(yesNo.rows.map((row) => row[0])).toEqual(['yes', 'no'])
    expect(validateCsvText('f\ntrue\n1\n').columns[0].inferredType).toBe('string')
  })

  it('maps empty and whitespace-only cells to null and keeps strings verbatim', () => {
    const dataset = validateCsvText('a,b,c\n  hi  ,,1\n   ,x,\n')
    expect(dataset.rows).toEqual([['  hi  ', null, 1], [null, 'x', null]])
    const allEmpty = validateCsvText('a,b\n1,\n2,\n')
    expect(allEmpty.columns[1].inferredType).toBe('empty')
  })

  it('merges parser warnings into validation warnings and limits previews', () => {
    const lines = ['a,b', '1', ...Array.from({ length: 20 }, (_, index) => `${index},x`)]
    const dataset = validateCsvText(lines.join('\n'))
    expect(dataset.validationWarnings).toEqual(['1 row had fewer cells than the header and was padded.'])
    expect(dataset.previewRows).toHaveLength(8)
    expect(dataset.acceptedRowCount).toBe(21)
    expect(validateCsvBytes(bytes('a,b\n1,2')).rows).toEqual([[1, 2]])
  })

  it('treats client and server text validation as the same parser', () => {
    const csv = 'ticket,tier\nhello,gold\n'
    expect(validateCsvText(csv).acceptedRowCount).toBe(parseCsvText(csv).rows.length)
  })
})

describe('sniffCsvContentType', () => {
  it('allows CSV-ish and missing content types, rejects the rest', () => {
    for (const type of [undefined, '', 'text/csv; charset=utf-8', 'TEXT/PLAIN', 'text/tab-separated-values', 'text/x-csv', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream']) {
      expect(() => sniffCsvContentType(type, new Uint8Array())).not.toThrow()
    }
    for (const type of ['text/html', 'application/json', 'image/png']) {
      expect(codeOf(() => sniffCsvContentType(type, new Uint8Array()))).toBe('NOT_CSV')
    }
  })
})
