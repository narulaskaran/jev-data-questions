import type { AnalysisRowInput } from '../dataset/csvTypes.js'

/**
 * What a column is *for*, which decides the charts it can appear in.
 * - time: calendar dates. sequence: a row counter that orders the table.
 * - measure: a quantity to sum or average. ordinal: a small ordered scale.
 * - flag: yes/no. category: a handful of labels. entity: many repeating labels.
 * - latitude/longitude: a coordinate pair. id/text/constant/empty: not charted.
 */
export type FieldKind =
  | 'time' | 'sequence' | 'measure' | 'ordinal' | 'flag' | 'category' | 'entity'
  | 'latitude' | 'longitude' | 'id' | 'text' | 'constant' | 'empty'

/** A unit read from the cells themselves: a currency symbol or a percent sign. */
export type FieldUnit = '$' | '€' | '£' | '%'

export interface FieldProfile {
  name: string
  /** Sentence-case name for headlines and axes. */
  label: string
  kind: FieldKind
  present: number
  missing: number
  distinct: number
  /** Per-row parsed values, aligned with the table rows. Present for numeric kinds. */
  numbers?: Array<number | undefined>
  /** Per-row epoch milliseconds. Present for time. */
  times?: Array<number | undefined>
  /** Per-row display label. Present for category, entity, and ordinal. */
  labels?: Array<string | undefined>
  /** Per-row yes/no. Present for flag. */
  flags?: Array<boolean | undefined>
  /** Distinct labels by descending count. */
  top?: Array<{ value: string; count: number }>
  /** Labels in their natural order, when they have one (months, weekdays). */
  order?: string[]
  min?: number
  max?: number
  mean?: number
  sum?: number
  integer?: boolean
  /** Totals are meaningful (sales, yards). Otherwise the column is averaged. */
  additive?: boolean
  unit?: FieldUnit
  /** True when the time values carry a time of day, not only a date. */
  hasClock?: boolean
  /** The coarsest calendar step every value sits on: yearly data is never drawn by day. */
  resolution?: 'year' | 'month' | 'day'
}

export interface TableProfile {
  rowCount: number
  fields: FieldProfile[]
}

const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', 'nil', '?', '-', '--', '#n/a'])
const TRUE_TOKENS = new Set(['true', 'yes', 'y', 't'])
const FALSE_TOKENS = new Set(['false', 'no', 'n', 'f'])

const ID_NAME_RE = /(^|[_\s-])(id|uuid|guid|key|hash|sku|isbn|ssn)$|^(id|uuid|guid)([_\s-]|$)|^unique[_\s-]/i
const CODE_NAME_RE = /(^|[_\s-])(zip|zipcode|postal|postcode|phone|fax|fips)([_\s-]|$)/i
const SEQUENCE_NAME_RE = /(^|[_\s-])(id|index|idx|order|seq|sequence|step|row|no|num|number|rank|play|tick|frame|iteration|epoch)$/i
const LAT_NAME_RE = /^(lat|latitude|y)$/i
const LNG_NAME_RE = /^(lng|lon|long|longitude|x)$/i
const YEAR_NAME_RE = /(^|[_\s-])(year|yr)$/i
const DATE_NAME_RE = /(date|time|timestamp|day|created|updated|_at$|_on$)/i

/** Lower-case words of a column name: "yardsGained" and "yards_gained" both give [yards, gained]. */
const nameWords = (name: string): string[] => (
  name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
)

// Quantities that add up across rows, so a total is meaningful.
const ADDITIVE_WORDS = new Set([
  'sales', 'revenue', 'amount', 'total', 'count', 'qty', 'quantity', 'units', 'profit', 'cost', 'costs',
  'spend', 'spent', 'budget', 'yards', 'yds', 'points', 'goals', 'orders', 'visits', 'views', 'clicks',
  'hours', 'minutes', 'duration', 'downloads', 'sessions', 'income', 'expense', 'expenses', 'paid',
  'volume', 'distance', 'miles', 'gained', 'wins', 'losses', 'deaths', 'cases', 'sold', 'tip', 'tips',
  'fare', 'bill', 'fee', 'fees', 'donation', 'donations', 'calls', 'attempts', 'shots', 'assists',
  'passengers', 'bookings', 'signups', 'purchases', 'tolls',
])
// Levels, rates, and states: averaging is meaningful, adding is not.
const LEVEL_WORDS = new Set([
  'avg', 'average', 'mean', 'median', 'rate', 'ratio', 'pct', 'percent', 'percentage', 'share', 'per',
  'price', 'score', 'rating', 'index', 'remaining', 'differential', 'diff', 'age', 'temp', 'temperature',
  'togo', 'yardline', 'rank', 'level', 'grade', 'height', 'length', 'width', 'depth', 'speed', 'density',
  'margin', 'open', 'close', 'high', 'low', 'adjusted',
])
// Clocks and within-group counters order rows; they are not quantities.
const CLOCK_NAME_RE = /(seconds|minutes|time|secs|mins)[_\s-]?(remaining|elapsed|left)/i
const COUNTER_WORDS = new Set(['number', 'num', 'no', 'index', 'idx', 'rank', 'order', 'seq'])
const UNIT_WORDS = new Set(['mm', 'cm', 'km', 'kg', 'lb', 'lbs', 'mph', 'kph', 'usd', 'eur', 'gbp', 'ms', 'sec', 'secs', 'hrs', 'mi', 'ft', 'oz', 'g', 'm'])

// "yards_to_go" and "amount_needed" describe a situation, not something that accumulates.
const SITUATION_NAME_RE = /to[_\s-]?go$|(needed|required|left|remaining)$/i

const isAdditiveName = (name: string): boolean => {
  const words = nameWords(name)
  return words.some((word) => ADDITIVE_WORDS.has(word))
    && !words.some((word) => LEVEL_WORDS.has(word))
    && !SITUATION_NAME_RE.test(name)
}

const WORD_FIXES: Record<string, string> = {
  id: 'ID', qty: 'quantity', avg: 'average', num: 'number', amt: 'amount', pct: 'percent',
  yds: 'yards', qtr: 'quarter', lat: 'latitude', lng: 'longitude', lon: 'longitude',
  url: 'URL', usd: 'USD', gdp: 'GDP',
}

/** "primary_fur_color" → "Primary fur color"; "body_mass_g" → "Body mass (g)". */
export const humanizeName = (name: string): string => {
  const raw = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-./]+/)
    .filter(Boolean)
  const last = raw[raw.length - 1]?.toLowerCase()
  const unit = raw.length > 1 && last && UNIT_WORDS.has(last) ? raw.pop()!.toLowerCase() : undefined
  const words = raw.map((word) => (
    WORD_FIXES[word.toLowerCase()] ?? (/^[A-Z0-9]{2,5}$/.test(word) && /[A-Z]/.test(word) ? word : word.toLowerCase())
  ))
  const text = words.join(' ').trim()
  if (!text) return name
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${unit ? ` (${unit === 'usd' || unit === 'eur' || unit === 'gbp' ? unit.toUpperCase() : unit})` : ''}`
}

const isMissing = (value: unknown): boolean => (
  value === null || value === undefined
  || (typeof value === 'number' && !Number.isFinite(value))
  || (typeof value === 'string' && MISSING_TOKENS.has(value.trim().toLowerCase()))
)

const parseNumber = (value: unknown): { value: number; unit?: FieldUnit } | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? { value } : undefined
  if (typeof value !== 'string') return undefined
  let text = value.trim()
  if (!text) return undefined
  let unit: FieldUnit | undefined
  let sign = 1
  if (/^\(.*\)$/.test(text)) { sign = -1; text = text.slice(1, -1) }
  const currency = text.match(/^[-+]?([$€£])/) ?? text.match(/([$€£])$/)
  if (currency) { unit = currency[1] as FieldUnit; text = text.replace(/[$€£]/g, '') }
  if (text.endsWith('%')) { unit = '%'; text = text.slice(0, -1) }
  text = text.replace(/,/g, '').trim()
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? { value: sign * parsed, unit } : undefined
}

const utc = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number | undefined => {
  if (year < 1000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const time = Date.UTC(year, month - 1, day, hour, minute, second)
  // Reject impossible days such as Feb 31, which Date would roll forward.
  return new Date(time).getUTCDate() === day ? time : undefined
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

type DateOrder = 'mdy' | 'dmy'

const parseDateText = (text: string, order: DateOrder): { time: number; clock: boolean } | undefined => {
  const value = text.trim()
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    ?? value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (match) {
    const time = utc(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0))
    return time === undefined ? undefined : { time, clock: match[4] !== undefined }
  }
  match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (match) {
    const first = Number(match[1])
    const second = Number(match[2])
    const rawYear = Number(match[3])
    const year = match[3]!.length === 2 ? (rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear) : rawYear
    const [month, day] = order === 'mdy' ? [first, second] : [second, first]
    const time = utc(year, month, day, Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0))
    return time === undefined ? undefined : { time, clock: match[4] !== undefined }
  }
  match = value.match(/^(\d{4})-(\d{1,2})$/)
  if (match) {
    const time = utc(Number(match[1]), Number(match[2]), 1)
    return time === undefined ? undefined : { time, clock: false }
  }
  // "Jan 5, 2024", "5 January 2024", "March 2024".
  match = value.match(/^(?:(\d{1,2})\s+)?([A-Za-z]{3,9})\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/)
  if (match) {
    const month = MONTHS.indexOf(match[2]!.slice(0, 3).toLowerCase()) + 1
    const time = utc(Number(match[4]), month, Number(match[1] ?? match[3] ?? 1))
    return time === undefined ? undefined : { time, clock: false }
  }
  return undefined
}

/** 8-digit calendar numbers: 20181014 or the census-style 10142018. */
const parseCompactDate = (value: number): number | undefined => {
  if (!Number.isInteger(value) || value < 1011000 || value > 99991231) return undefined
  const text = String(value).padStart(8, '0')
  return utc(Number(text.slice(0, 4)), Number(text.slice(4, 6)), Number(text.slice(6, 8)))
    ?? utc(Number(text.slice(4, 8)), Number(text.slice(0, 2)), Number(text.slice(2, 4)))
}

const detectDateOrder = (texts: readonly string[]): DateOrder => {
  for (const text of texts) {
    const match = text.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]/)
    if (match && Number(match[1]) > 12) return 'dmy'
  }
  return 'mdy'
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** Month or weekday names sort by the calendar, not the alphabet or the count. */
const calendarOrder = (labels: readonly string[]): string[] | undefined => {
  for (const names of [MONTHS, WEEKDAYS]) {
    const position = (label: string): number => names.indexOf(label.trim().slice(0, 3).toLowerCase())
    if (labels.length >= 2 && labels.every((label) => /^[A-Za-z]{3,9}\.?$/.test(label.trim()) && position(label) >= 0)) {
      return [...labels].sort((left, right) => position(left) - position(right))
    }
  }
  return undefined
}

const share = (count: number, total: number): number => (total === 0 ? 0 : count / total)

interface RawColumn {
  name: string
  values: unknown[]
  present: unknown[]
}

const tallyLabels = (labels: ReadonlyArray<string | undefined>): Array<{ value: string; count: number }> => {
  const counts = new Map<string, number>()
  for (const label of labels) {
    if (label === undefined) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
}

const numericStats = (numbers: ReadonlyArray<number | undefined>) => {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let count = 0
  let integer = true
  for (const value of numbers) {
    if (value === undefined) continue
    if (value < min) min = value
    if (value > max) max = value
    sum += value
    count += 1
    if (integer && !Number.isInteger(value)) integer = false
  }
  return count === 0 ? undefined : { min, max, sum, mean: sum / count, integer }
}

const monotonicShare = (numbers: ReadonlyArray<number | undefined>): number => {
  let steps = 0
  let rising = 0
  let previous: number | undefined
  for (const value of numbers) {
    if (value === undefined) continue
    if (previous !== undefined) {
      steps += 1
      if (value > previous) rising += 1
    }
    previous = value
  }
  return steps === 0 ? 0 : rising / steps
}

const profileColumn = (column: RawColumn, rowCount: number): FieldProfile => {
  const { name, values, present } = column
  const base = {
    name,
    label: humanizeName(name),
    present: present.length,
    missing: rowCount - present.length,
  }
  const distinctValues = new Set(present.map((value) => String(value)))
  const distinct = distinctValues.size
  if (present.length === 0) return { ...base, kind: 'empty', distinct: 0 }

  // Yes/no columns: booleans, yes/no words, or a 0/1 indicator.
  const flagValues = values.map((value): boolean | undefined => {
    if (isMissing(value)) return undefined
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined
    const token = String(value).trim().toLowerCase()
    if (TRUE_TOKENS.has(token) || token === '1') return true
    if (FALSE_TOKENS.has(token) || token === '0') return false
    return undefined
  })
  const flagCount = flagValues.filter((value) => value !== undefined).length
  if (flagCount === present.length && distinct <= 2) {
    if (distinct < 2) return { ...base, kind: 'constant', distinct }
    return { ...base, kind: 'flag', distinct, flags: flagValues }
  }
  if (distinct < 2) return { ...base, kind: 'constant', distinct }

  const parsedNumbers = values.map((value) => (isMissing(value) ? undefined : parseNumber(value)))
  const numericCount = parsedNumbers.filter((value) => value !== undefined).length
  const numeric = numericCount >= Math.max(1, Math.ceil(present.length * 0.95))
  const texts = present.filter((value): value is string => typeof value === 'string')

  // Calendar dates written as text.
  if (!numeric && texts.length === present.length) {
    const order = detectDateOrder(texts)
    const parsed = values.map((value) => (typeof value === 'string' && !isMissing(value) ? parseDateText(value, order) : undefined))
    const dated = parsed.filter((value) => value !== undefined).length
    if (dated >= Math.ceil(present.length * 0.9)) {
      const times = parsed.map((value) => value?.time)
      if (new Set(times.filter((value) => value !== undefined)).size >= 2) {
        return { ...base, kind: 'time', distinct, times, hasClock: parsed.some((value) => value?.clock) }
      }
    }
  }

  if (numeric) {
    const numbers = parsedNumbers.map((value) => value?.value)
    const unit = parsedNumbers.find((value) => value?.unit)?.unit
    const stats = numericStats(numbers)!
    const numericBase = { ...base, distinct, numbers, ...stats, unit }

    if (stats.integer && DATE_NAME_RE.test(name)) {
      const times = numbers.map((value) => (value === undefined ? undefined : parseCompactDate(value)))
      if (times.every((value, index) => numbers[index] === undefined || value !== undefined)) {
        return { ...base, kind: 'time', distinct, times, hasClock: false }
      }
    }
    if (stats.integer && YEAR_NAME_RE.test(name) && stats.min >= 1500 && stats.max <= 2200) {
      return { ...base, kind: 'time', distinct, times: numbers.map((value) => (value === undefined ? undefined : utc(value, 1, 1))), hasClock: false }
    }
    if (LAT_NAME_RE.test(name) && stats.min >= -90 && stats.max <= 90) return { ...numericBase, kind: 'latitude' }
    if (LNG_NAME_RE.test(name) && stats.min >= -180 && stats.max <= 180) return { ...numericBase, kind: 'longitude' }
    if (CODE_NAME_RE.test(name)) return { ...base, kind: 'text', distinct }

    const unique = distinct === present.length
    if (stats.integer && unique && present.length >= 8 && SEQUENCE_NAME_RE.test(name) && monotonicShare(numbers) >= 0.98) {
      return { ...numericBase, kind: 'sequence' }
    }
    if (ID_NAME_RE.test(name)) return { ...base, kind: 'id', distinct }

    if (CLOCK_NAME_RE.test(name)) return { ...base, kind: 'id', distinct }
    const words = nameWords(name)
    if (stats.integer && words.length > 1 && COUNTER_WORDS.has(words[words.length - 1]!)) return { ...base, kind: 'id', distinct }

    const namedAdditive = isAdditiveName(name)
    // A short dense scale (quarters 1–4, ratings 1–5, months 1–12) groups rows
    // like a category. A sparse spread of integers (scores 0, 3, 10, 17) does not.
    if (stats.integer && distinct <= 12 && stats.max - stats.min < 12 && !namedAdditive && !unit) {
      const labels = numbers.map((value) => (value === undefined ? undefined : String(value)))
      return { ...numericBase, kind: 'ordinal', labels, top: tallyLabels(labels) }
    }
    return { ...numericBase, kind: 'measure', additive: namedAdditive }
  }

  // Text labels.
  const labels = values.map((value) => (isMissing(value) ? undefined : String(value).trim()))
  const top = tallyLabels(labels)
  const repeats = share(distinct, present.length)
  if (ID_NAME_RE.test(name) && repeats > 0.5) return { ...base, kind: 'id', distinct }
  if (distinct <= 20 && (repeats <= 0.5 || present.length <= 20) && distinct < present.length) {
    return { ...base, kind: 'category', distinct, labels, top, order: calendarOrder(top.map((entry) => entry.value)) }
  }
  if (repeats <= 0.5) return { ...base, kind: 'entity', distinct, labels, top }
  if (repeats > 0.9) return { ...base, kind: 'id', distinct }
  return { ...base, kind: 'text', distinct }
}

/** Assigns a role to every column so the dashboard can choose charts that fit. */
export const profileTable = (
  columns: readonly string[],
  rows: readonly AnalysisRowInput[],
): TableProfile => {
  const fields = columns.map((name) => {
    const values = rows.map((row) => row[name] as unknown)
    return profileColumn({ name, values, present: values.filter((value) => !isMissing(value)) }, rows.length)
  })

  // Coordinates only count as a pair. A lone "x" or "y" is an ordinary number.
  const lat = fields.find((field) => field.kind === 'latitude')
  const lng = fields.find((field) => field.kind === 'longitude')
  const namedPair = lat && lng && !(/^y$/i.test(lat.name) !== /^x$/i.test(lng.name))
  const plausiblePair = namedPair && (
    !/^y$/i.test(lat.name) || (!lat.integer && !lng.integer)
  )
  for (const field of fields) {
    if ((field.kind === 'latitude' || field.kind === 'longitude') && !plausiblePair) {
      field.kind = 'measure'
      field.additive = false
    }
  }
  if (plausiblePair) {
    // Keep one pair; extra coordinate-named columns are not charted.
    for (const field of fields) {
      if ((field.kind === 'latitude' && field !== lat) || (field.kind === 'longitude' && field !== lng)) field.kind = 'text'
    }
  }

  // One ordering column is enough. Dates win over a row counter.
  const sequences = fields.filter((field) => field.kind === 'sequence')
  sequences.slice(1).forEach((field) => { field.kind = 'id' })

  // A column that climbs or falls in step with the row order is a clock, not a finding.
  const order = sequences[0]?.numbers
  if (order) {
    for (const field of fields) {
      if (field.kind !== 'measure' || !field.numbers) continue
      const pairs = field.numbers
        .map((value, row) => [order[row], value] as const)
        .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined)
      if (pairs.length >= 8 && Math.abs(correlation(pairs)) > 0.97) field.kind = 'id'
    }
  }

  for (const field of fields) {
    if (field.kind !== 'time' || !field.times) continue
    const dates = field.times.filter((value): value is number => value !== undefined).map((value) => new Date(value))
    field.resolution = dates.every((date) => date.getUTCMonth() === 0 && date.getUTCDate() === 1)
      ? 'year'
      : dates.every((date) => date.getUTCDate() === 1) ? 'month' : 'day'
  }

  dropRestatements(fields)
  return { rowCount: rows.length, fields }
}

const correlation = (pairs: ReadonlyArray<readonly [number, number]>): number => {
  const n = pairs.length
  const meanX = pairs.reduce((sum, pair) => sum + pair[0], 0) / n
  const meanY = pairs.reduce((sum, pair) => sum + pair[1], 0) / n
  let cov = 0
  let varX = 0
  let varY = 0
  for (const [x, y] of pairs) {
    cov += (x - meanX) * (y - meanY)
    varX += (x - meanX) ** 2
    varY += (y - meanY) ** 2
  }
  return varX === 0 || varY === 0 ? 0 : cov / Math.sqrt(varX * varY)
}

const meanLabelLength = (field: FieldProfile): number => {
  const top = field.top ?? []
  return top.length === 0 ? 0 : top.reduce((sum, entry) => sum + entry.value.length, 0) / top.length
}

const rowLabels = (field: FieldProfile): Array<string | undefined> | undefined => (
  field.labels ?? field.flags?.map((value) => (value === undefined ? undefined : String(value)))
)

/**
 * Two columns that say the same thing in different words ("survived" and
 * "alive", a player ID and the player name) would fill the dashboard with one
 * finding twice. Keep the more readable column of each pair.
 */
const dropRestatements = (fields: FieldProfile[]): void => {
  const groupable = fields.filter((field) => ['category', 'entity', 'ordinal', 'flag'].includes(field.kind))
  for (let left = 0; left < groupable.length; left += 1) {
    for (let right = left + 1; right < groupable.length; right += 1) {
      const first = groupable[left]!
      const second = groupable[right]!
      if (first.kind === 'text' || second.kind === 'text' || first.distinct !== second.distinct) continue
      const a = rowLabels(first)
      const b = rowLabels(second)
      if (!a || !b) continue
      const forward = new Map<string, string>()
      const backward = new Map<string, string>()
      let paired = 0
      let same = true
      for (let row = 0; row < a.length && same; row += 1) {
        const x = a[row]
        const y = b[row]
        if (x === undefined || y === undefined) continue
        paired += 1
        if ((forward.get(x) ?? y) !== y || (backward.get(y) ?? x) !== x) same = false
        forward.set(x, y)
        backward.set(y, x)
      }
      if (!same || paired < Math.min(first.present, second.present) * 0.9 || paired < 4) continue
      const firstIsId = ID_NAME_RE.test(first.name)
      const secondIsId = ID_NAME_RE.test(second.name)
      let loser = second
      if (firstIsId !== secondIsId) loser = firstIsId ? first : second
      // Spelled-out labels ("Southampton") read better than their codes ("S").
      else if (first.kind !== 'flag' && second.kind !== 'flag' && meanLabelLength(second) > meanLabelLength(first)) loser = first
      loser.kind = 'text'
    }
  }
}

export const fieldsOfKind = (profile: TableProfile, ...kinds: FieldKind[]): FieldProfile[] => (
  profile.fields.filter((field) => kinds.includes(field.kind))
)
