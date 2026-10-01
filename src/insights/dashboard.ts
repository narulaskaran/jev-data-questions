import type { AnalysisRowInput } from '../dataset/csvTypes.js'
import { formatCount, formatDay, formatNumber, formatShare, lowerFirst } from './format.js'
import { profileTable, type FieldProfile, type TableProfile } from './profile.js'
import { DEFAULT_ROW_NOUN, candidateViews, rankedMeasures, type RowNoun, type StoryView, type ViewKind } from './views.js'

export interface Kpi {
  label: string
  value: string
  detail?: string
}

export interface StoryDashboard {
  kpis: Kpi[]
  views: StoryView[]
  profile: TableProfile
  noun: RowNoun
  /** Labels of the columns a question matched, when one was asked. */
  focus?: string[]
}

export interface StoryOptions {
  /** What one row is: { singular: 'order', plural: 'orders' }. Defaults to "rows". */
  noun?: RowNoun
  maxViews?: number
  /** A plain-language question. Views about the columns it names come first. */
  question?: string
}

export const MAX_STORY_VIEWS = 6
const MIN_SCORE = 0.3
/** Below this, after discounting for repetition, a view is filler. */
const MIN_FILL = 0.24

/** How many views of one kind a dashboard may hold before it reads as repetitive. */
const KIND_LIMIT: Record<ViewKind, number> = {
  map: 1, trend: 2, sequence: 1, traits: 1, ranking: 3, rate: 2, histogram: 1, scatter: 1,
}

const DAY = 86_400_000

const pluralLabel = (label: string): string => {
  const text = lowerFirst(label)
  if (/(s|x|ch|sh)$/.test(text)) return `${text}es`
  if (/[^aeiou]y$/.test(text)) return `${text.slice(0, -1)}ies`
  return `${text}s`
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

const buildKpis = (profile: TableProfile, noun: RowNoun): Kpi[] => {
  const kpis: Kpi[] = [{ label: capitalize(noun.plural), value: formatCount(profile.rowCount) }]
  const measure = rankedMeasures(profile)[0]
  if (measure?.sum !== undefined && measure.mean !== undefined) {
    kpis.push(measure.additive
      ? { label: /^total\b/i.test(measure.label) ? measure.label : `Total ${lowerFirst(measure.label)}`, value: formatNumber(measure.sum, measure.unit), detail: `${formatNumber(measure.mean, measure.unit)} per ${noun.singular}` }
      : { label: `Average ${lowerFirst(measure.label)}`, value: formatNumber(measure.mean, measure.unit), detail: `Range ${formatNumber(measure.min!, measure.unit)} to ${formatNumber(measure.max!, measure.unit)}` })
  }
  const time = profile.fields.find((field) => field.kind === 'time')
  const times = time?.times?.filter((value): value is number => value !== undefined) ?? []
  if (time && times.length > 1) {
    const min = Math.min(...times)
    const max = Math.max(...times)
    const days = Math.round((max - min) / DAY) + 1
    const years = days / 365.25
    kpis.push({
      label: 'Time span',
      value: years >= 2 ? `${Math.round(years)} years` : days > 120 ? `${Math.round(days / 30.44)} months` : `${formatCount(days)} days`,
      detail: `${formatDay(min)} to ${formatDay(max)}`,
    })
  }
  const entity = profile.fields.find((field) => field.kind === 'entity')
  if (entity) kpis.push({ label: `Distinct ${pluralLabel(entity.label)}`, value: formatCount(entity.distinct) })
  const flags = profile.fields
    .filter((field): field is FieldProfile & { flags: Array<boolean | undefined> } => field.kind === 'flag' && field.flags !== undefined)
    .map((field) => ({ field, yes: field.flags.filter((value) => value === true).length }))
    .sort((left, right) => right.yes / right.field.present - left.yes / left.field.present)
  const flag = flags[0]
  if (flag) {
    kpis.push({
      label: flag.field.label,
      value: formatShare(flag.yes / flag.field.present),
      detail: `${formatCount(flag.yes)} of ${formatCount(flag.field.present)} ${noun.plural}`,
    })
  }
  // A leader is only worth a tile when it clearly leads.
  const category = profile.fields.find((field) => (
    field.kind === 'category' && field.top && field.top.length >= 2 && field.top[0]!.count >= field.top[1]!.count * 1.15
  ))
  if (category?.top) {
    const leader = category.top[0]!
    kpis.push({
      label: `Top ${lowerFirst(category.label)}`,
      value: leader.value,
      detail: `${formatShare(leader.count / category.present)} of ${noun.plural}`,
    })
  }
  return kpis.slice(0, 4)
}

/**
 * Picks the views that make the best dashboard: strongest findings first, with
 * each later pick discounted when it reuses a column or chart form already on
 * the page, so the result covers the table instead of repeating one cut.
 */
export const selectViews = (
  candidates: readonly StoryView[],
  maxViews = MAX_STORY_VIEWS,
  profile?: TableProfile,
): StoryView[] => {
  // A table with one measure should still show it against every grouping, so
  // repeating a measure costs little; repeating a grouping costs a lot.
  const measures = new Set(profile?.fields.filter((field) => field.kind === 'measure').map((field) => field.name))
  const chosen: StoryView[] = []
  const fieldUse = new Map<string, number>()
  const kindUse = new Map<ViewKind, number>()
  const remaining = candidates.filter((view) => view.score >= MIN_SCORE)
  while (chosen.length < maxViews && remaining.length > 0) {
    let bestIndex = -1
    let bestValue = 0
    remaining.forEach((view, index) => {
      if ((kindUse.get(view.kind) ?? 0) >= KIND_LIMIT[view.kind]) return
      const discount = view.fields.reduce((product, field) => (
        product * (measures.has(field) ? 0.9 : 0.6) ** (fieldUse.get(field) ?? 0)
      ), 1)
      const sameKind = kindUse.get(view.kind) ?? 0
      const value = view.score * discount * 0.85 ** sameKind
      if (value > bestValue) { bestValue = value; bestIndex = index }
    })
    if (bestIndex < 0 || bestValue < MIN_FILL) break
    const [view] = remaining.splice(bestIndex, 1)
    chosen.push(view!)
    kindUse.set(view!.kind, (kindUse.get(view!.kind) ?? 0) + 1)
    for (const field of view!.fields) fieldUse.set(field, (fieldUse.get(field) ?? 0) + 1)
  }
  return chosen
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'with', 'where', 'what', 'which', 'when', 'who', 'how', 'does', 'did', 'this', 'that',
  'most', 'more', 'less', 'least', 'many', 'much', 'each', 'per', 'from', 'into', 'than', 'they', 'them', 'their',
  'common', 'identify', 'show', 'find', 'list', 'compare', 'between', 'across', 'over', 'row', 'rows', 'data', 'column',
  'spotted', 'seen', 'have', 'has', 'was', 'were', 'not', 'all', 'any', 'out', 'top', 'number', 'count', 'average', 'total',
])

/** Crude stem so "locations" meets "location" and "eating" meets "eat". */
const stem = (word: string): string => {
  const lower = word.toLowerCase()
  if (lower.length > 5 && lower.endsWith('ing')) return lower.slice(0, -3)
  if (lower.length > 4 && lower.endsWith('ies')) return `${lower.slice(0, -3)}y`
  if (lower.length > 4 && lower.endsWith('es')) return lower.slice(0, -2)
  if (lower.length > 3 && lower.endsWith('s')) return lower.slice(0, -1)
  if (lower.length > 4 && lower.endsWith('ed')) return lower.slice(0, -2)
  return lower
}

const stems = (text: string): string[] => (
  text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word.toLowerCase()))
    .map(stem)
)

/** Columns a question names, by column name or by one of a column's values. */
export const matchQuestionFields = (question: string, profile: TableProfile): FieldProfile[] => {
  const asked = new Set(stems(question))
  if (asked.size === 0) return []
  return profile.fields.filter((field) => {
    if (stems(field.name).some((word) => asked.has(word))) return true
    if (field.kind !== 'category' && field.kind !== 'ordinal') return false
    return (field.top ?? []).some((entry) => stems(entry.value).some((word) => asked.has(word)))
  })
}

/**
 * Answers a question from the table itself: views built on the columns the
 * question names lead the dashboard, including a plain "no real difference"
 * when that is what the data says.
 */
const focusViews = (candidates: readonly StoryView[], matched: readonly FieldProfile[], maxViews: number, profile: TableProfile): StoryView[] => {
  const names = new Set(matched.map((field) => field.name))
  const hits = (view: StoryView): number => view.fields.filter((field) => names.has(field)).length
  const relevant = candidates
    .filter((view) => hits(view) > 0)
    // A view built only from the named columns answers the question most directly.
    .map((view) => ({ ...view, score: view.score + hits(view) + (hits(view) === view.fields.length ? 0.5 : 0) }))
  const leading = selectViews(relevant, Math.min(4, maxViews), profile)
  const leadingIds = new Set(leading.map((view) => view.id))
  const rest = selectViews(candidates.filter((view) => !leadingIds.has(view.id)), maxViews - leading.length, profile)
  return [...leading, ...rest].map((view) => candidates.find((candidate) => candidate.id === view.id) ?? view)
}

/** Forms that need the full width of the page to read well. */
export const isWideView = (view: StoryView): boolean => view.kind === 'map' || view.kind === 'trend' || view.kind === 'sequence'

/**
 * Orders views for a two-column page: full-width forms lead, the rest follow
 * in pairs. An unpaired last view is dropped rather than stretched across the
 * page, unless it is the only one of its kind of width.
 */
const arrangeViews = (views: readonly StoryView[]): StoryView[] => {
  const wide = views.filter(isWideView)
  const narrow = views.filter((view) => !isWideView(view))
  if (narrow.length >= 3 && narrow.length % 2 === 1) narrow.pop()
  // Bar lists are short and plots are tall; pairing like with like keeps rows even.
  const bars = narrow.filter((view) => view.chart.type === 'bars')
  const plots = narrow.filter((view) => view.chart.type !== 'bars')
  return [...wide, ...bars, ...plots]
}

/** Profiles a table and returns the dashboard that best tells its story. */
export const buildStoryDashboard = (
  columns: readonly string[],
  rows: readonly AnalysisRowInput[],
  options: StoryOptions = {},
): StoryDashboard => {
  const noun = options.noun ?? DEFAULT_ROW_NOUN
  const profile = profileTable(columns, rows)
  if (rows.length === 0) return { kpis: [], views: [], profile, noun }
  const maxViews = options.maxViews ?? MAX_STORY_VIEWS
  const candidates = candidateViews(profile, noun)
  const matched = options.question ? matchQuestionFields(options.question, profile) : []
  const views = matched.length > 0
    ? focusViews(candidates, matched, maxViews, profile)
    : arrangeViews(selectViews(candidates, maxViews, profile))
  return {
    kpis: buildKpis(profile, noun),
    views,
    profile,
    noun,
    ...(options.question?.trim() ? { focus: matched.map((field) => field.label) } : {}),
  }
}
