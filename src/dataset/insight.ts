import type { DatasetPreview } from '../shared/dataset'
import { FOOTBALL_FIXTURE_ID, footballPerspectiveLabel } from '../fixtures/footballTimeline'
import { SQUIRREL_FIXTURE_ID } from '../fixtures/squirrelCensus'
import { asPerspectiveLabel, perspectiveMetricTitle } from '../teamMetadata'
import {
  SAMPLE_PLAY_QUALITY_LEVELS,
  SAMPLE_PLAY_QUALITY_QUERY,
  SAMPLE_PLAY_QUALITY_TASK,
  SAMPLE_WIN_LIKELIHOOD_TASK,
  SAMPLE_WIN_NOUL_QUERY,
  SQUIRREL_EATING_NOUL_QUERY,
  SQUIRREL_EATING_TASK,
  classesFromLabelColumns,
  isGoodBadPlayClassList,
  isJunkLocationActivitySplit,
  looksLikePlaceEatingTask,
  looksLikePlayQuality,
  looksLikeWinLikelihood,
  type ChartVisualKind,
  type JevQuestionKind,
} from '../shared/questionKind'
import { inspectDatasetShape, type ColumnShape, type DatasetShape } from './shape'
import type { AnalysisRowInput } from './csvTypes'

export { isJunkLocationActivitySplit, looksLikePlaceEatingTask } from '../shared/questionKind'

export const MAX_INSIGHTS = 3

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

const placeValues = (shape: DatasetShape, rows: readonly AnalysisRowInput[]): string[] => {
  const column = shape.placeColumns.find((name) => name.toLowerCase() === 'location') ?? shape.placeColumns[0]
  if (!column) return []
  return columnValues(rows, column)
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
  title: 'Places',
  reason: 'Map of these rows.',
  visual: 'places',
  task: 'Where are these rows?',
  questionKind: 'noul',
  classes: [],
  cannedQuery: 'Does this row represent an active sighting at this place?',
})

const rankedPlacesInsight = (): InsightProposal => ({
  id: 'places-ranked',
  title: 'Places',
  reason: 'Ranked locations.',
  visual: 'places',
  task: 'Where do these rows happen?',
  questionKind: 'noul',
  classes: [],
  cannedQuery: 'Does this row happen at a notable place?',
})

const classifyInsight = (id: string, title: string, classes: string[]): InsightProposal => ({
  id,
  title,
  reason: 'Labels in this table.',
  visual: 'bars',
  task: `Classify each row as ${classes.join(' or ')} using the visible columns.`,
  questionKind: 'choice',
  classes,
  cannedQuery: `Classify each row as ${classes.join(' or ')} using the visible columns.`,
})

const notableInsight = (): InsightProposal => ({
  id: 'noul-notable',
  title: 'Notable rows',
  reason: 'Yes or no for each row.',
  visual: 'series',
  task: 'Is this row notable given the visible columns?',
  questionKind: 'noul',
  classes: [],
  cannedQuery: 'Is this row notable given the visible columns?',
})

const rateInsight = (): InsightProposal => ({
  id: 'score-rate',
  title: 'Rate each row',
  reason: 'A score for each row.',
  visual: 'series',
  task: 'Rate this row given the visible columns.',
  questionKind: 'score',
  classes: [...SAMPLE_PLAY_QUALITY_LEVELS],
  cannedQuery: 'Rate this row given the visible columns.',
})

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

const TEXTISH_COLUMN_RE = /^(message|text|comment|comments|description|notes?|body|content|raw|sentence|utterance)$/i
const META_PLACE_ACTIVITY_RE = /^(location|locations|activity|activities|place|places)$/i
const BOOLEANISH_CLASSES = new Set(['true', 'false', 'yes', 'no', 'y', 'n', '0', '1'])

const prettyColumnName = (name: string): string => name.replace(/[_-]+/g, ' ').trim()

const isBooleanishClasses = (classes: readonly string[]): boolean => (
  classes.length === 2 && classes.every((name) => BOOLEANISH_CLASSES.has(name.trim().toLowerCase()))
)

const looksLikeFreeTextColumn = (column: ColumnShape, classes: readonly string[], rowCount: number): boolean => {
  if (TEXTISH_COLUMN_RE.test(column.name) || TEXTISH_COLUMN_RE.test(column.normalizedName)) return true
  if (classes.some((name) => name.length > 40 || name.trim().split(/\s+/).length > 6)) return true
  return rowCount > 8 && column.uniqueRatio > 0.5
}

const classifyFromColumn = (
  column: ColumnShape,
  rows: readonly AnalysisRowInput[],
  shape: DatasetShape,
): InsightProposal | undefined => {
  if (column.role !== 'categorical') return undefined
  if (column.cardinality < 2 || column.cardinality > 8) return undefined
  if (META_PLACE_ACTIVITY_RE.test(column.name) || META_PLACE_ACTIVITY_RE.test(column.normalizedName)) {
    if (shape.geo || shape.hasEating || shape.placeColumns.length > 0) return undefined
  }
  const classes = columnValues(rows, column.name)
  if (classes.length < 2 || isJunkLocationActivitySplit(classes) || isBooleanishClasses(classes)) return undefined
  if (looksLikeFreeTextColumn(column, classes, shape.rowCount)) return undefined
  const key = column.normalizedName || column.name
  return classifyInsight(`bars-${key}`, `Classify by ${prettyColumnName(column.name)}`, classes)
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

  if (dataset.datasetId === SQUIRREL_FIXTURE_ID || (shape.hasEating && (shape.geo || shape.placeColumns.length > 0))) {
    pushInsight(insights, eatingPlacesInsight(shape))
  }
  if (shape.geo) {
    pushInsight(insights, geoPlacesInsight())
  }
  if (!insights.some((item) => item.visual === 'places') && shape.placeColumns.length > 0) {
    const classes = placeValues(shape, dataset.previewRows)
    if (classes.length >= 2 && !isJunkLocationActivitySplit(classes)) {
      pushInsight(insights, rankedPlacesInsight())
    }
  }

  const labels = classesFromLabelColumns(
    dataset.columns.map((column) => column.name),
    dataset.previewRows,
  )
  if (labels.length >= 2 && !isJunkLocationActivitySplit(labels) && !isBooleanishClasses(labels)) {
    pushInsight(insights, classifyInsight('bars-labels', `Classify ${labels.slice(0, 2).join(' / ')}`, labels))
  }

  if (!playState) {
    for (const column of shape.columns) {
      if (insights.length >= MAX_INSIGHTS) break
      const insight = classifyFromColumn(column, dataset.previewRows, shape)
      if (!insight) continue
      if (insights.some((item) => classesEqual(item.classes, insight.classes))) continue
      pushInsight(insights, insight)
    }
  }

  const clean = insights.filter((item) => !isJunkLocationActivitySplit(item.classes))
  if (clean.length < 2) pushInsight(clean, notableInsight())
  if (clean.length < 2) pushInsight(clean, rateInsight())

  return clean.slice(0, MAX_INSIGHTS)
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
