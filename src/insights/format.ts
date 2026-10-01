import type { FieldUnit } from './profile.js'

const trimZeros = (text: string): string => (text.includes('.') ? text.replace(/\.?0+$/, '') : text)

const plain = (value: number): string => {
  const magnitude = Math.abs(value)
  const decimals = Number.isInteger(value) || magnitude >= 1000 ? 0 : magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : magnitude >= 1 ? 2 : 3
  return trimZeros(value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }))
}

/** 1,284 → "1,284", 12,940 → "12.9K", 4,200,000 → "4.2M". */
export const formatNumber = (value: number, unit?: FieldUnit): string => {
  if (!Number.isFinite(value)) return '–'
  const magnitude = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  let body: string
  if (magnitude >= 1e9) body = `${trimZeros((magnitude / 1e9).toFixed(magnitude >= 1e10 ? 1 : 2))}B`
  else if (magnitude >= 1e6) body = `${trimZeros((magnitude / 1e6).toFixed(magnitude >= 1e7 ? 1 : 2))}M`
  else if (magnitude >= 1e4) body = `${trimZeros((magnitude / 1e3).toFixed(magnitude >= 1e5 ? 0 : 1))}K`
  else body = plain(magnitude)
  if (unit === '%') return `${sign}${body}%`
  return `${sign}${unit ?? ''}${body}`
}

/** A share in 0–1 as a whole percent, keeping one decimal below 10%. */
export const formatShare = (ratio: number): string => {
  if (!Number.isFinite(ratio)) return '–'
  const percent = ratio * 100
  if (percent > 0 && percent < 1) return '<1%'
  if (percent > 99 && percent < 100) return '>99%'
  return `${percent < 10 && !Number.isInteger(percent) ? trimZeros(percent.toFixed(1)) : Math.round(percent)}%`
}

export const formatCount = (value: number): string => value.toLocaleString('en-US')

/** "2.1×" for readable ratios; whole numbers once the gap is large. */
export const formatRatio = (ratio: number): string => `${ratio >= 10 ? Math.round(ratio) : trimZeros(ratio.toFixed(1))}×`

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type TimeGrain = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year'

export const formatTimeBucket = (time: number, grain: TimeGrain, withYear: boolean): string => {
  const date = new Date(time)
  const year = date.getUTCFullYear()
  const month = MONTH_NAMES[date.getUTCMonth()]!
  const day = date.getUTCDate()
  if (grain === 'year') return String(year)
  if (grain === 'quarter') return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${year}`
  if (grain === 'month') return `${month} ${year}`
  const dayLabel = `${month} ${day}${withYear ? `, ${year}` : ''}`
  if (grain === 'week') return `Week of ${dayLabel}`
  if (grain === 'hour') {
    const hour = date.getUTCHours()
    return `${dayLabel}, ${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`
  }
  return dayLabel
}

export const formatDay = (time: number): string => {
  const date = new Date(time)
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}

/** Evenly spaced round axis values covering [min, max]. */
export const niceTicks = (min: number, max: number, target = 4): number[] => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0]
  if (min === max) return [min]
  const rough = (max - min) / Math.max(1, target)
  const power = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough / power
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power
  const first = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let value = first; value < max + step * 0.999; value += step) {
    ticks.push(Number(value.toPrecision(12)))
    if (ticks.length > 40) break
  }
  return ticks
}

export const lowerFirst = (text: string): string => (
  // Keep acronyms ("ID", "GDP per head") capitalized.
  /^[A-Z]{2}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1)
)
