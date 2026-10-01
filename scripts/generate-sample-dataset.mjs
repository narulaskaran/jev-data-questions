#!/usr/bin/env node
// Derives the compact "Run or pass?" sample from the pinned Seahawks fixture.
// Only pre-snap fields are kept as model input; `play_call` is the held-out answer.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(here, '../src/fixtures/data/seahawks-super-bowl-2026.json')
const target = path.join(here, '../src/fixtures/data/sample-run-pass.json')

export const SAMPLE_COLUMNS = ['quarter', 'clock', 'down', 'yards_to_go', 'yards_to_end_zone', 'score_margin', 'play_call']

export const clockOf = (row) => {
  const secondsLeftInQuarter = row.game_seconds_remaining - (4 - row.qtr) * 900
  const minutes = Math.floor(secondsLeftInQuarter / 60)
  const seconds = secondsLeftInQuarter % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export const deriveSampleRows = (fixture) => fixture.rows.map((row) => [
  row.qtr,
  clockOf(row),
  row.down,
  row.ydstogo,
  row.yardline_100,
  row.score_differential,
  row.play_type === 'run' ? 'Run' : 'Pass',
])

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const fixture = JSON.parse(fs.readFileSync(source, 'utf8'))
  const rows = deriveSampleRows(fixture)
  const body = `{\n  "columns": ${JSON.stringify(SAMPLE_COLUMNS)},\n  "rows": [\n${rows.map((row) => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]\n}\n`
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8') !== body) { console.error('sample-run-pass.json is stale; run npm run sample:generate'); process.exit(1) }
    console.log(`sample-run-pass.json is current (${rows.length} rows)`)
  } else {
    fs.writeFileSync(target, body)
    console.log(`wrote ${rows.length} rows to ${path.relative(process.cwd(), target)}`)
  }
}
