import type { DatasetPreview } from '../shared/dataset'
import { FOOTBALL_FIXTURE_ID } from '../fixtures/footballTimeline'
import { SQUIRREL_FIXTURE_ID } from '../fixtures/squirrelCensus'
import {
  SAMPLE_WIN_LIKELIHOOD_TASK,
  SAMPLE_WIN_NOUL_QUERY,
  SQUIRREL_EATING_NOUL_QUERY,
  SQUIRREL_EATING_TASK,
  classesFromLabelColumns,
  isJunkLocationActivitySplit,
  looksLikePlaceEatingTask,
  looksLikeWinLikelihood,
  type ChartVisualKind,
  type JevQuestionKind,
} from '../shared/questionKind'
import { inspectDatasetShape, type DatasetShape } from './shape'
import type { AnalysisRowInput } from './csvTypes'

export { isJunkLocationActivitySplit, looksLikePlaceEatingTask } from '../shared/questionKind'

export interface InsightProposal {
  id: string
  title: string
  reason: string
  visual: ChartVisualKind
  task: string
  questionKind: JevQuestionKind
  classes: string[]
  cannedQuery?: string
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

const placeValues = (shape: DatasetShape, rows: readonly AnalysisRowInput[]): string[] => {
  const column = shape.placeColumns.find((name) => name.toLowerCase() === 'location') ?? shape.placeColumns[0]
  if (!column) return []
  return uniqueClasses(rows.map((row) => {
    const value = row[column]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  }))
}

const eatingPlacesInsight = (shape: DatasetShape): InsightProposal => ({
  id: 'places-eating',
  title: 'Where they eat',
  reason: shape.geo ? 'Lat/lng + eating — map of places, not class bars.' : 'Location values among eating sightings — ranked places, not Location vs Activity.',
  visual: 'places',
  task: SQUIRREL_EATING_TASK,
  questionKind: 'noul',
  classes: [],
  cannedQuery: SQUIRREL_EATING_NOUL_QUERY,
})

const winLikelihoodInsight = (): InsightProposal => ({
  id: 'series-win',
  title: 'Win likelihood',
  reason: 'Sequential play state — P(win) line.',
  visual: 'series',
  task: SAMPLE_WIN_LIKELIHOOD_TASK,
  questionKind: 'noul',
  classes: [],
  cannedQuery: SAMPLE_WIN_NOUL_QUERY,
})

export const proposeInsights = (dataset: Pick<DatasetPreview, 'datasetId' | 'columns' | 'previewRows' | 'sourceType'>): InsightProposal[] => {
  const shape = inspectDatasetShape(dataset.columns, dataset.previewRows)
  const insights: InsightProposal[] = []

  if (dataset.datasetId === FOOTBALL_FIXTURE_ID || (shape.hasPlayState && shape.sequential)) {
    insights.push(winLikelihoodInsight())
  }

  if (dataset.datasetId === SQUIRREL_FIXTURE_ID || (shape.hasEating && (shape.geo || shape.placeColumns.length > 0))) {
    insights.push(eatingPlacesInsight(shape))
  } else if (shape.geo && insights.length < 2) {
    insights.push({
      id: 'places-geo',
      title: 'Places',
      reason: 'Latitude and longitude — map of rows.',
      visual: 'places',
      task: 'Where are these rows?',
      questionKind: 'noul',
      classes: [],
      cannedQuery: 'Does this row represent an active sighting at this place?',
    })
  }

  if (insights.length < 2) {
    const labels = classesFromLabelColumns(
      dataset.columns.map((column) => column.name),
      dataset.previewRows,
    )
    if (labels.length >= 2 && !isJunkLocationActivitySplit(labels)) {
      insights.push({
        id: 'bars-labels',
        title: `Classify ${labels.slice(0, 2).join(' / ')}`,
        reason: 'Low-cardinality labels — class bars.',
        visual: 'bars',
        task: `Classify each row as ${labels.join(' or ')} using the visible columns.`,
        questionKind: 'choice',
        classes: labels,
      })
    }
  }

  if (insights.length < 2 && shape.placeColumns.length > 0 && !insights.some((item) => item.visual === 'places')) {
    const classes = placeValues(shape, dataset.previewRows)
    if (classes.length >= 2 && !isJunkLocationActivitySplit(classes)) {
      insights.push({
        id: 'places-ranked',
        title: 'Places',
        reason: 'Location column — ranked places.',
        visual: 'places',
        task: 'Where do these rows happen?',
        questionKind: 'noul',
        classes: [],
      })
    }
  }

  return insights.slice(0, 2)
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
  if (input.questionKind === 'choice') return 'bars'
  if (input.questionKind === 'noul' || input.questionKind === 'score') return 'series'
  return 'bars'
}

export const chartIsRowStreamed = (visual: ChartVisualKind): boolean => visual !== 'places'

export const defaultInsightFor = (dataset: Pick<DatasetPreview, 'datasetId' | 'columns' | 'previewRows' | 'sourceType'>): InsightProposal | undefined => (
  proposeInsights(dataset)[0]
)
