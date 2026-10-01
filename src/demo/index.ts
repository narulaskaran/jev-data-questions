import { proposeInsights, queryFromInsight } from '../dataset/insight.js'
import { getFootballDatasetPreview } from '../dataset/sampleDataset.js'
import { getSquirrelDatasetPreview } from '../fixtures/squirrelCensus.js'
import type { DashboardTileModel } from '../components/DashboardTile.js'
import type { AnalysisResultRow, AnalysisSnapshot } from '../shared/analysis.js'
import type { DatasetPreview } from '../shared/dataset.js'
import { parseJevQueryJson } from '../shared/jevQuery.js'

export type DemoDatasetId = 'squirrels' | 'football'
export type DemoAnalysisId = 'demo-squirrels' | 'demo-football'

export interface DemoDatasetListItem {
  id: DemoDatasetId
  name: string
  description: string
  analysisId: DemoAnalysisId
}

/** Curated, offline demo entries shown by the demo landing page. */
export const demoDatasets: readonly DemoDatasetListItem[] = Object.freeze([
  {
    id: 'squirrels',
    name: 'Central Park squirrels',
    description: 'A small census sample mapped by observed eating activity.',
    analysisId: 'demo-squirrels',
  },
  {
    id: 'football',
    name: 'Super Bowl play stream',
    description: 'A real play-by-play fixture with an illustrative score-based read.',
    analysisId: 'demo-football',
  },
])

export interface DemoDashboard {
  dataset: DatasetPreview
  tiles: DashboardTileModel[]
  disclosure: string
}

const SQUIRREL_DISCLOSURE = 'Observed data demo: a 96-row census-shaped example. Every mark reflects the eating field in the fixture. These are observed counts, not AI predictions.'
const FOOTBALL_DISCLOSURE = 'Illustrative demo: forecasts use simple rules based on scores, time remaining, and yardage. These are not Jev predictions or evidence of model accuracy.'
const DEMO_CREATED_AT = '2026-10-01T00:00:00.000Z'

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

const squirrelResultRows = (dataset: DatasetPreview): AnalysisResultRow[] => (
  dataset.previewRows.map((input, rowIndex) => ({
    rowIndex,
    input,
    model: 'observed-data',
    questionKind: 'noul',
    value: input.eating === true ? 1 : 0,
  }))
)

const logistic = (value: number): number => 1 / (1 + Math.exp(-value))

/** Rule-based display value; deliberately excludes the source WPA field. */
const footballWinLikelihood = (input: AnalysisResultRow['input']): number => {
  const scoreDiff = finite(input.score_differential)
    ? input.score_differential
    : finite(input.posteam_score) && finite(input.defteam_score)
      ? input.posteam_score - input.defteam_score
      : 0
  const remaining = finite(input.game_seconds_remaining)
    ? clamp(input.game_seconds_remaining / 3600, 0, 1)
    : 0.5
  const scale = 6 + remaining * 14
  return clamp(logistic(scoreDiff / scale), 0.01, 0.99)
}

const footballPlayQuality = (input: AnalysisResultRow['input']): number => {
  const gained = finite(input.yards_gained) ? input.yards_gained : 0
  const needed = finite(input.ydstogo) ? Math.max(1, input.ydstogo) : 10
  // Center an ordinary short gain near 0.5; reaching the line to gain lifts
  // the score, while negative plays lower it. Keep the score chart bounded.
  const progress = clamp(gained / needed, -1, 1.5)
  const conversionBonus = gained >= needed ? 0.18 : 0
  return clamp(0.5 + progress * 0.22 + conversionBonus, 0.02, 0.98)
}

const footballResultRows = (dataset: DatasetPreview, insightId: string): AnalysisResultRow[] => (
  dataset.previewRows.map((input, rowIndex) => ({
    rowIndex,
    input,
    model: 'illustrative-demo',
    questionKind: insightId === 'series-play-quality' ? 'score' : 'noul',
    value: insightId === 'series-play-quality' ? footballPlayQuality(input) : footballWinLikelihood(input),
  }))
)

const completedSnapshot = (input: {
  analysisId: string
  dataset: DatasetPreview
  query: string
  questionKind: AnalysisSnapshot['questionKind']
  classes: readonly string[]
  rows: AnalysisResultRow[]
}): AnalysisSnapshot => ({
  analysisId: input.analysisId,
  fixtureId: input.dataset.datasetId,
  datasetId: input.dataset.datasetId,
  sourceType: input.dataset.sourceType,
  query: input.query,
  status: 'complete',
  createdAt: DEMO_CREATED_AT,
  updatedAt: DEMO_CREATED_AT,
  progress: {
    completedRows: input.rows.length,
    totalRows: input.dataset.acceptedRowCount,
    completedCalls: 0,
    totalCalls: 0,
  },
  questionKind: input.questionKind,
  classes: [...input.classes],
  columns: input.dataset.columns.map((column) => column.name),
  resultRows: input.rows,
})

const buildDashboard = (id: DemoDatasetId): DemoDashboard => {
  const dataset = id === 'squirrels' ? getSquirrelDatasetPreview() : getFootballDatasetPreview()
  const isSquirrel = id === 'squirrels'
  const disclosure = isSquirrel ? SQUIRREL_DISCLOSURE : FOOTBALL_DISCLOSURE
  const insights = proposeInsights(dataset)
  const tiles: DashboardTileModel[] = insights.map((insight, index) => {
    const rows = isSquirrel
      ? squirrelResultRows(dataset)
      : footballResultRows(dataset, insight.id)
    const questionKind = insight.questionKind
    const snapshot = completedSnapshot({
      analysisId: index === 0
        ? (isSquirrel ? 'demo-squirrels' : 'demo-football')
        : `${isSquirrel ? 'demo-squirrels' : 'demo-football'}-${insight.id}`,
      dataset,
      query: queryFromInsight(insight),
      questionKind,
      classes: insight.classes,
      rows,
    })
    return { insight, snapshot, latencyHint: 'saved' }
  })
  return { dataset, tiles, disclosure }
}

export const getDemoDashboard = (id: string): DemoDashboard | undefined => {
  if (id !== 'squirrels' && id !== 'football') return undefined
  return buildDashboard(id)
}

/** Resolve the stable, shareable demo analysis IDs without storage or network access. */
export const getDemoSnapshot = (analysisId: string): AnalysisSnapshot | undefined => {
  if (analysisId !== 'demo-squirrels' && analysisId !== 'demo-football') return undefined
  const id: DemoDatasetId = analysisId === 'demo-squirrels' ? 'squirrels' : 'football'
  const lead = buildDashboard(id).tiles[0]?.snapshot
  if (!lead) throw new Error(`Demo dashboard has no lead result: ${id}`)
  return lead
}

/** Small contract guard useful to route callers that accept arbitrary strings. */
export const isDemoAnalysisId = (value: string): value is DemoAnalysisId => (
  value === 'demo-squirrels' || value === 'demo-football'
)

/** The demo queries remain parseable by the same question-kind/chart pipeline as live results. */
export const demoQueryKind = (query: string) => parseJevQueryJson(query)?.type
