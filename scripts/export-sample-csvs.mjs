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

const SQUIRREL_COLUMNS = [
  'unique_squirrel_id', 'x', 'y', 'hectare', 'shift', 'date', 'age', 'primary_fur_color',
  'location', 'specific_location', 'eating', 'foraging', 'running', 'climbing',
]

const mulberry32 = (seed) => {
  let t = seed >>> 0
  return () => {
    t += 0x6D2B79F5
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (rand, values) => values[Math.floor(rand() * values.length)]

const buildSquirrelRows = (count = 96) => {
  const rand = mulberry32(2018_10_13)
  const hectares = ['07F', '11B', '13A', '14D', '16C', '22A', '32E', '33B']
  const colors = ['Gray', 'Cinnamon', 'Black']
  const ages = ['Adult', 'Juvenile']
  const groundSpots = ['lawn', 'near bench', 'by path', 'under tree']
  const aboveSpots = ['tree limb', 'trunk', 'branch']
  const lngMin = -73.9814
  const lngMax = -73.9494
  const latMin = 40.7648
  const latMax = 40.8003
  const rows = []
  for (let index = 0; index < count; index += 1) {
    const hectare = hectares[index % hectares.length]
    const shift = index % 3 === 0 ? 'PM' : 'AM'
    const above = rand() < 0.32
    const location = above ? 'Above Ground' : 'Ground Plane'
    const eating = above ? rand() < 0.22 : rand() < 0.48
    const foraging = eating ? rand() < 0.55 : rand() < 0.28
    const climbing = above && rand() < 0.6
    const running = !climbing && rand() < 0.2
    const day = 6 + (index % 20)
    rows.push({
      unique_squirrel_id: `${hectare}-${shift}-${String(1000 + index).slice(1)}-${String((index % 9) + 1).padStart(2, '0')}`,
      x: lngMin + (index % 12) * ((lngMax - lngMin) / 11) + (rand() - 0.5) * 0.0012,
      y: latMin + Math.floor(index / 12) * ((latMax - latMin) / 7) + (rand() - 0.5) * 0.001,
      hectare,
      shift,
      date: `101${String(day).padStart(2, '0')}2018`,
      age: pick(rand, ages),
      primary_fur_color: pick(rand, colors),
      location,
      specific_location: location === 'Above Ground' ? pick(rand, aboveSpots) : pick(rand, groundSpots),
      eating,
      foraging,
      running,
      climbing,
    })
  }
  return rows
}

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
fs.writeFileSync(squirrelCsvPath, rowsToCsv(buildSquirrelRows(), SQUIRREL_COLUMNS))

console.log(`wrote ${path.relative(root, footballCsvPath)} (${footballRows.length} rows)`)
console.log(`wrote ${path.relative(root, squirrelCsvPath)} (${buildSquirrelRows().length} rows)`)
