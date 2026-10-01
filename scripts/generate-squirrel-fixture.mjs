#!/usr/bin/env node
// Builds the checked-in squirrel fixture from the public 2018 Central Park
// Squirrel Census export. Pass a local CSV path, or omit it to download.
//
//   node scripts/generate-squirrel-fixture.mjs [path/to/census.csv]
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const SOURCE_URL = 'https://data.cityofnewyork.us/api/views/vfnx-vebw/rows.csv?accessType=DOWNLOAD'
const OUT_PATH = path.join(root, 'src/fixtures/data/nyc-squirrel-census-2018.json')

// Source header -> fixture field. Order is the fixture column order.
const FIELDS = [
  ['Unique Squirrel ID', 'unique_squirrel_id', 'text'],
  ['X', 'longitude', 'coordinate'],
  ['Y', 'latitude', 'coordinate'],
  ['Hectare', 'hectare', 'text'],
  ['Shift', 'shift', 'text'],
  ['Date', 'date', 'date'],
  ['Age', 'age', 'text'],
  ['Primary Fur Color', 'primary_fur_color', 'text'],
  ['Location', 'location', 'text'],
  ['Running', 'running', 'flag'],
  ['Chasing', 'chasing', 'flag'],
  ['Climbing', 'climbing', 'flag'],
  ['Eating', 'eating', 'flag'],
  ['Foraging', 'foraging', 'flag'],
  ['Approaches', 'approaches', 'flag'],
  ['Indifferent', 'indifferent', 'flag'],
  ['Runs from', 'runs_from', 'flag'],
]

const parseCsv = (text) => {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1 }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (char !== '\r') cell += char
  }
  if (cell || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

const convert = (raw, kind) => {
  const value = raw.trim()
  if (kind === 'flag') return value.toLowerCase() === 'true' ? 1 : 0
  // The census records unknowns as blanks or "?"; both mean "not recorded".
  if (!value || value === '?') return null
  if (kind === 'coordinate') return Math.round(Number(value) * 1e6) / 1e6
  if (kind === 'date') {
    const match = value.match(/^(\d{2})(\d{2})(\d{4})$/)
    if (!match) throw new Error(`Unexpected census date: ${value}`)
    return `${match[3]}-${match[1]}-${match[2]}`
  }
  return value
}

const localPath = process.argv[2]
const csv = localPath
  ? fs.readFileSync(localPath, 'utf8')
  : await (await fetch(SOURCE_URL)).text()
const [header, ...records] = parseCsv(csv.replace(/^﻿/, ''))
const positions = FIELDS.map(([source]) => {
  const position = header.indexOf(source)
  if (position < 0) throw new Error(`Census export is missing the "${source}" column`)
  return position
})
const rows = records
  .filter((record) => record.length === header.length)
  .map((record) => FIELDS.map(([, , kind], index) => convert(record[positions[index]], kind)))
  // Stable order keeps the checked-in file diffable between regenerations.
  .sort((left, right) => String(left[5]).localeCompare(String(right[5])) || String(left[0]).localeCompare(String(right[0])))

const fixture = {
  manifest: {
    source_url: 'https://data.cityofnewyork.us/Environment/2018-Central-Park-Squirrel-Census-Squirrel-Data/vfnx-vebw',
    download_url: SOURCE_URL,
    license_url: 'https://www.nyc.gov/home/terms-of-use.page',
    attribution: 'The Squirrel Census, 2018 Central Park Squirrel Census, via NYC Open Data.',
    source_sha256: createHash('sha256').update(csv).digest('hex'),
    source_rows: records.length,
    rows: rows.length,
    note: 'Every sighting in the public export, with a subset of columns. Blank and "?" values are null; dates are ISO 8601; coordinates are rounded to six decimals.',
  },
  columns: FIELDS.map(([, name]) => name),
  flags: FIELDS.filter(([, , kind]) => kind === 'flag').map(([, name]) => name),
  rows,
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
fs.writeFileSync(OUT_PATH, `${JSON.stringify(fixture)}\n`)
console.log(`wrote ${path.relative(root, OUT_PATH)} (${rows.length} of ${records.length} rows, ${fs.statSync(OUT_PATH).size} bytes)`)
