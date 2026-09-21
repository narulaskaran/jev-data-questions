import { describe, expect, it } from 'vitest'
import {
  FOOTBALL_FIXTURE_SCHEMA,
  FOOTBALL_FIXTURE_ID,
  FOOTBALL_GAME_ID,
  footballFixture,
  getEvaluationLabel,
  getHalftimeModelInput,
  getWinLikelihoodModelInput,
  footballFixtureWinLikelihoodInputFields,
  footballPerspectiveLabel,
  validateFootballFixture,
} from './footballTimeline'

describe('pinned Seahawks Jev fixture', () => {
  it('contains the pinned identity, hashes, compact schema, and deterministic counts', () => {
    expect(footballFixture.manifest.fixture_id).toBe(FOOTBALL_FIXTURE_ID)
    expect(footballFixture.manifest.game_id).toBe(FOOTBALL_GAME_ID)
    expect(footballFixture.manifest.identity).toMatchObject({
      game_date: '2026-02-08',
      game_type: 'SB',
      away_team: 'SEA',
      away_score: 29,
      home_team: 'NE',
      home_score: 13,
    })
    expect(footballFixture.manifest.filter.posteam).toBe('SEA')
    expect(footballPerspectiveLabel).toBe(footballFixture.manifest.filter.posteam)
    expect(footballPerspectiveLabel).not.toBe(footballFixture.manifest.identity.home_team)
    expect(footballFixture.manifest.parquet_sha256).toBe('c6ecedd6d678cc37ed316b23ef84ee1ec6abb69c514bb11868a7ebd5a367df29')
    expect(footballFixture.manifest.csv_fallback_sha256).toBe('2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978')
    expect(footballFixture.manifest.identity_manifest_sha256).toBe('12a5c62f81c2cf6e50c383bbd96f0e5b80e05bfffb830151b787d32d39804564')
    expect(FOOTBALL_FIXTURE_SCHEMA).toHaveLength(31)
    expect(footballFixture.rows).toHaveLength(71)
    expect(footballFixture.evaluation).toMatchObject({ input_half: 'H1', label_half: 'H2', h1_row_count: 39, h2_row_count: 32, label_class: 'K.Walker' })
    expect(footballFixture.evaluation.leaderboard[0]).toMatchObject({ player_id: '00-0038134', player_name: 'K.Walker', scrimmage_yards: 61 })
    expect(footballFixture.manifest.license).toBe('CC BY 4.0')
    expect(footballFixture.manifest.disclosure).toMatch(/demo fixture/i)
    expect(footballFixture.manifest.disclosure).toMatch(/not evidence of model quality or generalization/i)
  })

  it('orders only Seattle core offensive plays and preserves stable player IDs', () => {
    expect(footballFixture.rows.every((row) => row.game_id === FOOTBALL_GAME_ID && row.posteam === 'SEA')).toBe(true)
    expect(footballFixture.rows.every((row) => ['run', 'pass', 'sack'].includes(String(row.play_type)))).toBe(true)
    expect(footballFixture.rows.every((row, index) => index === 0 || row.play_id > footballFixture.rows[index - 1].play_id)).toBe(true)
    expect(footballFixture.rows.some((row) => row.rusher_player_id === '00-0038134')).toBe(true)
    expect(footballFixture.rows.some((row) => row.receiver_player_id === '00-0033908')).toBe(true)
  })

  it('creates H1-only model inputs and excludes identity, final-score, and evaluation fields', () => {
    const input = getHalftimeModelInput()
    expect(input).toHaveLength(39)
    expect(input.every((row) => !('game_id' in row) && !('game_date' in row))).toBe(true)
    expect(input.every((row) => !('posteam_score' in row) && !('defteam_score' in row))).toBe(true)
    expect(input.every((row) => !('receiver_player_name' in row) && !('rusher_player_name' in row))).toBe(true)
    expect(input.every((row) => row.qtr <= 2 && row.half_seconds_remaining !== null && row.half_seconds_remaining > 0)).toBe(true)
    expect(input.every((row) => !('home_score' in row) && !('away_score' in row) && !('result' in row) && !('total' in row))).toBe(true)
    expect(getEvaluationLabel()).toBe('K.Walker')
  })

  it('creates full-game win-likelihood inputs with absolute score state, ordered by play_id', () => {
    const input = getWinLikelihoodModelInput()
    expect(input).toHaveLength(71)
    expect(input.map((row) => row.play_id)).toEqual(footballFixture.rows.map((row) => row.play_id))
    expect(input.every((row, index) => index === 0 || row.play_id > input[index - 1].play_id)).toBe(true)
    expect(input.some((row) => row.qtr >= 3)).toBe(true)
    expect(input.at(-1)?.qtr).toBe(4)
    expect(footballFixtureWinLikelihoodInputFields).toEqual(expect.arrayContaining(['posteam_score', 'defteam_score', 'score_differential', 'game_seconds_remaining']))
    expect(input.every((row) => !('game_id' in row) && !('game_date' in row))).toBe(true)
    expect(input.every((row) => !('receiver_player_name' in row) && !('rusher_player_name' in row))).toBe(true)
    expect(input.every((row) => !('home_score' in row) && !('away_score' in row) && !('result' in row) && !('final_score' in row))).toBe(true)
    expect(input.every((row) => typeof row.posteam_score === 'number' && typeof row.defteam_score === 'number')).toBe(true)
    expect(input.every((row) => 'score_differential' in row && 'qtr' in row && 'game_seconds_remaining' in row)).toBe(true)
    expect(input[0]).toMatchObject({ play_id: 57, posteam_score: 0, defteam_score: 0, score_differential: 0 })
    expect(input.at(-1)).toEqual(expect.objectContaining({
      play_id: footballFixture.rows.at(-1)?.play_id,
      posteam_score: expect.any(Number),
      defteam_score: expect.any(Number),
    }))
  })

  it('rejects a row moved across the temporal boundary or a changed identity', () => {
    const changed = structuredClone(footballFixture)
    changed.rows[0] = { ...changed.rows[0], qtr: 3 }
    expect(() => validateFootballFixture(changed)).toThrow(/39 H1 and 32 H2/i)

    const wrongGame = structuredClone(footballFixture)
    wrongGame.manifest.identity.game_id = 'wrong-game'
    expect(() => validateFootballFixture(wrongGame)).toThrow(/identity game_id/i)
  })

  it('rejects altered source provenance and model-input metadata', () => {
    const wrongSource = structuredClone(footballFixture)
    wrongSource.manifest.source_url = 'https://example.invalid/changed.parquet'
    expect(() => validateFootballFixture(wrongSource)).toThrow(/source URL/i)

    const wrongHash = structuredClone(footballFixture)
    wrongHash.manifest.source_sha256 = footballFixture.manifest.parquet_sha256 ?? ''
    expect(() => validateFootballFixture(wrongHash)).toThrow(/declared source format/i)

    const parquetFixture = structuredClone(footballFixture)
    parquetFixture.manifest.source_format = 'parquet'
    parquetFixture.manifest.source_sha256 = parquetFixture.manifest.parquet_sha256 ?? ''
    expect(() => validateFootballFixture(parquetFixture)).toThrow(/Parquet handling is explicit/i)

    const wrongIdentityHash = structuredClone(footballFixture)
    wrongIdentityHash.manifest.identity_manifest_sha256 = '0'.repeat(64)
    expect(() => validateFootballFixture(wrongIdentityHash)).toThrow(/identity manifest hash/i)

    const leakedInput = structuredClone(footballFixture)
    leakedInput.manifest.model_input_fields = [...leakedInput.manifest.model_input_fields, 'home_score']
    expect(() => validateFootballFixture(leakedInput)).toThrow(/leakage/i)

    const malformedLaterRow = structuredClone(footballFixture)
    malformedLaterRow.rows[10] = { ...malformedLaterRow.rows[10], unexpected: true } as unknown as typeof malformedLaterRow.rows[number]
    expect(() => validateFootballFixture(malformedLaterRow)).toThrow(/31-field schema/i)

    const reorderedLaterRow = structuredClone(footballFixture)
    const reorderedEntries = Object.entries(reorderedLaterRow.rows[10])
    ;[reorderedEntries[0], reorderedEntries[1]] = [reorderedEntries[1], reorderedEntries[0]]
    reorderedLaterRow.rows[10] = Object.fromEntries(reorderedEntries) as typeof reorderedLaterRow.rows[number]
    expect(() => validateFootballFixture(reorderedLaterRow)).toThrow(/31-field schema/i)

    const wrongEvaluation = structuredClone(footballFixture)
    wrongEvaluation.evaluation.leaderboard[0].scrimmage_yards += 1
    expect(() => validateFootballFixture(wrongEvaluation)).toThrow(/leaderboard/i)

    const wrongLabel = structuredClone(footballFixture)
    wrongLabel.evaluation.label_class = 'Other/Tie'
    expect(() => validateFootballFixture(wrongLabel)).toThrow(/label class does not match/i)

    const wrongTimestamp = structuredClone(footballFixture)
    wrongTimestamp.manifest.fixture_generated_utc = 'changed'
    expect(() => validateFootballFixture(wrongTimestamp)).toThrow(/timestamp/i)

    const wrongLicense = structuredClone(footballFixture)
    wrongLicense.manifest.license_url = 'https://example.invalid/LICENSE.md'
    expect(() => validateFootballFixture(wrongLicense)).toThrow(/license URL/i)

    const wrongOmittedFields = structuredClone(footballFixture)
    wrongOmittedFields.manifest.omitted_source_fields = []
    expect(() => validateFootballFixture(wrongOmittedFields)).toThrow(/omitted source fields/i)

    const wrongNumeric = structuredClone(footballFixture)
    wrongNumeric.rows[1].yards_gained = 'zero' as never
    expect(() => validateFootballFixture(wrongNumeric)).toThrow(/numeric field/i)
  })

  it('rejects H1/H2 boundary, count, and label-class mutations', () => {
    const wrongInputHalf = structuredClone(footballFixture)
    wrongInputHalf.evaluation.input_half = 'H2' as never
    expect(() => validateFootballFixture(wrongInputHalf)).toThrow(/H1\/H2/i)

    const wrongCounts = structuredClone(footballFixture)
    wrongCounts.evaluation.h2_row_count = 31
    expect(() => validateFootballFixture(wrongCounts)).toThrow(/evaluation counts/i)

    const invalidLabel = structuredClone(footballFixture)
    invalidLabel.evaluation.label_class = 'Not a class' as never
    expect(() => validateFootballFixture(invalidLabel)).toThrow(/invalid/i)
  })

  it('rejects leaderboard mutations that violate H2 credit semantics', () => {
    const wrongRunCredit = structuredClone(footballFixture)
    const run = wrongRunCredit.rows.find((row) => row.qtr >= 3 && row.play_type === 'run' && row.rusher_player_id)
    expect(run).toBeDefined()
    run!.rusher_player_id = null
    expect(() => validateFootballFixture(wrongRunCredit)).toThrow(/leaderboard/i)

    const wrongPassCredit = structuredClone(footballFixture)
    const completedPass = wrongPassCredit.rows.find((row) => row.qtr >= 3 && row.play_type === 'pass' && row.complete_pass === 1)
    expect(completedPass).toBeDefined()
    completedPass!.receiver_player_id = null
    expect(() => validateFootballFixture(wrongPassCredit)).toThrow(/leaderboard/i)

    const sackCredit = structuredClone(footballFixture)
    const sack = sackCredit.rows.find((row) => row.qtr >= 3 && row.sack === 1)
    expect(sack).toBeDefined()
    sack!.complete_pass = 1
    sack!.receiver_player_id = '00-0038134'
    expect(() => validateFootballFixture(sackCredit)).not.toThrow()

    const nonOffensiveCredit = structuredClone(footballFixture)
    const noReceiver = nonOffensiveCredit.rows.find((row) => row.qtr >= 3 && row.play_type === 'pass' && row.complete_pass === 1 && row.receiver_player_id)
    expect(noReceiver).toBeDefined()
    noReceiver!.receiver_player_id = null
    expect(() => validateFootballFixture(nonOffensiveCredit)).toThrow(/leaderboard/i)
  })
})
