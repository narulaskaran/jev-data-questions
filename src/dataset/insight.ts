import type { DatasetPreview } from '../shared/dataset'
import { FOOTBALL_FIXTURE_ID, footballPerspectiveLabel } from '../fixtures/footballTimeline'
import { SQUIRREL_FIXTURE_ID } from '../fixtures/squirrelCensus'
import { asPerspectiveLabel, perspectiveMetricTitle } from '../teamMetadata'
import { formatDraftQueryForEditor } from '../shared/jevQuery'
import {
  SAMPLE_PLAY_QUALITY_LEVELS,
  SAMPLE_PLAY_QUALITY_QUERY,
  SAMPLE_PLAY_QUALITY_TASK,
  SAMPLE_WIN_LIKELIHOOD_TASK,
  SAMPLE_WIN_NOUL_QUERY,
  SQUIRREL_ACTIVITY_QUERY,
  SQUIRREL_ACTIVITY_TASK,
  SQUIRREL_EATING_NOUL_QUERY,
  SQUIRREL_EATING_TASK,
  isGoodBadPlayClassList,
  isJunkLocationActivitySplit,
  looksLikePlaceEatingTask,
  looksLikePlayQuality,
  looksLikeWinLikelihood,
  type ChartVisualKind,
  type JevQuestionKind,
} from '../shared/questionKind'
import { inspectDatasetShape, type DatasetShape } from './shape'
import type { AnalysisRowInput } from './csvTypes'

export { isJunkLocationActivitySplit, looksLikePlaceEatingTask } from '../shared/questionKind'

export const MAX_INSIGHTS = 4

export interface InsightProposal {
  id: string
  title: string
  reason: string
  visual: ChartVisualKind
  task: string
  questionKind: JevQuestionKind
  classes: string[]
  cannedQuery?: string
  /** Compact team code when the series is one team's perspective (SEA for the sample). */
  perspectiveLabel?: string
}

const uniqueClasses = (values: readonly string[], max = 16): string[] => {
  const seen = new Set<string>()
  const classes: string[] = []
  for (const value of values) {
    const name = value.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    classes.push(name)
    if (classes.length >= max) break
  }
  return classes
}

const classesEqual = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false
  const expected = new Set(right.map((name) => name.toLowerCase()))
  return left.every((name) => expected.has(name.toLowerCase()))
}

const columnValues = (rows: readonly AnalysisRowInput[], column: string): string[] => (
  uniqueClasses(rows.map((row) => {
    const value = row[column]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  }))
)

const SHIFT_TITLE_RE = /\bshift\b|am\s*\/\s*pm|\bam-?pm\b/i
const CLASSIFY_BY_COLUMN_RE = /^classify by\s+/i
const LABELS_IN_TABLE_RE = /labels in this table/i
const AMPM_CLASS_RE = /^(am|pm)$/i

const isAmpmClasses = (classes: readonly string[]): boolean => (
  classes.length >= 2
  && classes.length <= 4
  && classes.every((name) => AMPM_CLASS_RE.test(name.trim()))
)

export const isBannedRawColumnClassInsight = (
  insight: Pick<InsightProposal, 'title' | 'reason' | 'visual' | 'questionKind' | 'classes'>,
  shape?: DatasetShape,
  rows: readonly AnalysisRowInput[] = [],
): boolean => {
  if (CLASSIFY_BY_COLUMN_RE.test(insight.title) || SHIFT_TITLE_RE.test(insight.title)) return true
  if (LABELS_IN_TABLE_RE.test(insight.reason)) return true
  if (insight.questionKind !== 'choice' && insight.visual !== 'bars') return false
  if (isAmpmClasses(insight.classes)) return true
  if (insight.classes.length < 2 || !shape) return false
  for (const column of shape.columns) {
    if (column.role !== 'categorical' && column.role !== 'boolean' && column.role !== 'place') continue
    const values = columnValues(rows, column.name)
    if (values.length >= 2 && classesEqual(values, insight.classes)) return true
  }
  return false
}

const eatingPlacesInsight = (shape: DatasetShape): InsightProposal => ({
  id: 'places-eating',
  title: 'Where they eat',
  reason: shape.geo ? 'Map of eating places.' : 'Ranked eating places.',
  visual: 'places',
  task: SQUIRREL_EATING_TASK,
  questionKind: 'noul',
  classes: [],
  cannedQuery: SQUIRREL_EATING_NOUL_QUERY,
})

const geoPlacesInsight = (): InsightProposal => ({
  id: 'places-geo',
  title: 'Where they are',
  reason: 'Map of these rows.',
  visual: 'places',
  task: 'Where are these rows?',
  questionKind: 'noul',
  classes: [],
  cannedQuery: 'Does this row represent an active sighting at this place?',
})

const rankedPlacesInsight = (): InsightProposal => ({
  id: 'places-ranked',
  title: 'Where they happen',
  reason: 'Ranked locations.',
  visual: 'places',
  task: 'Where do these rows happen?',
  questionKind: 'noul',
  classes: [],
  cannedQuery: 'Does this row happen at a notable place?',
})

const sightingActivityInsight = (): InsightProposal => ({
  id: 'series-activity',
  title: 'On the move',
  reason: 'Moving over each sighting.',
  visual: 'series',
  task: SQUIRREL_ACTIVITY_TASK,
  questionKind: 'noul',
  classes: [],
  cannedQuery: SQUIRREL_ACTIVITY_QUERY,
})

export const insightEyebrow = (insight: Pick<InsightProposal, 'id' | 'visual'>): string => {
  if (insight.id === 'places-eating') return 'Eating map'
  if (insight.id === 'series-activity') return 'P(moving)'
  if (insight.id === 'series-win') return 'P(win) line'
  if (insight.id === 'series-play-quality') return 'Quality'
  if (insight.visual === 'places') return 'Map'
  if (insight.visual === 'series') return 'Series'
  return 'Call'
}

export const isJunkDashboardInsight = (
  insight: Pick<InsightProposal, 'title' | 'reason' | 'visual' | 'questionKind' | 'classes'>,
  shape?: DatasetShape,
  rows: readonly AnalysisRowInput[] = [],
): boolean => {
  if (isBannedRawColumnClassInsight(insight, shape, rows) || isJunkLocationActivitySplit(insight.classes)) return true
  if (/^(notable rows|rate each row|yes or no|play success|places)$/i.test(insight.title.trim())) return true
  if (/class bars|labels in this table|classify by shift/i.test(`${insight.title} ${insight.reason}`)) return true
  return false
}

export const hasDiverseChartTypes = (insights: readonly Pick<InsightProposal, 'visual'>[]): boolean => (
  new Set(insights.map((item) => item.visual)).size >= 2
)

const isLockedPlayStatePair = (insights: readonly Pick<InsightProposal, 'id' | 'visual'>[]): boolean => (
  insights.length === 2
  && insights.some((item) => item.id === 'series-win')
  && insights.some((item) => item.id === 'series-play-quality')
)

export const dashboardVisualQaOk = (insights: readonly InsightProposal[], shape?: DatasetShape, rows: readonly AnalysisRowInput[] = []): boolean => {
  if (insights.length < 2 || insights.length > MAX_INSIGHTS) return false
  if (insights.some((item) => isJunkDashboardInsight(item, shape, rows))) return false
  const kinds = new Set(insights.map((item) => item.visual))
  if (insights.length >= 3 && kinds.size < 2) return false
  if (kinds.size >= 2) return true
  return isLockedPlayStatePair(insights)
}

export const perspectiveLabelFor = (input: {
  datasetId?: string
  fixtureId?: string
  rows?: readonly AnalysisRowInput[]
}): string | undefined => {
  const id = input.datasetId || input.fixtureId
  if (id === FOOTBALL_FIXTURE_ID) return footballPerspectiveLabel
  const codes = new Set<string>()
  for (const row of input.rows ?? []) {
    const code = asPerspectiveLabel(row.posteam)
    if (!code) continue
    codes.add(code)
    if (codes.size > 1) return undefined
  }
  return codes.size === 1 ? [...codes][0] : undefined
}

const winLikelihoodInsight = (perspectiveLabel?: string): InsightProposal => ({
  id: 'series-win',
  title: perspectiveMetricTitle('win probability', perspectiveLabel),
  reason: 'Sequential play state — P(win) line.',
  visual: 'series',
  task: SAMPLE_WIN_LIKELIHOOD_TASK,
  questionKind: 'noul',
  classes: [],
  cannedQuery: SAMPLE_WIN_NOUL_QUERY,
  perspectiveLabel,
})

const playQualityInsight = (perspectiveLabel?: string): InsightProposal => ({
  id: 'series-play-quality',
  title: perspectiveMetricTitle('play quality', perspectiveLabel),
  reason: 'Sequential play state — quality over play index.',
  visual: 'series',
  task: SAMPLE_PLAY_QUALITY_TASK,
  questionKind: 'score',
  classes: [...SAMPLE_PLAY_QUALITY_LEVELS],
  cannedQuery: SAMPLE_PLAY_QUALITY_QUERY,
  perspectiveLabel,
})

const pushInsight = (insights: InsightProposal[], insight: InsightProposal | undefined): void => {
  if (!insight || insights.length >= MAX_INSIGHTS) return
  if (insights.some((item) => item.id === insight.id)) return
  insights.push(insight)
}

const tryPushInsight = (
  insights: InsightProposal[],
  insight: InsightProposal,
  shape: DatasetShape,
  rows: readonly AnalysisRowInput[],
): void => {
  if (isJunkDashboardInsight(insight, shape, rows)) return
  pushInsight(insights, insight)
}

const fillDashboardInsights = (
  insights: InsightProposal[],
  options: { shape: DatasetShape; rows: readonly AnalysisRowInput[] },
): InsightProposal[] => {
  const clean = insights.filter((item) => !isJunkDashboardInsight(item, options.shape, options.rows))
  if (options.shape.hasEating && (options.shape.geo || options.shape.placeColumns.length > 0)) {
    tryPushInsight(clean, eatingPlacesInsight(options.shape), options.shape, options.rows)
    tryPushInsight(clean, sightingActivityInsight(), options.shape, options.rows)
  }
  return clean.filter((item) => !isJunkDashboardInsight(item, options.shape, options.rows)).slice(0, MAX_INSIGHTS)
}

export const proposeInsights = (dataset: Pick<DatasetPreview, 'datasetId' | 'columns' | 'previewRows' | 'sourceType'>): InsightProposal[] => {
  const shape = inspectDatasetShape(dataset.columns, dataset.previewRows)
  const insights: InsightProposal[] = []

  const playState = dataset.datasetId === FOOTBALL_FIXTURE_ID || (shape.hasPlayState && shape.sequential)
  if (playState) {
    const perspectiveLabel = perspectiveLabelFor({
      datasetId: dataset.datasetId,
      rows: dataset.previewRows,
    })
    pushInsight(insights, winLikelihoodInsight(perspectiveLabel))
    pushInsight(insights, playQualityInsight(perspectiveLabel))
  }

  const eatingTable = dataset.datasetId === SQUIRREL_FIXTURE_ID || (shape.hasEating && (shape.geo || shape.placeColumns.length > 0))
  if (eatingTable) {
    pushInsight(insights, eatingPlacesInsight(shape))
    pushInsight(insights, sightingActivityInsight())
  }
  if (shape.geo && !insights.some((item) => item.visual === 'places')) {
    pushInsight(insights, geoPlacesInsight())
  }
  if (!insights.some((item) => item.visual === 'places') && shape.placeColumns.length > 0) {
    const column = shape.placeColumns.find((name) => name.toLowerCase() === 'location') ?? shape.placeColumns[0]
    const classes = columnValues(dataset.previewRows, column ?? '')
    if (classes.length >= 2 && !isJunkLocationActivitySplit(classes)) {
      pushInsight(insights, rankedPlacesInsight())
    }
  }

  return fillDashboardInsights(insights, {
    shape,
    rows: dataset.previewRows,
  })
}

export const resolveChartVisual = (input: {
  datasetId?: string
  columns?: readonly string[]
  rows?: readonly AnalysisRowInput[]
  task?: string
  query?: string
  questionKind?: JevQuestionKind
  classes?: readonly string[]
  visual?: ChartVisualKind
  shape?: DatasetShape
}): ChartVisualKind => {
  if (input.visual === 'places' || input.visual === 'series' || input.visual === 'bars') return input.visual
  const text = `${input.task ?? ''} ${input.query ?? ''}`
  const shape = input.shape ?? (input.columns
    ? inspectDatasetShape(
      input.columns.map((name) => ({ name, normalizedName: name, inferredType: 'string' as const })),
      input.rows ?? [],
    )
    : undefined)
  const geoOrPlace = Boolean(shape?.geo || (shape?.placeColumns.length ?? 0) > 0)
  if (input.datasetId === SQUIRREL_FIXTURE_ID || looksLikePlaceEatingTask(text) || (geoOrPlace && (shape?.hasEating || isJunkLocationActivitySplit(input.classes)))) {
    return 'places'
  }
  if (looksLikeWinLikelihood(text)) return 'series'
  if ((looksLikePlayQuality(text) || isGoodBadPlayClassList(input.classes)) && input.questionKind !== 'choice') {
    return 'series'
  }
  if (input.questionKind === 'choice') return 'bars'
  if (input.questionKind === 'noul' || input.questionKind === 'score') return 'series'
  return 'bars'
}

export const chartIsRowStreamed = (visual: ChartVisualKind): boolean => visual !== 'places'

export const defaultInsightFor = (dataset: Pick<DatasetPreview, 'datasetId' | 'columns' | 'previewRows' | 'sourceType'>): InsightProposal | undefined => (
  proposeInsights(dataset)[0]
)

export const queryFromInsight = (insight: InsightProposal): string => (
  formatDraftQueryForEditor({
    query: insight.cannedQuery ?? insight.task,
    questionKind: insight.questionKind,
    classes: insight.classes,
  })
)
