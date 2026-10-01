#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

const csvCell = (value) => {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

const rowsToCsv = (rows, columns) => {
  const lines = [columns.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(columns.map((key) => csvCell(row[key])).join(','))
  }
  return `${lines.join('\n')}\n`
}

const FOOTBALL_COLUMNS = [
  'play_id', 'qtr', 'game_seconds_remaining', 'posteam_score', 'defteam_score', 'score_differential',
  'half_seconds_remaining', 'posteam', 'defteam', 'side_of_field', 'yardline_100', 'down', 'ydstogo',
  'play_type', 'passer_player_id', 'receiver_player_id', 'rusher_player_id', 'yards_gained', 'air_yards',
  'yards_after_catch', 'epa', 'wpa', 'complete_pass', 'sack', 'penalty', 'fumble',
]

// Rebuild the checked-in census fixture into row objects (flags are stored as 0/1).
const squirrelPath = path.join(root, 'src/fixtures/data/nyc-squirrel-census-2018.json')
const squirrel = JSON.parse(fs.readFileSync(squirrelPath, 'utf8'))
const SQUIRREL_COLUMNS = squirrel.columns
const squirrelFlags = new Set(squirrel.flags)
const squirrelRows = squirrel.rows.map((values) => Object.fromEntries(
  SQUIRREL_COLUMNS.map((name, index) => [name, squirrelFlags.has(name) ? values[index] === 1 : values[index]]),
))

const footballPath = path.join(root, 'src/fixtures/data/seahawks-super-bowl-2026.json')
const football = JSON.parse(fs.readFileSync(footballPath, 'utf8'))
const footballRows = [...football.rows]
  .sort((left, right) => left.play_id - right.play_id)
  .map((row) => Object.fromEntries(FOOTBALL_COLUMNS.map((field) => [field, row[field]])))

const outDir = path.join(root, 'public/samples')
fs.mkdirSync(outDir, { recursive: true })
const footballCsvPath = path.join(outDir, 'seahawks-super-bowl-2026.csv')
const squirrelCsvPath = path.join(outDir, 'nyc-squirrel-census.csv')
fs.writeFileSync(footballCsvPath, rowsToCsv(footballRows, FOOTBALL_COLUMNS))
fs.writeFileSync(squirrelCsvPath, rowsToCsv(squirrelRows, SQUIRREL_COLUMNS))

console.log(`wrote ${path.relative(root, footballCsvPath)} (${footballRows.length} rows)`)
console.log(`wrote ${path.relative(root, squirrelCsvPath)} (${squirrelRows.length} rows)`)
