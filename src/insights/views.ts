import {
  formatCount,
  formatNumber,
  formatRatio,
  formatShare,
  formatTimeBucket,
  lowerFirst,
  type TimeGrain,
} from './format.js'
import type { FieldProfile, FieldUnit, TableProfile } from './profile.js'
import { lagOneCorrelation, meanDifference, pearson, quantile, rateDifference } from './stats.js'

export interface RowNoun {
  singular: string
  plural: string
}

export const DEFAULT_ROW_NOUN: RowNoun = { singular: 'row', plural: 'rows' }

export type ViewKind = 'map' | 'trend' | 'sequence' | 'ranking' | 'rate' | 'traits' | 'histogram' | 'scatter'

export interface BarItem {
  label: string
  value: number
  /** The value as it should be read at the bar tip. */
  display: string
  /** Supporting count for the tooltip and the data table. */
  detail?: string
  /** A remainder bucket ("Other"), drawn in gray. */
  muted?: boolean
}

export interface BarsChart {
  type: 'bars'
  items: BarItem[]
  max: number
  /** A comparison line across every bar, such as the overall rate. */
  reference?: { value: number; label: string }
}

export interface LinePoint {
  /** Position along the axis in 0–1. */
  x: number
  label: string
  value: number
  display: string
}

export interface LineChart {
  type: 'line'
  points: LinePoint[]
  ticks: Array<{ x: number; label: string }>
  unit?: FieldUnit
  /** Index of the point the headline is about. */
  highlight?: number
  /** Start the value axis at zero (counts and totals). */
  zeroBased: boolean
  /** Draw a dot on every point (few points, or gaps between them). */
  markers: boolean
}

export interface HistogramChart {
  type: 'histogram'
  bins: Array<{ from: number; to: number; count: number; label: string }>
  median: number
  medianLabel: string
  unit?: FieldUnit
}

export interface ScatterChart {
  type: 'scatter'
  points: Array<{ x: number; y: number }>
  xLabel: string
  yLabel: string
  xUnit?: FieldUnit
  yUnit?: FieldUnit
  /** Least-squares line, drawn as context for the headline. */
  fit: { slope: number; intercept: number }
}

export interface MapChart {
  type: 'map'
  /** Points in a 0–1 box; y grows downward. */
  points: Array<{ x: number; y: number }>
  /** Width divided by height of the projected area. */
  aspect: number
  ranking?: { label: string; items: BarItem[]; max: number }
}

export type ViewChart = BarsChart | LineChart | HistogramChart | ScatterChart | MapChart

export interface ViewTable {
  columns: string[]
  rows: Array<Array<string | number>>
}

export interface StoryView {
  id: string
  kind: ViewKind
  /** Short label for the kind of reading: "Over time", "Breakdown". */
  eyebrow: string
  /** The finding, stated as a sentence. */
  title: string
  /** What is plotted, so the headline can be checked against the chart. */
  subtitle: string
  footnote?: string
  chart: ViewChart
  /** Source columns, used to keep the dashboard from repeating itself. */
  fields: string[]
  /** 0–1: how much this view is worth a place on the dashboard. */
  score: number
  table: ViewTable
}

interface Context {
  profile: TableProfile
  noun: RowNoun
}

const MAX_BARS = 8
const MIN_GROUP = 5
const PLACE_NAME_RE = /(hectare|neighbou?rhood|borough|district|city|town|state|province|region|zone|area|ward|county|country|park|venue|station|site|location|place|market|territory|store|branch)/i

const TRAITS_FIELD = '#yes-no-columns'

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

const isDimension = (field: FieldProfile): boolean => field.kind === 'category' || field.kind === 'entity' || field.kind === 'ordinal'

/** "Quarter 3" for a numeric scale; the label itself for text. */
const groupLabel = (dimension: FieldProfile, value: string): string => (
  dimension.kind === 'ordinal' ? `${dimension.label} ${value}` : value
)

interface Group {
  value: string
  label: string
  rows: number[]
}

const groupsOf = (dimension: FieldProfile): Group[] => {
  const groups = new Map<string, number[]>()
  dimension.labels?.forEach((label, row) => {
    if (label === undefined) return
    const rows = groups.get(label)
    if (rows) rows.push(row)
    else groups.set(label, [row])
  })
  const list = [...groups.entries()].map(([value, rows]) => ({ value, label: groupLabel(dimension, value), rows }))
  const order = dimension.order
  if (order) return list.sort((left, right) => order.indexOf(left.value) - order.indexOf(right.value))
  return dimension.kind === 'ordinal'
    ? list.sort((left, right) => Number(left.value) - Number(right.value))
    : list.sort((left, right) => right.rows.length - left.rows.length || left.value.localeCompare(right.value))
}

/** Groups with a natural order are drawn in that order, not ranked by size. */
const hasNaturalOrder = (dimension: FieldProfile): boolean => dimension.kind === 'ordinal' || dimension.order !== undefined

const missingNote = (field: FieldProfile, noun: RowNoun): string | undefined => (
  field.missing > 0
    ? `Excludes ${formatCount(field.missing)} ${field.missing === 1 ? noun.singular : noun.plural} with no ${lowerFirst(field.label)} recorded.`
    : undefined
)

const joinNotes = (...notes: Array<string | undefined>): string | undefined => {
  const text = notes.filter(Boolean).join(' ')
  return text || undefined
}

/** "Total sales", "Average price"; a column already named "Total" is not doubled. */
const aggregateName = (measure: FieldProfile, additive: boolean): string => {
  const name = lowerFirst(measure.label)
  if (!additive) return `Average ${name}`
  return /^total\b/i.test(measure.label) ? measure.label : `Total ${name}`
}

const viewId = (kind: ViewKind, fields: readonly string[]): string => `${kind}:${fields.join('+')}`

// ---------------------------------------------------------------------------
// Breakdown: how many rows fall in each group.

const countRanking = (dimension: FieldProfile, { noun }: Context): StoryView | undefined => {
  const groups = groupsOf(dimension)
  if (groups.length < 2) return undefined
  const present = dimension.present
  const ordered = hasNaturalOrder(dimension)
  const shown = ordered ? groups.slice(0, 12) : groups.slice(0, MAX_BARS)
  const items: BarItem[] = shown.map((group) => ({
    label: group.label,
    value: group.rows.length,
    display: formatCount(group.rows.length),
    detail: `${formatShare(group.rows.length / present)} of ${noun.plural}`,
  }))
  const hidden = groups.length - shown.length
  const hiddenCount = groups.slice(shown.length).reduce((sum, group) => sum + group.rows.length, 0)
  if (hidden > 0 && dimension.kind === 'category') {
    items.push({ label: `${hidden} other${hidden === 1 ? '' : 's'}`, value: hiddenCount, display: formatCount(hiddenCount), detail: `${formatShare(hiddenCount / present)} of ${noun.plural}`, muted: true })
  }
  const byCount = [...groups].sort((left, right) => right.rows.length - left.rows.length)
  const top = byCount[0]!
  const second = byCount[1]!
  // Identical counts in every group are how the table was built, not a finding.
  if (groups.length > 2 && top.rows.length === byCount[byCount.length - 1]!.rows.length) return undefined
  const topShare = top.rows.length / present
  const nearTie = second.rows.length / top.rows.length >= 0.92
  const title = ordered
    ? `${top.label} has the most ${noun.plural} (${formatCount(top.rows.length)})`
    : nearTie
      ? `${dimension.label}: ${top.label} and ${second.label} are nearly tied`
      : `${dimension.label}: ${top.label} leads with ${formatShare(topShare)} of ${noun.plural}`
  // A single dominant or evenly split column says little; a clear but
  // contested leader is the interesting middle.
  const balance = topShare > 0.9 ? 0.3 : topShare < 0.25 && groups.length > MAX_BARS ? 0.34 : 0.5
  return {
    id: viewId('ranking', [dimension.name]),
    kind: 'ranking',
    eyebrow: 'Breakdown',
    title,
    subtitle: `Number of ${noun.plural} by ${lowerFirst(dimension.label)}`,
    footnote: joinNotes(
      hidden > 0 && dimension.kind === 'entity' ? `Top ${shown.length} of ${formatCount(groups.length)} shown.` : undefined,
      missingNote(dimension, noun),
    ),
    chart: { type: 'bars', items, max: Math.max(...items.map((item) => item.value)) },
    fields: [dimension.name],
    score: ordered ? balance - 0.08 : balance,
    table: {
      columns: [dimension.label, capitalize(noun.plural), 'Share'],
      rows: groups.map((group) => [group.label, group.rows.length, formatShare(group.rows.length / present)]),
    },
  }
}

// ---------------------------------------------------------------------------
// Comparison: a measure totalled or averaged per group.

const measureRanking = (dimension: FieldProfile, measure: FieldProfile, { noun }: Context): StoryView | undefined => {
  const numbers = measure.numbers
  if (!numbers) return undefined
  // Totals across an ordered scale mostly restate how many rows sit at each step.
  const additive = Boolean(measure.additive) && dimension.kind !== 'ordinal'
  const groups = groupsOf(dimension)
    .map((group) => {
      const values = group.rows.map((row) => numbers[row]).filter((value): value is number => value !== undefined)
      const sum = values.reduce((total, value) => total + value, 0)
      return { ...group, values, sum, mean: values.length === 0 ? 0 : sum / values.length }
    })
    .filter((group) => group.values.length >= (additive ? 1 : MIN_GROUP))
  if (groups.length < 2) return undefined
  const valueOf = (group: typeof groups[number]): number => (additive ? group.sum : group.mean)
  const ordered = hasNaturalOrder(dimension)
  const ranked = [...groups].sort((left, right) => valueOf(right) - valueOf(left))
  const shown = ordered ? groups.slice(0, 12) : ranked.slice(0, MAX_BARS)
  // Bars share one zero baseline, so a mix of signs cannot be drawn honestly here.
  if (shown.some((group) => valueOf(group) < 0)) return undefined
  const items: BarItem[] = shown.map((group) => ({
    label: group.label,
    value: valueOf(group),
    display: formatNumber(valueOf(group), measure.unit),
    detail: `${formatCount(group.values.length)} ${group.values.length === 1 ? noun.singular : noun.plural}`,
  }))
  const top = ranked[0]!
  const bottom = ranked[ranked.length - 1]!
  const measureName = lowerFirst(measure.label)
  const aggregate = aggregateName(measure, additive)
  let title: string
  let score: number
  if (additive) {
    const total = groups.reduce((sum, group) => sum + group.sum, 0)
    title = total > 0
      ? `${top.label} leads ${measureName} with ${formatNumber(top.sum, measure.unit)}, ${formatShare(top.sum / total)} of the total`
      : `${top.label} leads ${measureName} with ${formatNumber(top.sum, measure.unit)}`
    const spread = top.sum === 0 ? 0 : 1 - valueOf(ranked[1]!) / top.sum
    // A total by group is the staple of a business dashboard, so it outranks a spread.
    score = 0.6 + clamp(spread, 0, 1) * 0.2
  } else {
    const test = meanDifference(groups.map((group) => group.values))
    if (!test.significant) {
      title = `${aggregate} is similar across ${lowerFirst(dimension.label)}`
      score = 0.18
    } else {
      title = groups.length === 2
        ? `${top.label} averages ${formatNumber(top.mean, measure.unit)} ${measureName}, against ${formatNumber(bottom.mean, measure.unit)} for ${bottom.label}`
        : `${top.label} has the highest ${lowerFirst(aggregate)} (${formatNumber(top.mean, measure.unit)}); ${bottom.label} the lowest (${formatNumber(bottom.mean, measure.unit)})`
      // Groups that explain nearly all of a measure usually define it (quarter and game clock).
      score = test.etaSquared > 0.9 ? 0.2 : 0.5 + clamp(test.etaSquared * 0.9, 0, 0.35)
    }
  }
  return {
    id: viewId('ranking', [dimension.name, measure.name]),
    kind: 'ranking',
    eyebrow: 'Comparison',
    title,
    subtitle: `${aggregate} by ${lowerFirst(dimension.label)}`,
    footnote: joinNotes(
      !ordered && ranked.length > shown.length ? `Top ${shown.length} of ${formatCount(ranked.length)} shown.` : undefined,
      !additive ? `Groups with fewer than ${MIN_GROUP} ${noun.plural} are left out.` : undefined,
    ),
    chart: { type: 'bars', items, max: Math.max(...items.map((item) => item.value), 0) },
    fields: [dimension.name, measure.name],
    score,
    table: {
      columns: [dimension.label, aggregate, capitalize(noun.plural)],
      rows: (ordered ? groups : ranked).map((group) => [group.label, Number(valueOf(group).toFixed(4)), group.values.length]),
    },
  }
}

// ---------------------------------------------------------------------------
// Rate: how often a yes/no column is yes within each group.

const rateByGroup = (dimension: FieldProfile, flag: FieldProfile, { noun }: Context): StoryView | undefined => {
  const flags = flag.flags
  if (!flags || dimension.kind === 'entity' || dimension.distinct > MAX_BARS) return undefined
  // With many small groups the extremes are mostly chance, so each group needs real weight.
  const minimum = Math.max(10, Math.ceil(dimension.present * 0.02))
  const groups = groupsOf(dimension)
    .map((group) => {
      const known = group.rows.filter((row) => flags[row] !== undefined)
      const yes = known.filter((row) => flags[row] === true).length
      return { ...group, yes, total: known.length, rate: known.length === 0 ? 0 : yes / known.length }
    })
    .filter((group) => group.total >= minimum)
  if (groups.length < 2) return undefined
  const totalYes = groups.reduce((sum, group) => sum + group.yes, 0)
  const total = groups.reduce((sum, group) => sum + group.total, 0)
  const overall = totalYes / total
  const test = rateDifference(groups)
  const ranked = [...groups].sort((left, right) => right.rate - left.rate)
  const top = ranked[0]!
  const bottom = ranked[ranked.length - 1]!
  const gap = top.rate - bottom.rate
  const meaningful = test.significant && gap >= 0.05
  // A group that is always or never "yes" is usually true by definition
  // (runs are never completed passes), which is not news.
  const definitional = top.rate === 1 || bottom.rate === 0 || test.cramersV > 0.8
  const flagName = flag.label
  let title: string
  if (!meaningful) {
    title = `${flagName} is about as common across ${lowerFirst(dimension.label)}`
  } else if (groups.length === 2 && bottom.rate > 0 && top.rate / bottom.rate >= 1.3) {
    title = `${flagName} is ${formatRatio(top.rate / bottom.rate)} as common for ${top.label} as for ${bottom.label}`
  } else if (groups.length === 2) {
    title = `${flagName} is more common for ${top.label} (${formatShare(top.rate)}) than for ${bottom.label} (${formatShare(bottom.rate)})`
  } else {
    title = `${flagName} is most common for ${top.label} (${formatShare(top.rate)}) and least for ${bottom.label} (${formatShare(bottom.rate)})`
  }
  const shown = (hasNaturalOrder(dimension) ? groups : ranked).slice(0, 12)
  const items: BarItem[] = shown.map((group) => ({
    label: group.label,
    value: group.rate,
    display: formatShare(group.rate),
    detail: `${formatCount(group.yes)} of ${formatCount(group.total)} ${noun.plural}`,
  }))
  return {
    id: viewId('rate', [dimension.name, flag.name]),
    kind: 'rate',
    eyebrow: 'Rate',
    title,
    subtitle: `Share of ${noun.plural} with ${lowerFirst(flagName)}, by ${lowerFirst(dimension.label)}`,
    footnote: joinNotes(missingNote(dimension, noun)),
    chart: {
      type: 'bars',
      items,
      max: Math.max(...items.map((item) => item.value), overall),
      reference: { value: overall, label: `Overall ${formatShare(overall)}` },
    },
    fields: [dimension.name, flag.name],
    score: !meaningful ? 0.15 : definitional ? 0.28 : 0.5 + clamp(test.cramersV * 1.2, 0, 0.4),
    table: {
      columns: [dimension.label, `${flagName} rate`, `${flagName} count`, capitalize(noun.plural)],
      rows: shown.map((group) => [group.label, formatShare(group.rate), group.yes, group.total]),
    },
  }
}

// ---------------------------------------------------------------------------
// Traits: several yes/no columns side by side.

const traitRates = (flags: readonly FieldProfile[], { noun }: Context): StoryView | undefined => {
  if (flags.length < 3) return undefined
  const rated = flags
    .map((flag) => {
      const yes = flag.flags?.filter((value) => value === true).length ?? 0
      return { flag, yes, rate: flag.present === 0 ? 0 : yes / flag.present }
    })
    .sort((left, right) => right.rate - left.rate)
  const shown = rated.slice(0, MAX_BARS)
  const top = rated[0]!
  const bottom = shown[shown.length - 1]!
  return {
    id: viewId('traits', flags.map((flag) => flag.name)),
    kind: 'traits',
    eyebrow: 'At a glance',
    title: `${top.flag.label} is the most common, in ${formatShare(top.rate)} of ${noun.plural}; ${lowerFirst(bottom.flag.label)} the least at ${formatShare(bottom.rate)}`,
    subtitle: `Share of ${noun.plural} marked yes in each yes/no column`,
    footnote: rated.length > shown.length ? `Top ${shown.length} of ${rated.length} yes/no columns shown.` : `A ${noun.singular} can be marked yes in more than one column.`,
    chart: {
      type: 'bars',
      items: shown.map((entry) => ({
        label: entry.flag.label,
        value: entry.rate,
        display: formatShare(entry.rate),
        detail: `${formatCount(entry.yes)} of ${formatCount(entry.flag.present)} ${noun.plural}`,
      })),
      max: top.rate,
    },
    // One shared key: a later view about a single yes/no column is not a repeat.
    fields: [TRAITS_FIELD],
    score: 0.62,
    table: {
      columns: ['Column', 'Share marked yes', 'Count', capitalize(noun.plural)],
      rows: rated.map((entry) => [entry.flag.label, formatShare(entry.rate), entry.yes, entry.flag.present]),
    },
  }
}

// ---------------------------------------------------------------------------
// Over time: rows or a measure, bucketed along a date column.

const DAY = 86_400_000

const bucketStart = (time: number, grain: TimeGrain): number => {
  const date = new Date(time)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  if (grain === 'year') return Date.UTC(year, 0, 1)
  if (grain === 'quarter') return Date.UTC(year, Math.floor(month / 3) * 3, 1)
  if (grain === 'month') return Date.UTC(year, month, 1)
  const day = Date.UTC(year, month, date.getUTCDate())
  if (grain === 'week') return day - ((date.getUTCDay() + 6) % 7) * DAY
  if (grain === 'hour') return day + date.getUTCHours() * 3_600_000
  return day
}

const nextBucket = (time: number, grain: TimeGrain): number => {
  const date = new Date(time)
  if (grain === 'year') return Date.UTC(date.getUTCFullYear() + 1, 0, 1)
  if (grain === 'quarter') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1)
  if (grain === 'month') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
  return time + (grain === 'week' ? 7 * DAY : grain === 'hour' ? 3_600_000 : DAY)
}

const MAX_BUCKETS = 160

/** Fewer rows than this per bucket and a total or average is mostly noise. */
const STEADY_BUCKET_ROWS = 12
const MIN_BUCKETS = 6

/**
 * The finest calendar step that still reads cleanly: within the bucket limit,
 * no finer than the data was recorded, and either one row per step (the table
 * is already a series) or enough rows per step for a steady figure.
 */
const chooseGrain = (times: readonly number[], time: FieldProfile): TimeGrain => {
  const min = Math.min(...times)
  const max = Math.max(...times)
  const span = max - min
  const grains: Array<[TimeGrain, number]> = [
    ['hour', 3_600_000], ['day', DAY], ['week', 7 * DAY], ['month', 30.44 * DAY], ['quarter', 91.3 * DAY], ['year', 365.25 * DAY],
  ]
  const floor = time.resolution === 'year' ? 5 : time.resolution === 'month' ? 3 : 0
  const usable = grains
    .map(([grain, size], index) => ({ grain, size, index }))
    .filter(({ grain, size, index }) => (
      index >= floor && !(grain === 'hour' && (!time.hasClock || span > 3 * DAY)) && span / size <= MAX_BUCKETS
    ))
  for (const [position, { grain }] of usable.entries()) {
    const buckets = new Set(times.map((value) => bucketStart(value, grain))).size
    const rowsPerBucket = times.length / buckets
    const next = usable[position + 1]
    const nextBuckets = next ? new Set(times.map((value) => bucketStart(value, next.grain))).size : 0
    if (rowsPerBucket <= 1.5 || rowsPerBucket >= STEADY_BUCKET_ROWS || nextBuckets < MIN_BUCKETS) return grain
  }
  return usable[usable.length - 1]?.grain ?? 'year'
}

const GRAIN_PHRASE: Record<TimeGrain, string> = {
  hour: 'hour', day: 'day', week: 'week', month: 'month', quarter: 'quarter', year: 'year',
}

const timeTrend = (time: FieldProfile, measure: FieldProfile | undefined, { noun }: Context): StoryView | undefined => {
  const times = time.times
  if (!times) return undefined
  const known = times.filter((value): value is number => value !== undefined)
  if (known.length < 3) return undefined
  const min = Math.min(...known)
  const max = Math.max(...known)
  if (min === max) return undefined
  const grain = chooseGrain(known, time)
  const buckets = new Map<number, { count: number; sum: number; values: number }>()
  times.forEach((value, row) => {
    if (value === undefined) return
    const key = bucketStart(value, grain)
    const bucket = buckets.get(key) ?? { count: 0, sum: 0, values: 0 }
    bucket.count += 1
    const number = measure?.numbers?.[row]
    if (number !== undefined) { bucket.sum += number; bucket.values += 1 }
    buckets.set(key, bucket)
  })
  const additive = Boolean(measure?.additive)
  const start = bucketStart(min, grain)
  const end = bucketStart(max, grain)
  const expected: number[] = []
  for (let key = start; key <= end && expected.length <= MAX_BUCKETS * 2; key = nextBucket(key, grain)) expected.push(key)
  const gaps = expected.filter((key) => !buckets.has(key)).length
  // A few empty buckets in an otherwise continuous record are real zeros. Many
  // empty buckets mean nothing was recorded then, so they stay blank.
  const fillZeros = (!measure || additive) && gaps > 0 && gaps / expected.length <= 0.2
  let keys = fillZeros ? expected : expected.filter((key) => buckets.has(key))
  // A first or last period the data only partly covers would read as a dip in
  // a count or total, so it is left off rather than drawn as a false drop.
  let trimmed = 0
  // Yearly or monthly stamps already stand for their whole period.
  const stamped = time.resolution === grain
  if ((!measure || additive) && !stamped && grain !== 'day' && grain !== 'hour' && keys.length >= MIN_BUCKETS + 2) {
    const covered = (key: number, from: number, to: number): number => (to - from) / (nextBucket(key, grain) - key)
    const first = keys[0]!
    const last = keys[keys.length - 1]!
    if (covered(first, min, nextBucket(first, grain)) < 0.75) { keys = keys.slice(1); trimmed += 1 }
    if (covered(last, last, max + DAY) < 0.75) { keys = keys.slice(0, -1); trimmed += 1 }
  }
  if (keys.length < 3) return undefined
  const valueAt = (key: number): number => {
    const bucket = buckets.get(key)
    if (!bucket) return 0
    if (!measure) return bucket.count
    return additive ? bucket.sum : bucket.values === 0 ? 0 : bucket.sum / bucket.values
  }
  const usable = measure && !additive ? keys.filter((key) => (buckets.get(key)?.values ?? 0) > 0) : keys
  if (usable.length < 3) return undefined
  const withYear = new Date(start).getUTCFullYear() !== new Date(end).getUTCFullYear()
  const axisStart = usable[0]!
  const span = Math.max(1, usable[usable.length - 1]! - axisStart)
  const unit = measure?.unit
  const points: LinePoint[] = usable.map((key) => ({
    x: (key - axisStart) / span,
    label: formatTimeBucket(key, grain, withYear),
    value: valueAt(key),
    display: measure ? formatNumber(valueAt(key), unit) : formatCount(valueAt(key)),
  }))
  const values = points.map((point) => point.value)
  // The same count in every period is the table's design (one row per country per year).
  // Trading days per week barely move either. Require real variation before
  // calling a count a trend.
  if (!measure) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
    if (mean === 0 || deviation / mean < 0.12) return undefined
  }
  const subject = measure ? aggregateName(measure, additive) : capitalize(noun.plural)
  const peak = values.indexOf(Math.max(...values))
  const third = Math.max(1, Math.floor(values.length / 3))
  const average = (list: readonly number[]): number => list.reduce((sum, value) => sum + value, 0) / list.length
  const early = average(values.slice(0, third))
  const late = average(values.slice(-third))
  const drift = pearson(points.map((point) => point.x), values)
  const change = early === 0 ? 0 : (late - early) / Math.abs(early)
  let title: string
  let highlight: number | undefined
  let trendNote: string | undefined
  // A steady drift with a large change is the story; otherwise the peak is.
  if (values.length >= 6 && Math.abs(drift) >= 0.45 && Math.abs(change) >= 0.2) {
    title = `${subject} ${change > 0 ? 'rose' : 'fell'} ${formatShare(Math.abs(change))} from the start of the period to the end`
    trendNote = 'The change compares the average of the first third of the period with the last third.'
    highlight = values.length - 1
  } else {
    const preposition = grain === 'day' || grain === 'hour' ? 'on' : grain === 'week' ? 'in the' : 'in'
    title = `${subject} peaked ${preposition} ${points[peak]!.label.replace(/^Week of /, 'week of ')} at ${points[peak]!.display}`
    highlight = peak
  }
  const tickEvery = Math.max(1, Math.ceil(points.length / 6))
  const ticks = points
    .filter((_, index) => index % tickEvery === 0 || index === points.length - 1)
    .filter((point, index, list) => index === list.length - 1 || list[list.length - 1]!.x - point.x > 0.08 || point === list[list.length - 1])
    .map((point) => ({ x: point.x, label: point.label.replace(/^Week of /, '') }))
  return {
    id: viewId('trend', measure ? [time.name, measure.name] : [time.name]),
    kind: 'trend',
    eyebrow: 'Over time',
    title,
    subtitle: `${subject} per ${GRAIN_PHRASE[grain]}, by ${lowerFirst(time.label)}`,
    footnote: joinNotes(
      trendNote,
      trimmed > 0 ? `The ${trimmed === 2 ? 'first and last' : 'partial'} ${GRAIN_PHRASE[grain]}${trimmed === 2 ? 's are' : ' at the edge of the range is'} only partly covered and not shown.` : undefined,
      !fillZeros && gaps > 0 ? `${gaps} ${GRAIN_PHRASE[grain]}${gaps === 1 ? '' : 's'} in the range ${gaps === 1 ? 'has' : 'have'} no ${noun.plural} and ${gaps === 1 ? 'is' : 'are'} left blank.` : undefined,
      missingNote(time, noun),
    ),
    chart: { type: 'line', points, ticks, unit, highlight, zeroBased: !measure || additive, markers: points.length <= 40 },
    fields: measure ? [time.name, measure.name] : [time.name],
    score: measure ? 0.9 : 0.86,
    table: {
      columns: [capitalize(GRAIN_PHRASE[grain]), subject],
      rows: points.map((point) => [point.label, Number(point.value.toFixed(4))]),
    },
  }
}

// ---------------------------------------------------------------------------
// In order: a running state followed across an ordered table.

const sequenceLine = (sequence: FieldProfile, measures: readonly FieldProfile[], { noun }: Context): StoryView | undefined => {
  const order = sequence.numbers
  if (!order) return undefined
  let best: { measure: FieldProfile; smoothness: number; series: Array<{ step: number; value: number }> } | undefined
  for (const measure of measures) {
    const series: Array<{ step: number; value: number }> = []
    order.forEach((step, row) => {
      const value = measure.numbers?.[row]
      if (step !== undefined && value !== undefined) series.push({ step, value })
    })
    if (series.length < 8) continue
    series.sort((left, right) => left.step - right.step)
    const values = series.map((point) => point.value)
    const smoothness = lagOneCorrelation(values)
    // A clock or countdown tracks row order exactly; it is the axis, not a story.
    const clockLike = Math.abs(pearson(series.map((_, index) => index), values)) > 0.985
    if (smoothness < 0.7 || clockLike) continue
    if (!best || smoothness > best.smoothness) best = { measure, smoothness, series }
  }
  if (!best) return undefined
  const { measure, series } = best
  const values = series.map((point) => point.value)
  const last = values.length - 1
  const points: LinePoint[] = series.map((point, index) => ({
    x: last === 0 ? 0 : index / last,
    label: `${capitalize(noun.singular)} ${index + 1}`,
    value: point.value,
    display: formatNumber(point.value, measure.unit),
  }))
  const highest = Math.max(...values)
  const lowest = Math.min(...values)
  const peak = values.indexOf(highest)
  const startDisplay = points[0]!.display
  const endDisplay = points[last]!.display
  const peakNote = highest > values[last]! && highest > values[0]!
    ? `, peaking at ${formatNumber(highest, measure.unit)}`
    : lowest < values[last]! && lowest < values[0]!
      ? `, dipping to ${formatNumber(lowest, measure.unit)}`
      : ''
  const tickCount = Math.min(5, points.length)
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const position = Math.round((index / (tickCount - 1)) * last)
    return { x: points[position]!.x, label: String(position + 1) }
  })
  return {
    id: viewId('sequence', [sequence.name, measure.name]),
    kind: 'sequence',
    eyebrow: 'In order',
    title: `${measure.label} went from ${startDisplay} to ${endDisplay} over ${formatCount(points.length)} ${noun.plural}${peakNote}`,
    subtitle: `${measure.label} at each ${noun.singular}, in ${lowerFirst(sequence.label)} order`,
    chart: { type: 'line', points, ticks, unit: measure.unit, highlight: peakNote ? (highest > values[last]! ? peak : values.indexOf(lowest)) : last, zeroBased: lowest >= 0, markers: false },
    fields: [sequence.name, measure.name],
    score: 0.82,
    table: {
      columns: [capitalize(noun.singular), measure.label],
      rows: points.map((point, index) => [index + 1, point.value]),
    },
  }
}

// ---------------------------------------------------------------------------
// Spread: how one measure is distributed.

const histogram = (measure: FieldProfile, { noun }: Context): StoryView | undefined => {
  const values = (measure.numbers ?? []).filter((value): value is number => value !== undefined).sort((left, right) => left - right)
  if (values.length < 12 || measure.distinct < 6) return undefined
  const q1 = quantile(values, 0.25)
  const median = quantile(values, 0.5)
  const q3 = quantile(values, 0.75)
  const spread = q3 - q1
  // Trim a long tail into an open-ended last bin so the bulk stays readable.
  let low = values[0]!
  let high = values[values.length - 1]!
  const trimmedHigh = spread > 0 && high > q3 + 4 * spread
  const trimmedLow = spread > 0 && low < q1 - 4 * spread
  if (trimmedHigh) high = quantile(values, 0.98)
  if (trimmedLow) low = quantile(values, 0.02)
  if (high <= low) return undefined
  const target = clamp(Math.round(Math.sqrt(values.length)), 6, 14)
  const rough = (high - low) / target
  const power = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough / power
  let step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power
  if (measure.integer) step = Math.max(1, Math.round(step))
  const first = Math.floor(low / step) * step
  const count = Math.max(1, Math.ceil((high - first) / step + 1e-9))
  const bins = Array.from({ length: count }, (_, index) => ({
    from: Number((first + index * step).toPrecision(12)),
    to: Number((first + (index + 1) * step).toPrecision(12)),
    count: 0,
    label: '',
  }))
  for (const value of values) {
    const index = clamp(Math.floor((value - first) / step), 0, count - 1)
    bins[index]!.count += 1
  }
  bins.forEach((bin, index) => {
    const from = formatNumber(bin.from, measure.unit)
    const closing = measure.integer && step === 1 ? '' : ` to ${formatNumber(measure.integer ? bin.to - 1 : bin.to, measure.unit)}`
    bin.label = index === count - 1 && trimmedHigh
      ? `${from} or more`
      : index === 0 && trimmedLow
        ? `${formatNumber(measure.integer ? bin.to - 1 : bin.to, measure.unit)} or less`
        : `${from}${closing}`
  })
  const name = lowerFirst(measure.label)
  const skewed = spread > 0 && (trimmedHigh || trimmedLow)
  return {
    id: viewId('histogram', [measure.name]),
    kind: 'histogram',
    eyebrow: 'Spread',
    title: q1 === q3
      ? `Most ${noun.plural} have ${name} of ${formatNumber(median, measure.unit)}`
      : `Typical ${name} is ${formatNumber(median, measure.unit)}; half of ${noun.plural} fall between ${formatNumber(q1, measure.unit)} and ${formatNumber(q3, measure.unit)}`,
    subtitle: `Number of ${noun.plural} at each level of ${name}`,
    footnote: joinNotes(
      trimmedHigh || trimmedLow ? 'Extreme values are gathered into the end bars.' : undefined,
      missingNote(measure, noun),
    ),
    chart: { type: 'histogram', bins, median, medianLabel: `Median ${formatNumber(median, measure.unit)}`, unit: measure.unit },
    fields: [measure.name],
    score: skewed ? 0.44 : 0.38,
    table: {
      columns: [measure.label, capitalize(noun.plural)],
      rows: bins.map((bin) => [bin.label, bin.count]),
    },
  }
}

// ---------------------------------------------------------------------------
// Relationship: the most strongly related pair of measures.

const MAX_SCATTER_POINTS = 1500

const scatter = (measures: readonly FieldProfile[], { noun }: Context): StoryView | undefined => {
  let best: { x: FieldProfile; y: FieldProfile; r: number; pairs: Array<{ x: number; y: number }> } | undefined
  const candidates = measures.slice(0, 8)
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const x = candidates[left]!
      const y = candidates[right]!
      const pairs: Array<{ x: number; y: number }> = []
      x.numbers?.forEach((value, row) => {
        const other = y.numbers?.[row]
        if (value !== undefined && other !== undefined) pairs.push({ x: value, y: other })
      })
      if (pairs.length < 20) continue
      const r = pearson(pairs.map((pair) => pair.x), pairs.map((pair) => pair.y))
      // Near-perfect correlation usually means one column is computed from the other.
      if (Math.abs(r) < 0.4 || Math.abs(r) > 0.95) continue
      if (!best || Math.abs(r) > Math.abs(best.r)) best = { x, y, r, pairs }
    }
  }
  if (!best) return undefined
  const { x, y, r, pairs } = best
  const meanX = pairs.reduce((sum, pair) => sum + pair.x, 0) / pairs.length
  const meanY = pairs.reduce((sum, pair) => sum + pair.y, 0) / pairs.length
  const varX = pairs.reduce((sum, pair) => sum + (pair.x - meanX) ** 2, 0)
  const slope = varX === 0 ? 0 : pairs.reduce((sum, pair) => sum + (pair.x - meanX) * (pair.y - meanY), 0) / varX
  const stride = Math.ceil(pairs.length / MAX_SCATTER_POINTS)
  const points = pairs.filter((_, index) => index % stride === 0)
  const strength = Math.abs(r) >= 0.7 ? 'closely' : 'loosely'
  return {
    id: viewId('scatter', [x.name, y.name]),
    kind: 'scatter',
    eyebrow: 'Relationship',
    title: `${y.label} ${r > 0 ? 'rises' : 'falls'} as ${lowerFirst(x.label)} increases, ${strength} linked (r = ${r.toFixed(2)})`,
    subtitle: `Each dot is one ${noun.singular}: ${lowerFirst(x.label)} across, ${lowerFirst(y.label)} up`,
    footnote: stride > 1 ? `Showing ${formatCount(points.length)} of ${formatCount(pairs.length)} ${noun.plural}.` : undefined,
    chart: { type: 'scatter', points, xLabel: x.label, yLabel: y.label, xUnit: x.unit, yUnit: y.unit, fit: { slope, intercept: meanY - slope * meanX } },
    fields: [x.name, y.name],
    score: 0.3 + Math.abs(r) * 0.45,
    table: {
      columns: [x.label, y.label],
      rows: points.slice(0, 200).map((point) => [point.x, point.y]),
    },
  }
}

// ---------------------------------------------------------------------------
// Map: every row placed by its coordinates.

const placeMap = (latitude: FieldProfile, longitude: FieldProfile, context: Context): StoryView | undefined => {
  const { profile, noun } = context
  const located: Array<{ lat: number; lng: number }> = []
  latitude.numbers?.forEach((lat, row) => {
    const lng = longitude.numbers?.[row]
    if (lat !== undefined && lng !== undefined) located.push({ lat, lng })
  })
  if (located.length < 5) return undefined
  const lats = located.map((point) => point.lat)
  const lngs = located.map((point) => point.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  if (minLat === maxLat || minLng === maxLng) return undefined
  // Degrees of longitude shrink toward the poles; correct so shapes stay true.
  const geographic = minLat >= -90 && maxLat <= 90 && minLng >= -180 && maxLng <= 180
  const squeeze = geographic ? Math.cos(((minLat + maxLat) / 2) * Math.PI / 180) : 1
  const width = (maxLng - minLng) * squeeze
  const height = maxLat - minLat
  const points = located.map((point) => ({
    x: (point.lng - minLng) / (maxLng - minLng),
    y: 1 - (point.lat - minLat) / height,
  }))
  const place = profile.fields.find((field) => isDimension(field) && field.kind !== 'ordinal' && PLACE_NAME_RE.test(field.name) && field.distinct >= 3)
  const groups = place ? groupsOf(place).slice(0, MAX_BARS) : []
  const top = groups[0]
  const topName = top && place ? (top.value.length <= 4 ? `${place.label} ${top.value}` : top.value) : undefined
  const missing = profile.rowCount - located.length
  return {
    id: viewId('map', [latitude.name, longitude.name]),
    kind: 'map',
    eyebrow: 'Where',
    title: topName && top
      ? `${topName} has the most ${noun.plural}: ${formatCount(top.rows.length)} of ${formatCount(located.length)}`
      : `Where the ${formatCount(located.length)} ${noun.plural} are`,
    subtitle: `Each dot is one ${noun.singular}, placed by its coordinates`,
    footnote: missing > 0 ? `${formatCount(missing)} ${missing === 1 ? noun.singular : noun.plural} with no coordinates ${missing === 1 ? 'is' : 'are'} not shown.` : undefined,
    chart: {
      type: 'map',
      points,
      aspect: clamp(width / height, 0.25, 4),
      ranking: place && groups.length >= 3 ? {
        label: `Most ${noun.plural} by ${lowerFirst(place.label)}`,
        items: groups.map((group) => ({ label: group.label, value: group.rows.length, display: formatCount(group.rows.length) })),
        max: groups[0]!.rows.length,
      } : undefined,
    },
    fields: [latitude.name, longitude.name, ...(place ? [place.name] : [])],
    score: 0.95,
    table: place && groups.length >= 3
      ? { columns: [place.label, capitalize(noun.plural)], rows: groupsOf(place).map((group) => [group.label, group.rows.length]) }
      : { columns: [latitude.label, longitude.label], rows: located.slice(0, 200).map((point) => [point.lat, point.lng]) },
  }
}

// ---------------------------------------------------------------------------

/** Measures in the order a reader would care about: totals first, then table order. */
export const rankedMeasures = (profile: TableProfile): FieldProfile[] => {
  const measures = profile.fields.filter((field) => field.kind === 'measure')
  return [...measures.filter((field) => field.additive), ...measures.filter((field) => !field.additive)]
}

/** Every chart the table could support, each with its own headline and score. */
export const candidateViews = (profile: TableProfile, noun: RowNoun = DEFAULT_ROW_NOUN): StoryView[] => {
  const context: Context = { profile, noun }
  const views: Array<StoryView | undefined> = []
  const dimensions = profile.fields.filter(isDimension)
  const measures = rankedMeasures(profile)
  const flags = profile.fields.filter((field) => field.kind === 'flag')
  const time = profile.fields.find((field) => field.kind === 'time')
  const sequence = profile.fields.find((field) => field.kind === 'sequence')
  const latitude = profile.fields.find((field) => field.kind === 'latitude')
  const longitude = profile.fields.find((field) => field.kind === 'longitude')

  if (latitude && longitude) views.push(placeMap(latitude, longitude, context))
  if (time) {
    views.push(timeTrend(time, undefined, context))
    for (const measure of measures.slice(0, 2)) views.push(timeTrend(time, measure, context))
  }
  if (sequence && !time) views.push(sequenceLine(sequence, measures, context))
  views.push(traitRates(flags, context))
  for (const dimension of dimensions) {
    views.push(countRanking(dimension, context))
    for (const measure of measures.slice(0, 4)) views.push(measureRanking(dimension, measure, context))
    for (const flag of flags) views.push(rateByGroup(dimension, flag, context))
  }
  for (const measure of measures.slice(0, 3)) views.push(histogram(measure, context))
  // Two running totals in an ordered table rise together whatever they measure,
  // so only compare measures that vary row to row.
  const order = sequence?.numbers
  const independent = order
    ? measures.filter((measure) => {
      const series = (measure.numbers ?? [])
        .map((value, row) => ({ step: order[row], value }))
        .filter((point): point is { step: number; value: number } => point.step !== undefined && point.value !== undefined)
        .sort((left, right) => left.step - right.step)
        .map((point) => point.value)
      return lagOneCorrelation(series) < 0.7
    })
    : measures
  views.push(scatter(independent, context))
  return views
    .filter((view): view is StoryView => view !== undefined)
    // Headlines often open with a value from the data ("usa", "credit card").
    .map((view) => ({ ...view, title: capitalize(view.title) }))
}
