import { describe, expect, it } from 'vitest'
import { humanizeName, profileTable } from './profile'

const kinds = (columns: string[], rows: Array<Record<string, string | number | boolean | null>>) => (
  Object.fromEntries(profileTable(columns, rows).fields.map((field) => [field.name, field.kind]))
)

const repeat = <T,>(count: number, make: (index: number) => T): T[] => Array.from({ length: count }, (_, index) => make(index))

describe('humanizeName', () => {
  it('turns column names into sentence-case labels', () => {
    expect(humanizeName('primary_fur_color')).toBe('Primary fur color')
    expect(humanizeName('yardsGained')).toBe('Yards gained')
    expect(humanizeName('order-qty')).toBe('Order quantity')
    expect(humanizeName('body_mass_g')).toBe('Body mass (g)')
    expect(humanizeName('AAPL.Open')).toBe('AAPL open')
    expect(humanizeName('gdpPercap')).toBe('GDP percap')
  })
})

describe('profileTable', () => {
  it('reads the role of each column in an orders table', () => {
    const rows = repeat(60, (index) => ({
      order_id: `A-${1000 + index}`,
      order_date: `2025-${String((index % 12) + 1).padStart(2, '0')}-15`,
      region: ['West', 'East', 'North'][index % 3]!,
      customer: `Customer ${index % 24}`,
      sales: 100 + index * 7.5,
      unit_price: 9.99 + (index % 4),
      rating: (index % 5) + 1,
      returned: index % 7 === 0,
      notes: `note about order ${index}`,
      channel: 'web',
      empty: null,
    }))
    const profile = profileTable(Object.keys(rows[0]!), rows)
    const byName = Object.fromEntries(profile.fields.map((field) => [field.name, field]))
    expect(byName.order_id!.kind).toBe('id')
    expect(byName.order_date!.kind).toBe('time')
    expect(byName.order_date!.resolution).toBe('day')
    expect(byName.region!.kind).toBe('category')
    expect(byName.customer!.kind).toBe('entity')
    expect(byName.sales).toEqual(expect.objectContaining({ kind: 'measure', additive: true }))
    expect(byName.unit_price).toEqual(expect.objectContaining({ kind: 'measure', additive: false }))
    expect(byName.rating!.kind).toBe('ordinal')
    expect(byName.returned!.kind).toBe('flag')
    expect(byName.notes!.kind).toBe('id')
    expect(byName.channel!.kind).toBe('constant')
    expect(byName.empty!.kind).toBe('empty')
    expect(profile.rowCount).toBe(60)
  })

  it('parses the date formats people actually export', () => {
    const cases: Array<[Array<string | number>, string]> = [
      [['2024-01-05', '2024-02-10', '2024-03-15'], '2024-01-05'],
      [['01/05/2024', '02/10/2024', '03/15/2024'], '2024-01-05'],
      // A day above 12 in first position means day-first.
      [['25/01/2024', '05/02/2024', '15/03/2024'], '2024-01-25'],
      [['Jan 5, 2024', 'Feb 10, 2024', 'Mar 15, 2024'], '2024-01-05'],
      [['2024-01', '2024-02', '2024-03'], '2024-01-01'],
      [['2024-01-05T08:30:00Z', '2024-01-05T09:30:00Z', '2024-01-06T10:00:00Z'], '2024-01-05'],
      // Census-style MMDDYYYY integers and compact YYYYMMDD.
      [[10142018, 10062018, 10202018], '2018-10-14'],
      [[20181014, 20181006, 20181020], '2018-10-14'],
    ]
    for (const [values, first] of cases) {
      const field = profileTable(['date'], values.map((date) => ({ date }))).fields[0]!
      expect(field.kind, String(values[0])).toBe('time')
      expect(new Date(field.times![0]!).toISOString().slice(0, 10), String(values[0])).toBe(first)
    }
    // A four-digit year reads as the date 01/02/1965, not 2019.
    const old = profileTable(['Date'], [{ Date: '01/02/1965' }, { Date: '07/19/1971' }]).fields[0]!
    expect(new Date(old.times![0]!).getUTCFullYear()).toBe(1965)
    expect(profileTable(['year'], [{ year: 1952 }, { year: 1957 }, { year: 1962 }]).fields[0]).toEqual(
      expect.objectContaining({ kind: 'time', resolution: 'year' }),
    )
  })

  it('reads numbers written with currency, commas, percents, and accounting negatives', () => {
    const profile = profileTable(['revenue', 'growth', 'loss'], [
      { revenue: '$1,200.50', growth: '12%', loss: '(300)' },
      { revenue: '$980', growth: '8.5%', loss: '(120)' },
      { revenue: '$2,400', growth: '-3%', loss: '45' },
    ])
    const [revenue, growth, loss] = profile.fields
    expect(revenue).toEqual(expect.objectContaining({ kind: 'measure', unit: '$', sum: 4580.5, additive: true }))
    expect(growth).toEqual(expect.objectContaining({ kind: 'measure', unit: '%' }))
    expect(loss!.numbers).toEqual([-300, -120, 45])
  })

  it('treats blanks and placeholder tokens as missing, not as a category', () => {
    const field = profileTable(['age'], [
      { age: 'Adult' }, { age: '?' }, { age: 'Juvenile' }, { age: 'N/A' }, { age: '' }, { age: null }, { age: 'Adult' }, { age: 'Juvenile' },
    ]).fields[0]!
    expect(field.kind).toBe('category')
    expect(field.missing).toBe(4)
    expect(field.top).toEqual([{ value: 'Adult', count: 2 }, { value: 'Juvenile', count: 2 }])
  })

  it('recognizes yes/no columns however they are spelled', () => {
    expect(kinds(['a', 'b', 'c', 'd'], repeat(12, (index) => ({
      a: index % 2 === 0,
      b: index % 3 === 0 ? 'Yes' : 'No',
      c: index % 4 === 0 ? 1 : 0,
      d: index < 5 ? 'true' : 'false',
    })))).toEqual({ a: 'flag', b: 'flag', c: 'flag', d: 'flag' })
  })

  it('needs a real coordinate pair before calling columns a map', () => {
    expect(kinds(['latitude', 'longitude'], repeat(6, (index) => ({ latitude: 40.7 + index / 100, longitude: -73.9 - index / 100 })))).toEqual({
      latitude: 'latitude', longitude: 'longitude',
    })
    // Census-style X/Y headers holding degrees.
    expect(kinds(['X', 'Y'], repeat(6, (index) => ({ X: -73.95 - index / 100, Y: 40.78 + index / 100 })))).toEqual({ X: 'longitude', Y: 'latitude' })
    // A lone latitude, or integer grid x/y, is an ordinary number.
    expect(kinds(['lat', 'value'], repeat(20, (index) => ({ lat: 10 + index * 1.5, value: index * 3.3 }))).lat).toBe('measure')
    expect(kinds(['x', 'y'], repeat(20, (index) => ({ x: index * 20, y: index * 31 })))).toEqual({ x: 'measure', y: 'measure' })
  })

  it('separates quantities from clocks, counters, and codes', () => {
    const rows = repeat(30, (index) => ({
      play_id: 100 + index * 23,
      game_seconds_remaining: 3600 - index * 100,
      countdown: 900 - index * 30,
      score_differential: [0, 0, 3, 3, 3, 10, 10, 7, 7, 14][index % 10]!,
      zip: 98100 + index,
      hectare_squirrel_number: (index % 6) + 1,
      yards_gained: [3, -2, 12, 0, 7, 25, 1, 4, 9, -5][index % 10]!,
      yards_to_go: [10, 7, 3, 10, 5, 2, 10, 8, 1, 15][index % 10]!,
    }))
    const profile = profileTable(Object.keys(rows[0]!), rows)
    const byName = Object.fromEntries(profile.fields.map((field) => [field.name, field]))
    expect(byName.play_id!.kind).toBe('sequence')
    // Named as a clock, or moving in lockstep with the row order.
    expect(byName.game_seconds_remaining!.kind).toBe('id')
    expect(byName.countdown!.kind).toBe('id')
    expect(byName.zip!.kind).toBe('text')
    expect(byName.hectare_squirrel_number!.kind).toBe('id')
    expect(byName.score_differential).toEqual(expect.objectContaining({ kind: 'measure', additive: false }))
    expect(byName.yards_gained).toEqual(expect.objectContaining({ kind: 'measure', additive: true }))
    // A situation ("to go") is a level, even though it is counted in yards.
    expect(byName.yards_to_go).toEqual(expect.objectContaining({ kind: 'measure', additive: false }))
  })

  it('keeps one of two columns that restate each other', () => {
    const rows = repeat(24, (index) => ({
      survived: index % 3 === 0 ? 1 : 0,
      alive: index % 3 === 0 ? 'yes' : 'no',
      embarked: ['S', 'C', 'Q'][index % 3]!,
      embark_town: ['Southampton', 'Cherbourg', 'Queenstown'][index % 3]!,
      player_id: ['00-1', '00-2', '00-3', '00-4'][index % 4]!,
      player_name: ['K.Walker', 'C.Kupp', 'A.Barner', 'G.Holani'][index % 4]!,
      sex: index % 2 === 0 ? 'male' : 'female',
    }))
    const result = kinds(Object.keys(rows[0]!), rows)
    expect(result.survived).toBe('flag')
    expect(result.alive).toBe('text')
    // The spelled-out label and the name win over the code and the ID.
    expect(result.embarked).toBe('text')
    expect(result.embark_town).toBe('category')
    expect(result.player_id).toBe('text')
    expect(result.player_name).toBe('category')
    expect(result.sex).toBe('category')
  })

  it('orders month and weekday labels by the calendar', () => {
    const months = profileTable(['month'], repeat(24, (index) => ({ month: ['March', 'January', 'February', 'April'][index % 4]! }))).fields[0]!
    expect(months.order).toEqual(['January', 'February', 'March', 'April'])
    const days = profileTable(['day'], repeat(20, (index) => ({ day: ['Sun', 'Thur', 'Sat', 'Fri'][index % 4]! }))).fields[0]!
    expect(days.order).toEqual(['Thur', 'Fri', 'Sat', 'Sun'])
    expect(profileTable(['team'], repeat(20, (index) => ({ team: ['Mars', 'Sun'][index % 2]! }))).fields[0]!.order).toBeUndefined()
  })

  it('handles an empty table', () => {
    expect(profileTable(['a', 'b'], [])).toEqual({
      rowCount: 0,
      fields: [
        expect.objectContaining({ name: 'a', kind: 'empty' }),
        expect.objectContaining({ name: 'b', kind: 'empty' }),
      ],
    })
  })
})
