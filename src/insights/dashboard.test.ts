import { describe, expect, it } from 'vitest'
import { MAX_STORY_VIEWS, buildStoryDashboard, isWideView, matchQuestionFields, selectViews } from './dashboard'
import { formatNumber, formatRatio, formatShare, formatTimeBucket, niceTicks } from './format'
import { profileTable } from './profile'
import { chiSquareSignificant, meanDifference, pearson, quantile, rateDifference } from './stats'
import { candidateViews, type BarsChart, type LineChart, type MapChart, type StoryView } from './views'

type Row = Record<string, string | number | boolean | null>

/** Deterministic pseudo-random numbers so planted patterns are stable. */
const seeded = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let x = Math.imul(state ^ (state >>> 15), 1 | state)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A shop's orders with known structure: sales grow through the year, West
 * outsells the other regions, Furniture is returned far more often, and
 * `coin` is pure noise.
 */
const orders = (): Row[] => {
  const random = seeded(7)
  const regions = ['West', 'East', 'South', 'North']
  const categories = ['Furniture', 'Office', 'Technology']
  return Array.from({ length: 480 }, (_, index) => {
    const month = Math.floor(index / 40)
    const region = regions[index % 4]!
    const category = categories[index % 3]!
    const base = 80 + month * 14 + (region === 'West' ? 90 : 0)
    return {
      order_id: `ORD-${10000 + index}`,
      order_date: `2025-${String(month + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
      region,
      category,
      sales: Math.round((base + random() * 60) * 100) / 100,
      discount_pct: Math.round(random() * 30),
      returned: random() < (category === 'Furniture' ? 0.4 : 0.08),
      coin: random() < 0.5,
    }
  })
}

const build = (rows: Row[], options: Parameters<typeof buildStoryDashboard>[2] = {}) => (
  buildStoryDashboard(Object.keys(rows[0] ?? {}), rows, options)
)

const view = (views: readonly StoryView[], id: string): StoryView => {
  const found = views.find((item) => item.id === id)
  if (!found) throw new Error(`Missing view ${id}; have ${views.map((item) => item.id).join(', ')}`)
  return found
}

describe('story dashboard for a business table', () => {
  const rows = orders()
  const dashboard = build(rows, { noun: { singular: 'order', plural: 'orders' } })

  it('leads with the trend and states it as a finding', () => {
    const lead = dashboard.views[0]!
    expect(lead.kind).toBe('trend')
    expect(lead.id).toBe('trend:order_date+sales')
    expect(lead.title).toMatch(/^Total sales rose \d+% from the start of the period to the end$/)
    // 40 orders a month is enough for a steady figure; 9 a week is not.
    expect(lead.subtitle).toBe('Total sales per month, by order date')
    const chart = lead.chart as LineChart
    expect(chart.zeroBased).toBe(true)
    expect(chart.points.map((point) => point.label)).toEqual([
      'Jan 2025', 'Feb 2025', 'Mar 2025', 'Apr 2025', 'May 2025', 'Jun 2025',
      'Jul 2025', 'Aug 2025', 'Sep 2025', 'Oct 2025', 'Nov 2025', 'Dec 2025',
    ])
    expect(chart.points[0]!.x).toBe(0)
    expect(chart.points[chart.points.length - 1]!.x).toBe(1)
  })

  it('ranks the planted leader and reports its share of the total', () => {
    const ranking = view(dashboard.views, 'ranking:region+sales')
    expect(ranking.title).toMatch(/^West leads sales with [\d.]+K, \d+% of the total$/)
    const chart = ranking.chart as BarsChart
    expect(chart.items.map((item) => item.label)[0]).toBe('West')
    expect(chart.items.every((item, index, list) => index === 0 || item.value <= list[index - 1]!.value)).toBe(true)
    expect(ranking.table.columns).toEqual(['Region', 'Total sales', 'Orders'])
  })

  it('finds the real rate difference and ignores the noise column', () => {
    const rate = view(dashboard.views, 'rate:category+returned')
    expect(rate.title).toMatch(/^Returned is most common for Furniture \(\d+%\) and least for (Office|Technology) \([\d.]+%\)$/)
    expect((rate.chart as BarsChart).reference?.label).toMatch(/^Overall \d+%$/)
    // A coin flip differs between groups only by chance; it must not be reported as a finding.
    const all = candidateViews(profileTable(Object.keys(rows[0]!), rows), dashboard.noun)
    for (const coin of all.filter((item) => item.kind === 'rate' && item.fields.includes('coin'))) {
      expect(coin.title).toMatch(/about as common/)
      expect(coin.score).toBeLessThan(0.3)
    }
    expect(dashboard.views.some((item) => item.kind === 'rate' && item.fields.includes('coin'))).toBe(false)
  })

  it('summarizes the table in headline figures', () => {
    expect(dashboard.kpis.map((kpi) => kpi.label)).toEqual(['Orders', 'Total sales', 'Time span', 'Coin'])
    expect(dashboard.kpis[0]).toEqual({ label: 'Orders', value: '480' })
    expect(dashboard.kpis[1]).toEqual(expect.objectContaining({ value: '99.9K', detail: '208 per order' }))
    expect(dashboard.kpis[2]).toEqual({ label: 'Time span', value: '12 months', detail: 'Jan 1, 2025 to Dec 27, 2025' })
    // Forty orders every month is how the table was built, so it is not charted as a trend.
    expect(dashboard.views.some((item) => item.id === 'trend:order_date')).toBe(false)
  })

  it('covers the table instead of repeating one cut', () => {
    expect(dashboard.views.length).toBeGreaterThanOrEqual(4)
    expect(dashboard.views.length).toBeLessThanOrEqual(MAX_STORY_VIEWS)
    expect(new Set(dashboard.views.map((item) => item.id)).size).toBe(dashboard.views.length)
    expect(new Set(dashboard.views.map((item) => item.kind)).size).toBeGreaterThanOrEqual(3)
    // Full-width forms lead; the rest come in pairs so no card is left alone.
    const widths = dashboard.views.map(isWideView)
    expect(widths.lastIndexOf(true)).toBeLessThan(widths.indexOf(false) === -1 ? Infinity : widths.indexOf(false))
    expect(widths.filter((wide) => !wide).length % 2).toBe(0)
  })

  it('gives every view a data table that matches its chart', () => {
    for (const item of dashboard.views) {
      expect(item.table.columns.length).toBeGreaterThanOrEqual(2)
      expect(item.table.rows.length).toBeGreaterThan(0)
      expect(item.table.rows.every((row) => row.length === item.table.columns.length)).toBe(true)
    }
  })
})

describe('questions about columns', () => {
  const rows = orders()

  it('leads with the views about the columns a question names', () => {
    const asked = build(rows, { question: 'Which category gets returned the most?' })
    expect(asked.focus).toEqual(['Category', 'Returned'])
    expect(asked.views[0]!.id).toBe('rate:category+returned')
    // The rest of the dashboard still follows.
    expect(asked.views.length).toBeGreaterThan(2)
  })

  it('answers honestly when the named columns show no difference', () => {
    const asked = build(rows, { question: 'does coin vary by region' })
    expect(asked.focus).toEqual(['Region', 'Coin'])
    expect(asked.views[0]).toEqual(expect.objectContaining({ id: 'rate:region+coin', title: 'Coin is about as common across region' }))
  })

  it('matches a column by one of its values and reports when nothing matches', () => {
    const profile = profileTable(Object.keys(rows[0]!), rows)
    expect(matchQuestionFields('how is furniture doing', profile).map((field) => field.name)).toEqual(['category'])
    expect(matchQuestionFields('the and for with', profile)).toEqual([])
    const unmatched = build(rows, { question: 'weather on mars' })
    expect(unmatched.focus).toEqual([])
    expect(unmatched.views.map((item) => item.id)).toEqual(build(rows).views.map((item) => item.id))
    expect(build(rows).focus).toBeUndefined()
  })
})

describe('other table shapes', () => {
  it('maps coordinates and names the busiest place', () => {
    const random = seeded(11)
    const rows: Row[] = Array.from({ length: 200 }, (_, index) => ({
      latitude: 40.7 + random() * 0.05,
      longitude: -74 + random() * 0.04,
      district: index < 90 ? 'Harbor' : ['Hill', 'Market', 'Old Town'][index % 3]!,
    }))
    const dashboard = build(rows, { noun: { singular: 'stop', plural: 'stops' } })
    const map = dashboard.views[0]!
    expect(map.kind).toBe('map')
    expect(map.title).toBe('Harbor has the most stops: 90 of 200')
    const chart = map.chart as MapChart
    expect(chart.points).toHaveLength(200)
    expect(chart.points.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true)
    // 0.04° of longitude at this latitude is narrower than 0.05° of latitude.
    expect(chart.aspect).toBeGreaterThan(0.5)
    expect(chart.aspect).toBeLessThan(0.7)
    expect(chart.ranking?.items[0]).toEqual(expect.objectContaining({ label: 'Harbor', value: 90 }))
  })

  it('follows a running state through an ordered table and skips the clock', () => {
    const lead = [0, 0, 3, 3, 3, 3, 10, 10, 10, 7, 7, 7, 14, 14, 14, 14, 17, 17, 24, 24]
    const rows: Row[] = lead.map((value, index) => ({
      play_id: 40 + index * 31,
      seconds_remaining: 3600 - index * 180,
      lead: value,
      yards_gained: [4, -1, 22, 3, 0, 8, 15, 2, 6, -3][index % 10]!,
    }))
    const dashboard = build(rows, { noun: { singular: 'play', plural: 'plays' } })
    const sequence = dashboard.views[0]!
    expect(sequence.kind).toBe('sequence')
    expect(sequence.title).toBe('Lead went from 0 to 24 over 20 plays')
    expect(sequence.fields).toEqual(['play_id', 'lead'])
    expect(dashboard.views.some((item) => item.fields.includes('seconds_remaining'))).toBe(false)
  })

  it('draws yearly data by year and does not report a constant row count as a trend', () => {
    const rows: Row[] = []
    for (let year = 1990; year <= 2020; year += 5) {
      for (const country of ['A', 'B', 'C', 'D']) rows.push({ country, year, life_expectancy: 50 + (year - 1990) * 0.6 + country.charCodeAt(0) - 65 })
    }
    const dashboard = build(rows)
    const trend = view(dashboard.views, 'trend:year+life_expectancy')
    expect(trend.subtitle).toBe('Average life expectancy per year, by year')
    expect((trend.chart as LineChart).points.map((point) => point.label)).toEqual(['1990', '1995', '2000', '2005', '2010', '2015', '2020'])
    expect((trend.chart as LineChart).zeroBased).toBe(false)
    // Four rows every year is the table's design, not news.
    expect(dashboard.views.some((item) => item.id === 'trend:year')).toBe(false)
    expect(dashboard.views.some((item) => item.id === 'ranking:country')).toBe(false)
  })

  it('compares averages for an ordered scale and only when the difference is real', () => {
    const random = seeded(3)
    const rows: Row[] = Array.from({ length: 300 }, (_, index) => {
      const cylinders = [4, 6, 8][index % 3]!
      return { cylinders, mpg: 40 - cylinders * 3 + random() * 14, noise: random() * 10 }
    })
    const all = candidateViews(profileTable(Object.keys(rows[0]!), rows))
    const real = view(all, 'ranking:cylinders+mpg')
    expect(real.title).toMatch(/^Cylinders 4 has the highest average mpg \([\d.]+\); Cylinders 8 the lowest \([\d.]+\)$/)
    expect((real.chart as BarsChart).items.map((item) => item.label)).toEqual(['Cylinders 4', 'Cylinders 6', 'Cylinders 8'])
    expect(real.score).toBeGreaterThan(0.5)
    const none = view(all, 'ranking:cylinders+noise')
    expect(none.title).toBe('Average noise is similar across cylinders')
    expect(none.score).toBeLessThan(0.3)
  })

  it('relates two measures and trims long tails in a spread', () => {
    const random = seeded(5)
    const rows: Row[] = Array.from({ length: 200 }, (_, index) => {
      const distance = 1 + random() * 9
      return { distance, fare: 3 + distance * 2.5 + random() * 12, tip: index === 0 ? 400 : random() * 5 }
    })
    const all = candidateViews(profileTable(Object.keys(rows[0]!), rows))
    const scatter = view(all, 'scatter:distance+fare')
    expect(scatter.title).toMatch(/^Fare rises as distance increases, closely linked \(r = 0\.\d\d\)$/)
    const histogram = view(all, 'histogram:tip')
    expect(histogram.footnote).toMatch(/Extreme values are gathered into the end bars/)
    const bins = (histogram.chart as { bins: Array<{ count: number; label: string }> }).bins
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(200)
    expect(bins[bins.length - 1]!.label).toMatch(/or more$/)
  })

  it('returns no views, rather than filler, for a table with nothing to chart', () => {
    expect(build([{ message: 'hello', note: 'first' }, { message: 'world', note: 'second' }]).views).toEqual([])
    expect(buildStoryDashboard(['a'], [])).toEqual(expect.objectContaining({ kpis: [], views: [] }))
  })
})

describe('view selection', () => {
  const fake = (id: string, kind: StoryView['kind'], score: number, fields: string[]): StoryView => ({
    id, kind, score, fields, eyebrow: '', title: id, subtitle: '', chart: { type: 'bars', items: [], max: 0 }, table: { columns: [], rows: [] },
  })

  it('discounts a view that reuses a grouping already on the page', () => {
    const picked = selectViews([
      fake('a', 'rate', 0.9, ['region', 'returned']),
      fake('b', 'rate', 0.85, ['region', 'late']),
      fake('c', 'ranking', 0.6, ['category']),
    ], 2)
    expect(picked.map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('drops weak findings and caps each kind', () => {
    expect(selectViews([fake('weak', 'ranking', 0.2, ['x'])])).toEqual([])
    const histograms = selectViews([fake('h1', 'histogram', 0.5, ['x']), fake('h2', 'histogram', 0.5, ['y'])])
    expect(histograms.map((item) => item.id)).toEqual(['h1'])
  })
})

describe('statistics and formatting', () => {
  it('tests rate and mean differences against chance', () => {
    expect(rateDifference([{ yes: 80, total: 100 }, { yes: 20, total: 100 }]).significant).toBe(true)
    expect(rateDifference([{ yes: 52, total: 100 }, { yes: 48, total: 100 }]).significant).toBe(false)
    expect(rateDifference([{ yes: 0, total: 100 }, { yes: 0, total: 100 }])).toEqual({ significant: false, cramersV: 0 })
    expect(meanDifference([[1, 2, 3, 2, 1, 2], [11, 12, 13, 12, 11, 12]]).significant).toBe(true)
    expect(meanDifference([[1, 5, 3, 7, 2, 6], [2, 6, 3, 5, 1, 7]]).significant).toBe(false)
    // 3.84 is the 5% critical value at one degree of freedom; 6.63 is the 1% value.
    expect(chiSquareSignificant(3.84, 1)).toBe(false)
    expect(chiSquareSignificant(7, 1)).toBe(true)
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1)
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
  })

  it('formats numbers the way a reader expects', () => {
    expect(formatNumber(1284)).toBe('1,284')
    expect(formatNumber(12940)).toBe('12.9K')
    expect(formatNumber(4_200_000, '$')).toBe('$4.2M')
    expect(formatNumber(-3.14159)).toBe('−3.14')
    expect(formatNumber(0.5, '%')).toBe('0.5%')
    expect(formatShare(0.254)).toBe('25%')
    expect(formatShare(0.059)).toBe('5.9%')
    expect(formatShare(0.004)).toBe('<1%')
    expect(formatRatio(1.53)).toBe('1.5×')
    expect(formatRatio(11.4)).toBe('11×')
    expect(formatTimeBucket(Date.UTC(2018, 9, 13), 'day', false)).toBe('Oct 13')
    expect(formatTimeBucket(Date.UTC(2018, 9, 1), 'quarter', false)).toBe('Q4 2018')
    expect(niceTicks(0, 434)).toEqual([0, 200, 400, 600])
    expect(niceTicks(92, 134)).toEqual([80, 100, 120, 140])
  })
})
