import {
  CSV_MAX_BYTES,
  CSV_MAX_CELL_LENGTH,
  CSV_MAX_COLUMNS,
  CSV_MAX_HEADER_LENGTH,
  CSV_MAX_ROWS,
  DatasetError,
  type ParsedCsv,
} from './csvTypes.js'

const UTF8_BOM = '﻿'
const DELIMITERS = [',', '\t', ';', '|'] as const
const QUOTE = 34
const LF = 10
const CR = 13

const parseFailed = (): DatasetError => new DatasetError('CSV_PARSE_FAILED', 'The CSV could not be parsed')
const tooLarge = (): DatasetError => new DatasetError('CSV_TOO_LARGE', 'CSV exceeds the 4 MB size limit', 413)

const looksLikeHtml = (text: string): boolean => /^\s*<(!doctype\s+html|html|head|body|script|div)\b/i.test(text)
const looksBinary = (bytes: Uint8Array): boolean => {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512))
  if (sample.length >= 2 && sample[0] === 0x1f && sample[1] === 0x8b) return true
  if (sample.length >= 4 && sample[0] === 0x25 && sample[1] === 0x50 && sample[2] === 0x44 && sample[3] === 0x46) return true
  let nul = 0
  for (const byte of sample) if (byte === 0) nul += 1
  return nul > 2
}

export const decodeUtf8Csv = (bytes: Uint8Array): string => {
  if (bytes.byteLength > CSV_MAX_BYTES) throw tooLarge()
  if (looksBinary(bytes)) throw new DatasetError('NOT_CSV', 'Content is not a CSV')
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (text.includes('\u0000')) throw new DatasetError('NOT_CSV', 'Content is not a CSV')
    if (looksLikeHtml(text)) throw new DatasetError('NOT_CSV', 'Content is not a CSV')
    return text.startsWith(UTF8_BOM) ? text.slice(1) : text
  } catch (error) {
    if (error instanceof DatasetError) throw error
    throw new DatasetError('NOT_CSV', 'CSV must be valid UTF-8')
  }
}

const isBlankRecord = (cells: string[]): boolean => cells.length === 1 && cells[0].trim().length === 0

/**
 * Single-pass tokenizer. A quote only opens a quoted field when it is the first character of the
 * field; inside one, `""` is a literal quote and a lone `"` closes it. Anything between the closing
 * quote and the next delimiter is appended literally. Quotes anywhere else are plain characters.
 * `onRecord` may return false to stop early. Blank records are not reported.
 */
const tokenize = (text: string, delimiter: string, onRecord: (cells: string[]) => boolean | void): void => {
  const delimiterCode = delimiter.charCodeAt(0)
  const length = text.length
  let index = 0
  let cells: string[] = []
  for (;;) {
    let value: string
    if (text.charCodeAt(index) === QUOTE) {
      index += 1
      value = ''
      let segmentStart = index
      for (;;) {
        const close = text.indexOf('"', index)
        if (close === -1) throw parseFailed()
        if (text.charCodeAt(close + 1) === QUOTE) {
          value += text.slice(segmentStart, close + 1)
          index = close + 2
          segmentStart = index
          continue
        }
        value += text.slice(segmentStart, close)
        index = close + 1
        break
      }
      const tailStart = index
      while (index < length) {
        const code = text.charCodeAt(index)
        if (code === delimiterCode || code === LF || code === CR) break
        index += 1
      }
      if (index > tailStart) value += text.slice(tailStart, index)
    } else {
      const start = index
      while (index < length) {
        const code = text.charCodeAt(index)
        if (code === delimiterCode || code === LF || code === CR) break
        index += 1
      }
      value = text.slice(start, index)
    }
    if (value.length > CSV_MAX_CELL_LENGTH) throw new DatasetError('CSV_PARSE_FAILED', 'A CSV cell exceeds the length limit', 413)
    cells.push(value)
    const atEnd = index >= length
    const code = text.charCodeAt(index)
    if (!atEnd && code === delimiterCode) {
      index += 1
      continue
    }
    if (!atEnd) index += code === CR && text.charCodeAt(index + 1) === LF ? 2 : 1
    if (!isBlankRecord(cells) && onRecord(cells) === false) return
    cells = []
    if (index >= length) return
  }
}

const detectDelimiter = (text: string): string => {
  let best: { delimiter: string; count: number } | undefined
  for (const delimiter of DELIMITERS) {
    let count = 0
    try {
      tokenize(text, delimiter, (cells) => {
        count = cells.length - 1
        return false
      })
    } catch {
      count = 0
    }
    if (!best || count > best.count) best = { delimiter, count }
  }
  return best && best.count > 0 ? best.delimiter : ','
}

const invalidHeader = (): DatasetError => new DatasetError('CSV_INVALID_HEADER', 'The CSV header is missing, duplicated, or invalid')

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

export const parseCsvText = (text: string, byteSize = new TextEncoder().encode(text).byteLength): ParsedCsv => {
  if (byteSize > CSV_MAX_BYTES) throw tooLarge()
  const normalized = text.startsWith(UTF8_BOM) ? text.slice(1) : text
  if (!normalized.trim()) throw new DatasetError('CSV_EMPTY', 'The CSV has no data rows')
  if (looksLikeHtml(normalized) || normalized.includes('\u0000')) throw new DatasetError('NOT_CSV', 'Content is not a CSV')

  const delimiter = detectDelimiter(normalized)
  let header: string[] | undefined
  const rows: string[][] = []
  let padded = 0
  let truncated = 0

  tokenize(normalized, delimiter, (cells) => {
    if (!header) {
      header = cells.map((cell) => cell.trim())
      if (header.every((cell) => cell.length === 0)) throw new DatasetError('CSV_INVALID_HEADER', 'The CSV header is missing')
      if (header.length > CSV_MAX_COLUMNS) throw new DatasetError('CSV_TOO_MANY_COLUMNS', 'CSV exceeds the column limit', 413)
      if (header.some((cell) => cell.length === 0 || cell.length > CSV_MAX_HEADER_LENGTH)) throw invalidHeader()
      const seen = new Set<string>()
      for (const name of header) {
        const key = name.toLowerCase()
        if (seen.has(key)) throw invalidHeader()
        seen.add(key)
      }
      return
    }
    if (rows.length >= CSV_MAX_ROWS) throw new DatasetError('CSV_TOO_MANY_ROWS', 'CSV exceeds the 5,000 row limit', 413)
    if (cells.length > CSV_MAX_COLUMNS) throw new DatasetError('CSV_TOO_MANY_COLUMNS', 'CSV exceeds the column limit', 413)
    if (cells.length < header.length) {
      padded += 1
      while (cells.length < header.length) cells.push('')
    } else if (cells.length > header.length) {
      truncated += 1
      cells.length = header.length
    }
    rows.push(cells)
  })

  if (!header) throw new DatasetError('CSV_EMPTY', 'The CSV has no data rows')
  if (rows.length === 0) throw new DatasetError('CSV_EMPTY', 'The CSV has no data rows')
  const warnings: string[] = []
  if (padded > 0) warnings.push(`${plural(padded, 'row had', 'rows had')} fewer cells than the header and ${padded === 1 ? 'was' : 'were'} padded.`)
  if (truncated > 0) warnings.push(`${plural(truncated, 'row had', 'rows had')} extra cells that ${truncated === 1 ? 'was' : 'were'} dropped.`)
  return { delimiter, byteSize, header, rows, warnings }
}

export const parseCsvBytes = (bytes: Uint8Array): ParsedCsv => parseCsvText(decodeUtf8Csv(bytes), bytes.byteLength)
