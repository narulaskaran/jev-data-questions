import rawFixture from './data/seahawks-super-bowl-2026.json' with { type: 'json' }

export const FOOTBALL_FIXTURE_ID = 'seahawks-super-bowl-2026-jev-v1'
export const FOOTBALL_GAME_ID = '2025_22_SEA_NE'
export const FOOTBALL_FIXTURE_SCHEMA = [
  'game_id', 'play_id', 'game_date', 'qtr', 'game_seconds_remaining', 'half_seconds_remaining',
  'posteam', 'defteam', 'side_of_field', 'yardline_100', 'down', 'ydstogo', 'score_differential',
  'play_type', 'passer_player_id', 'passer_player_name', 'receiver_player_id', 'receiver_player_name',
  'rusher_player_id', 'rusher_player_name', 'yards_gained', 'air_yards', 'yards_after_catch', 'epa',
  'wpa', 'posteam_score', 'defteam_score', 'complete_pass', 'sack', 'penalty', 'fumble',
] as const

export type FootballFixtureField = typeof FOOTBALL_FIXTURE_SCHEMA[number]
export type FootballValue = string | number | null
export interface FootballPlay {
  game_id: string
  play_id: number
  game_date: string | null
  qtr: number
  game_seconds_remaining: number | null
  half_seconds_remaining: number | null
  posteam: string | null
  defteam: string | null
  side_of_field: string | null
  yardline_100: number | null
  down: number | null
  ydstogo: number | null
  score_differential: number | null
  play_type: string | null
  passer_player_id: string | null
  passer_player_name: string | null
  receiver_player_id: string | null
  receiver_player_name: string | null
  rusher_player_id: string | null
  rusher_player_name: string | null
  yards_gained: number | null
  air_yards: number | null
  yards_after_catch: number | null
  epa: number | null
  wpa: number | null
  posteam_score: number | null
  defteam_score: number | null
  complete_pass: number | null
  sack: number | null
  penalty: number | null
  fumble: number | null
}
export type FootballModelInput = Omit<FootballPlay, 'game_id' | 'game_date' | 'passer_player_name' | 'receiver_player_name' | 'rusher_player_name' | 'posteam_score' | 'defteam_score'>
export type FootballWinLikelihoodInput = Omit<FootballPlay, 'game_id' | 'game_date' | 'passer_player_name' | 'receiver_player_name' | 'rusher_player_name'>
export type FootballLabelClass = 'K.Walker' | 'C.Kupp' | 'J.Smith-Njigba' | 'Other/Tie'

export interface FootballFixtureManifest {
  fixture_id: string
  game_id: string
  source_format: 'csv.gz' | 'parquet'
  source_url: string
  csv_fallback_url: string
  identity_manifest_url: string
  identity_commit: string
  retrieved_utc: string
  fixture_generated_utc: string
  source_sha256: string
  csv_fallback_sha256: string
  parquet_sha256?: string
  identity_manifest_sha256: string
  license: 'CC BY 4.0'
  attribution: string
  license_url: string
  disclosure: string
  filter: { game_id: string; posteam: string; play_type: string[]; order: string }
  expected_counts: { game_pbp_rows: number; filtered_rows: number; h1_rows: number; h2_rows: number }
  identity: {
    game_id: string
    game_date: string
    game_type: string
    week: number
    away_team: string
    away_score: number
    home_team: string
    home_score: number
    location: string
    gsis: string
    old_game_id: string
    pfr: string
    espn: string
  }
  fields: Array<{ name: FootballFixtureField; role: 'feature' | 'audit' | 'label/evaluation-only' }>
  model_input_fields: string[]
  label_fields: string[]
  omitted_source_fields: string[]
}

export interface FootballEvaluation {
  input_half: 'H1'
  label_half: 'H2'
  label_definition: string
  label_class: FootballLabelClass
  leaderboard: Array<{ player_id: string; player_name: string; scrimmage_yards: number }>
  h1_row_count: number
  h2_row_count: number
}

export interface FootballFixture {
  manifest: FootballFixtureManifest
  rows: FootballPlay[]
  evaluation: FootballEvaluation
}

const EXPECTED_PBP_SHA256 = 'c6ecedd6d678cc37ed316b23ef84ee1ec6abb69c514bb11868a7ebd5a367df29'
const EXPECTED_CSV_SHA256 = '2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978'
const EXPECTED_GAMES_SHA256 = '12a5c62f81c2cf6e50c383bbd96f0e5b80e05bfffb830151b787d32d39804564'
const EXPECTED_SOURCE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.parquet'
const EXPECTED_CSV_URL = 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.csv.gz'
const EXPECTED_GAMES_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/33fe6d59c16f7119f72332e2222e43c53415acf1/data/games.csv'
const EXPECTED_IDENTITY_COMMIT = '33fe6d59c16f7119f72332e2222e43c53415acf1'
const EXPECTED_RETRIEVED_UTC = '2026-09-17 15:41:55 UTC'
const EXPECTED_FIXTURE_GENERATED_UTC = '2026-09-17 15:50:58 UTC'
const EXPECTED_LICENSE_URL = 'https://raw.githubusercontent.com/nflverse/nflverse-data/main/LICENSE.md'
const EXPECTED_ATTRIBUTION = 'nflverse/nflfastR contributors'
const EXPECTED_DISCLOSURE = 'Demo fixture, not evidence of model quality or generalization; the label is an MVP proxy, not an official award.'
const EXPECTED_IDENTITY = {
  game_id: FOOTBALL_GAME_ID,
  game_date: '2026-02-08',
  game_type: 'SB',
  week: 22,
  away_team: 'SEA',
  away_score: 29,
  home_team: 'NE',
  home_score: 13,
  location: 'Neutral',
  gsis: '60176',
  old_game_id: '2026020800',
  pfr: '202602080nwe',
  espn: '401772988',
} as const
const FORBIDDEN_INPUT_FIELDS = new Set(['game_id', 'game_date', 'posteam_score', 'defteam_score', 'away_score', 'home_score', 'result', 'total', 'postgame', 'final_score'])
const MODEL_INPUT_FIELDS = FOOTBALL_FIXTURE_SCHEMA.filter((field) => !['game_id', 'game_date', 'passer_player_name', 'receiver_player_name', 'rusher_player_name', 'posteam_score', 'defteam_score'].includes(field))
const WIN_LIKELIHOOD_OMITTED_FIELDS = new Set(['game_id', 'game_date', 'passer_player_name', 'receiver_player_name', 'rusher_player_name'])
const WIN_LIKELIHOOD_MODEL_INPUT_FIELDS: FootballFixtureField[] = [
  'play_id', 'qtr', 'game_seconds_remaining', 'posteam_score', 'defteam_score', 'score_differential',
  'half_seconds_remaining', 'posteam', 'defteam', 'side_of_field', 'yardline_100', 'down', 'ydstogo',
  'play_type', 'passer_player_id', 'receiver_player_id', 'rusher_player_id', 'yards_gained', 'air_yards',
  'yards_after_catch', 'epa', 'wpa', 'complete_pass', 'sack', 'penalty', 'fumble',
]
const LABEL_FIELDS = ['yards_gained', 'play_type', 'receiver_player_id', 'rusher_player_id', 'complete_pass', 'sack', 'penalty', 'fumble']
const AUDIT_FIELDS = new Set(['game_id', 'game_date', 'passer_player_name', 'receiver_player_name', 'rusher_player_name', 'posteam_score', 'defteam_score'])
const LABEL_DEFINITION = 'highest Seattle second-half scrimmage-yard contributor; sacks and penalties excluded'
const NAMED_CANDIDATE_LABELS = new Map<string, FootballLabelClass>([
  ['00-0038134', 'K.Walker'],
  ['00-0033908', 'C.Kupp'],
  ['00-0038543', 'J.Smith-Njigba'],
])
const NUMERIC_FIELDS: readonly FootballFixtureField[] = [
  'play_id', 'qtr', 'game_seconds_remaining', 'half_seconds_remaining', 'yardline_100', 'down',
  'ydstogo', 'score_differential', 'yards_gained', 'air_yards', 'yards_after_catch', 'epa', 'wpa',
  'posteam_score', 'defteam_score', 'complete_pass', 'sack', 'penalty', 'fumble',
]
const EXPECTED_PLAY_IDS = [57, 84, 106, 131, 161, 184, 206, 485, 515, 540, 710, 739, 761, 786, 808, 831, 992, 1015, 1042, 1065, 1092, 1114, 1137, 1303, 1340, 1362, 1385, 1410, 1440, 1462, 1484, 1744, 1776, 1798, 1827, 1852, 1874, 1906, 1948, 2219, 2246, 2271, 2296, 2318, 2340, 2370, 2397, 2427, 2587, 2619, 2644, 2806, 2835, 2858, 3051, 3096, 3118, 3141, 3166, 3344, 3374, 3396, 3422, 3645, 3672, 3694, 3716, 3738, 4280, 4302, 4376]
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[football-fixture] ${message}`)
}

function expectedSourceHash(sourceFormat: unknown): string {
  if (sourceFormat === 'csv.gz') return EXPECTED_CSV_SHA256
  if (sourceFormat === 'parquet') return EXPECTED_PBP_SHA256
  throw new Error(`[football-fixture] unsupported source format: ${String(sourceFormat)}`)
}

function validateManifest(manifest: unknown): asserts manifest is FootballFixtureManifest {
  invariant(isRecord(manifest), 'manifest is required')
  invariant(manifest.fixture_id === FOOTBALL_FIXTURE_ID, 'fixture ID is not pinned')
  invariant(manifest.game_id === FOOTBALL_GAME_ID, 'manifest game ID is not pinned')
  const expectedHash = expectedSourceHash(manifest.source_format)
  invariant(manifest.source_format === 'csv.gz', 'fixture source format is not the pinned CSV fallback; Parquet handling is explicit but not bundled')
  invariant(manifest.source_url === EXPECTED_SOURCE_URL, 'source URL is not pinned')
  invariant(manifest.csv_fallback_url === EXPECTED_CSV_URL, 'CSV fallback URL is not pinned')
  invariant(manifest.identity_manifest_url === EXPECTED_GAMES_URL, 'identity manifest URL is not pinned')
  invariant(manifest.identity_commit === EXPECTED_IDENTITY_COMMIT, 'identity manifest commit is not pinned')
  invariant(manifest.retrieved_utc === EXPECTED_RETRIEVED_UTC, 'source retrieval timestamp is not pinned')
  invariant(manifest.fixture_generated_utc === EXPECTED_FIXTURE_GENERATED_UTC, 'fixture generation timestamp is not pinned')
  invariant(manifest.source_sha256 === expectedHash, 'source hash does not match the declared source format')
  invariant(manifest.parquet_sha256 === EXPECTED_PBP_SHA256, 'Parquet source hash is not pinned')
  invariant(manifest.csv_fallback_sha256 === EXPECTED_CSV_SHA256, 'CSV fallback hash is not pinned')
  invariant(manifest.identity_manifest_sha256 === EXPECTED_GAMES_SHA256, 'identity manifest hash is not pinned')
  invariant(manifest.license === 'CC BY 4.0', 'fixture license is missing')
  invariant(manifest.license_url === EXPECTED_LICENSE_URL, 'license URL is not pinned')
  invariant(manifest.attribution === EXPECTED_ATTRIBUTION, 'attribution is not pinned')
  invariant(manifest.disclosure === EXPECTED_DISCLOSURE, 'demo disclosure is not pinned')
  invariant(isRecord(manifest.expected_counts), 'expected counts are missing')
  invariant(manifest.expected_counts.game_pbp_rows === 193 && manifest.expected_counts.filtered_rows === 71, 'source row counts are not pinned')
  invariant(manifest.expected_counts.h1_rows === 39 && manifest.expected_counts.h2_rows === 32, 'half row counts are not pinned')
  invariant(isRecord(manifest.filter), 'source filter is missing')
  invariant(manifest.filter.game_id === FOOTBALL_GAME_ID && manifest.filter.posteam === 'SEA' && JSON.stringify(manifest.filter.play_type) === JSON.stringify(['run', 'pass', 'sack']) && manifest.filter.order === 'play_id ASC', 'source filter is not pinned')
  invariant(isRecord(manifest.identity), 'identity assertions are missing')
  for (const [field, expected] of Object.entries(EXPECTED_IDENTITY)) invariant(manifest.identity[field] === expected, `identity ${field} does not match games.csv`)
  invariant(Array.isArray(manifest.fields) && manifest.fields.length === FOOTBALL_FIXTURE_SCHEMA.length, 'field metadata must cover all 31 fields')
  invariant(manifest.fields.every((field, index) => field.name === FOOTBALL_FIXTURE_SCHEMA[index]), 'field metadata order does not match the compact schema')
  invariant(manifest.fields.every((field) => field.role === (MODEL_INPUT_FIELDS.includes(field.name) ? 'feature' : AUDIT_FIELDS.has(field.name) ? 'audit' : 'label/evaluation-only')), 'field metadata roles do not match the input/evaluation contract')
  invariant(Array.isArray(manifest.omitted_source_fields) && JSON.stringify(manifest.omitted_source_fields) === JSON.stringify(['touchdown', 'incomplete_pass', 'interception', 'extra_point_result', 'field_goal_result', 'two_point_conv_result']), 'omitted source fields are not pinned')
  invariant(Array.isArray(manifest.model_input_fields), 'model input fields are missing')
  invariant(manifest.model_input_fields.every((field) => !FORBIDDEN_INPUT_FIELDS.has(field)), 'model input contains identity or result leakage')
  invariant(manifest.model_input_fields.every((field) => FOOTBALL_FIXTURE_SCHEMA.includes(field as FootballFixtureField)), 'model input fields escape the compact schema')
  invariant(JSON.stringify(manifest.model_input_fields) === JSON.stringify(MODEL_INPUT_FIELDS), 'model input fields do not match the H1 feature contract')
  invariant(Array.isArray(manifest.label_fields) && JSON.stringify(manifest.label_fields) === JSON.stringify(LABEL_FIELDS), 'label fields do not match the H2 evaluation contract')
}

function validateRow(row: unknown, index: number): asserts row is FootballPlay {
  invariant(isRecord(row), `row ${index + 1} is not an object`)
  const keys = Object.keys(row)
  invariant(keys.length === FOOTBALL_FIXTURE_SCHEMA.length && keys.every((key, keyIndex) => key === FOOTBALL_FIXTURE_SCHEMA[keyIndex]), `row ${index + 1} does not use the exact 31-field schema`)
  invariant(row.game_id === FOOTBALL_GAME_ID && row.posteam === 'SEA', `row ${index + 1} is outside the pinned Seattle game slice`)
  invariant(row.game_date === '2026-02-08', `row ${index + 1} has an unpinned game date`)
  invariant(typeof row.play_id === 'number' && Number.isInteger(row.play_id), `row ${index + 1} has an invalid play ID`)
  invariant(typeof row.qtr === 'number' && row.qtr >= 1 && row.qtr <= 4, `row ${index + 1} has an invalid quarter`)
  invariant(['run', 'pass', 'sack'].includes(String(row.play_type)), `row ${index + 1} has an unsupported play type`)
  for (const field of NUMERIC_FIELDS) {
    const value = row[field]
    invariant(value === null || (typeof value === 'number' && Number.isFinite(value)), `row ${index + 1} has an invalid numeric field: ${field}`)
  }
}

export function validateFootballFixture(input: unknown): asserts input is FootballFixture {
  invariant(isRecord(input), 'fixture is required')
  validateManifest(input.manifest)
  invariant(Array.isArray(input.rows) && input.rows.length === 71, `fixture must contain 71 rows, got ${Array.isArray(input.rows) ? input.rows.length : 'none'}`)
  input.rows.forEach(validateRow)
  for (let index = 1; index < input.rows.length; index += 1) invariant(input.rows[index].play_id > input.rows[index - 1].play_id, 'rows are not strictly ordered by play_id ASC')
  invariant(JSON.stringify(input.rows.map((row) => row.play_id)) === JSON.stringify(EXPECTED_PLAY_IDS), 'rows do not match the pinned source play membership')
  const h1 = input.rows.filter((row) => row.qtr <= 2 && row.half_seconds_remaining !== null && row.half_seconds_remaining > 0)
  const h2 = input.rows.filter((row) => row.qtr >= 3)
  invariant(h1.length === 39 && h2.length === 32, `expected 39 H1 and 32 H2 rows, got ${h1.length}/${h2.length}`)
  invariant(input.rows.every((row, index) => (row.qtr <= 2 && row.half_seconds_remaining !== null && row.half_seconds_remaining > 0) === (index < 39)), 'rows cross the pinned H1/H2 temporal boundary')
  invariant(isRecord(input.evaluation), 'evaluation metadata is missing')
  const evaluation = input.evaluation as unknown as FootballEvaluation
  invariant(evaluation.input_half === 'H1' && evaluation.label_half === 'H2', 'evaluation boundary is not H1/H2')
  invariant(evaluation.h1_row_count === h1.length && evaluation.h2_row_count === h2.length, 'evaluation counts do not match the rows')
  invariant(['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'].includes(evaluation.label_class), 'evaluation label class is invalid')
  invariant(evaluation.label_definition === LABEL_DEFINITION, 'evaluation label definition is not pinned')
  invariant(Array.isArray(evaluation.leaderboard) && evaluation.leaderboard.length > 0, 'evaluation leaderboard is missing')
  const totals = new Map<string, { player_id: string; player_name: string | null; scrimmage_yards: number }>()
  for (const row of h2) {
    if (row.penalty || row.sack || row.play_type === 'sack') continue
    const playerId = row.play_type === 'run' ? row.rusher_player_id : row.play_type === 'pass' && row.complete_pass === 1 ? row.receiver_player_id : null
    if (!playerId) continue
    const playerName = row.play_type === 'run' ? row.rusher_player_name : row.receiver_player_name
    const current = totals.get(playerId) ?? { player_id: playerId, player_name: playerName, scrimmage_yards: 0 }
    current.scrimmage_yards += row.yards_gained ?? 0
    totals.set(playerId, current)
  }
  const leaderboard = [...totals.values()].sort((left, right) => right.scrimmage_yards - left.scrimmage_yards || left.player_id.localeCompare(right.player_id))
  invariant(JSON.stringify(evaluation.leaderboard) === JSON.stringify(leaderboard), 'evaluation leaderboard does not match H2 rows')
  const top = leaderboard[0]
  const tied = top !== undefined && leaderboard.filter((entry) => entry.scrimmage_yards === top.scrimmage_yards).length > 1
  const expectedLabel = top !== undefined && !tied ? NAMED_CANDIDATE_LABELS.get(top.player_id) ?? 'Other/Tie' : 'Other/Tie'
  invariant(evaluation.label_class === expectedLabel, 'evaluation label class does not match H2 leaderboard')
}

const pickFields = <T extends FootballModelInput | FootballWinLikelihoodInput>(row: FootballPlay, fields: readonly FootballFixtureField[]): T => (
  Object.fromEntries(fields.map((field) => [field, row[field]])) as T
)

export function getHalftimeModelInput(fixture: FootballFixture = footballFixture): FootballModelInput[] {
  validateFootballFixture(fixture)
  return fixture.rows
    .filter((row) => row.qtr <= 2 && row.half_seconds_remaining !== null && row.half_seconds_remaining > 0)
    .map((row) => pickFields<FootballModelInput>(row, MODEL_INPUT_FIELDS))
}

export function getWinLikelihoodModelInput(fixture: FootballFixture = footballFixture): FootballWinLikelihoodInput[] {
  validateFootballFixture(fixture)
  invariant(WIN_LIKELIHOOD_MODEL_INPUT_FIELDS.every((field) => !WIN_LIKELIHOOD_OMITTED_FIELDS.has(field)), 'win-likelihood input includes identity leakage')
  invariant(WIN_LIKELIHOOD_MODEL_INPUT_FIELDS.includes('posteam_score') && WIN_LIKELIHOOD_MODEL_INPUT_FIELDS.includes('defteam_score') && WIN_LIKELIHOOD_MODEL_INPUT_FIELDS.includes('score_differential'), 'win-likelihood input must include absolute score state')
  return [...fixture.rows]
    .sort((left, right) => left.play_id - right.play_id)
    .map((row) => pickFields<FootballWinLikelihoodInput>(row, WIN_LIKELIHOOD_MODEL_INPUT_FIELDS))
}

export function getEvaluationLabel(fixture: FootballFixture = footballFixture): FootballLabelClass {
  validateFootballFixture(fixture)
  return fixture.evaluation.label_class
}

export const footballFixture = rawFixture as unknown as FootballFixture
validateFootballFixture(footballFixture)

/** Whose series this fixture is: posteam filter, not home/away. SEA for the sample. */
export const footballPerspectiveLabel = footballFixture.manifest.filter.posteam

export const footballFixtureDisclosure = footballFixture.manifest.disclosure
export const footballFixtureSchema = FOOTBALL_FIXTURE_SCHEMA
export const footballFixtureModelInputFields = Object.freeze([...MODEL_INPUT_FIELDS])
export const footballFixtureWinLikelihoodInputFields = Object.freeze([...WIN_LIKELIHOOD_MODEL_INPUT_FIELDS])
export const footballFixtureLabelFields = Object.freeze([...footballFixture.manifest.label_fields])
export const footballFixtureSourceLinks = Object.freeze({
  pbp: footballFixture.manifest.source_url,
  csvFallback: footballFixture.manifest.csv_fallback_url,
  identity: footballFixture.manifest.identity_manifest_url,
  license: footballFixture.manifest.license_url,
})
