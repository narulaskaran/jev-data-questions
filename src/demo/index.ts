import { observedEatingInsight, proposeInsights, queryFromInsight, type InsightProposal } from '../dataset/insight.js'
import { inferSampleColumns } from '../dataset/sampleColumns.js'
import { getFootballDatasetPreview, loadSquirrelDatasetPreview } from '../dataset/sampleDataset.js'
import { footballFixture, footballFixtureSourceLinks } from '../fixtures/footballTimeline.js'
import type { RowNoun } from '../insights/views.js'
import type { AnalysisResultRow, AnalysisSnapshot } from '../shared/analysis.js'
import { asAnalysisRow, type DatasetPreview } from '../shared/dataset.js'
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
    description: 'Every sighting from the 2018 census: where, when, and what the squirrels were doing.',
    analysisId: 'demo-squirrels',
  },
  {
    id: 'football',
    name: 'Super Bowl play stream',
    description: 'Seattle’s 71 offensive plays: the lead, the yardage, and who gained it.',
    analysisId: 'demo-football',
  },
])

export interface DemoDashboard {
  dataset: DatasetPreview
  /** What one row of the table is, for chart wording. */
  noun: RowNoun
  disclosure: string
}

const SQUIRREL_DISCLOSURE = 'Observed data demo: every chart is counted directly from the 3,023 sightings in the public 2018 Central Park Squirrel Census. Nothing here is an AI prediction.'
const FOOTBALL_DISCLOSURE = 'Observed data demo: every chart is computed directly from Seattle’s 71 offensive plays in the public play-by-play record. Nothing here is a Jev prediction. The linked timeline replay is a separate, rule-based illustration.'
const REPLAY_DISCLOSURE: Record<DemoDatasetId, string> = {
  squirrels: 'Observed data demo: every mark reflects the eating field in the census. These are observed counts, not AI predictions.',
  football: 'Illustrative demo: forecasts use simple rules based on scores and time remaining. These are not Jev predictions or evidence of model accuracy.',
}
const DEMO_CREATED_AT = '2026-10-01T00:00:00.000Z'

/**
 * The football dashboard reads the same fixture rows as the model sample, with
 * plain column names and without model-derived fields (EPA, WPA) or ID columns.
 */
const FOOTBALL_DEMO_COLUMNS = [
  'play', 'quarter', 'down', 'yards_to_go', 'play_type', 'passer', 'receiver', 'rusher',
  'yards_gained', 'air_yards', 'yards_after_catch', 'complete_pass', 'sack',
  'seahawks_score', 'patriots_score', 'seahawks_lead',
] as const

const footballDemoPreview = (): DatasetPreview => {
  const base = getFootballDatasetPreview()
  const rows = [...footballFixture.rows]
    .sort((left, right) => left.play_id - right.play_id)
    .map((row, index) => asAnalysisRow({
      play: index + 1,
      quarter: row.qtr,
      down: row.down,
      yards_to_go: row.ydstogo,
      play_type: row.play_type === 'pass' ? 'Pass' : row.play_type === 'run' ? 'Run' : row.play_type,
      passer: row.passer_player_name,
      receiver: row.receiver_player_name,
      rusher: row.rusher_player_name,
      yards_gained: row.yards_gained,
      air_yards: row.air_yards,
      yards_after_catch: row.yards_after_catch,
      complete_pass: row.play_type === 'pass' ? row.complete_pass === 1 : null,
      sack: row.sack === 1,
      seahawks_score: row.posteam_score,
      patriots_score: row.defteam_score,
      seahawks_lead: row.score_differential,
    }))
  return {
    ...base,
    datasetId: 'demo-football-plays',
    displayName: 'Super Bowl LX: Seattle on offense',
    contentHash: 'fixture-football-demo',
    columns: inferSampleColumns(rows, [...FOOTBALL_DEMO_COLUMNS]),
    acceptedRowCount: rows.length,
    previewRows: rows,
    attribution: {
      disclosure: 'Seattle’s 71 offensive plays from nflverse play-by-play data (CC BY 4.0). Column names are simplified for reading.',
      sourceUrl: footballFixtureSourceLinks.csvFallback,
      licenseUrl: footballFixtureSourceLinks.license,
    },
  }
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
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

const completedSnapshot = (input: {
  analysisId: string
  dataset: DatasetPreview
  insight: InsightProposal
  rows: AnalysisResultRow[]
}): AnalysisSnapshot => ({
  analysisId: input.analysisId,
  fixtureId: input.dataset.datasetId,
  datasetId: input.dataset.datasetId,
  sourceType: input.dataset.sourceType,
  query: queryFromInsight(input.insight),
  status: 'complete',
  createdAt: DEMO_CREATED_AT,
  updatedAt: DEMO_CREATED_AT,
  progress: {
    completedRows: input.rows.length,
    totalRows: input.dataset.acceptedRowCount,
    completedCalls: 0,
    totalCalls: 0,
  },
  questionKind: input.insight.questionKind,
  classes: [...input.insight.classes],
  columns: input.dataset.columns.map((column) => column.name),
  resultRows: input.rows,
})

export const loadDemoDashboard = async (id: string): Promise<DemoDashboard | undefined> => {
  if (id === 'squirrels') {
    return { dataset: await loadSquirrelDatasetPreview(), noun: { singular: 'sighting', plural: 'sightings' }, disclosure: SQUIRREL_DISCLOSURE }
  }
  if (id === 'football') {
    return { dataset: footballDemoPreview(), noun: { singular: 'play', plural: 'plays' }, disclosure: FOOTBALL_DISCLOSURE }
  }
  return undefined
}

/** Disclosure for the saved single-chart replay at `/share/demo-*`. */
export const demoReplayDisclosure = (analysisId: string): string | undefined => (
  analysisId === 'demo-squirrels' ? REPLAY_DISCLOSURE.squirrels : analysisId === 'demo-football' ? REPLAY_DISCLOSURE.football : undefined
)

/** Resolve the stable, shareable demo analysis IDs without storage or network access. */
export const loadDemoSnapshot = async (analysisId: string): Promise<AnalysisSnapshot | undefined> => {
  if (analysisId === 'demo-squirrels') {
    const dataset = await loadSquirrelDatasetPreview()
    return completedSnapshot({
      analysisId,
      dataset,
      insight: observedEatingInsight({ geo: { lat: 'latitude', lng: 'longitude' } }),
      rows: dataset.previewRows.map((input, rowIndex) => ({
        rowIndex,
        input,
        model: 'observed-data',
        questionKind: 'noul',
        value: input.eating === true ? 1 : 0,
      })),
    })
  }
  if (analysisId === 'demo-football') {
    const dataset = getFootballDatasetPreview()
    const insight = proposeInsights(dataset)[0]
    if (!insight) throw new Error('Football demo has no lead insight')
    return completedSnapshot({
      analysisId,
      dataset,
      insight,
      rows: dataset.previewRows.map((input, rowIndex) => ({
        rowIndex,
        input,
        model: 'illustrative-demo',
        questionKind: 'noul',
        value: footballWinLikelihood(input),
      })),
    })
  }
  return undefined
}

/** Small contract guard useful to route callers that accept arbitrary strings. */
export const isDemoAnalysisId = (value: string): value is DemoAnalysisId => (
  value === 'demo-squirrels' || value === 'demo-football'
)

/** The demo queries remain parseable by the same question-kind/chart pipeline as live results. */
export const demoQueryKind = (query: string) => parseJevQueryJson(query)?.type
