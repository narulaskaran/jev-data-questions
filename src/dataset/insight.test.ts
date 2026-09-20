import { describe, expect, it } from 'vitest'
import { FOOTBALL_FIXTURE_ID } from '../fixtures/footballTimeline'
import { SQUIRREL_EATING_NOUL_QUERY, SQUIRREL_EATING_TASK, SQUIRREL_FIXTURE_ID, getSquirrelDatasetPreview } from '../fixtures/squirrelCensus'
import { getSampleDatasetPreview } from './sampleDataset'
import { inspectDatasetShape, schemaColumnLabel, schemaStripParts } from './shape'
import {
  chartIsRowStreamed,
  defaultInsightFor,
  isJunkLocationActivitySplit,
  looksLikePlaceEatingTask,
  proposeInsights,
  resolveChartVisual,
} from './insight'
import { SAMPLE_WIN_LIKELIHOOD_TASK, SAMPLE_WIN_NOUL_QUERY } from '../shared/questionKind'

describe('shape inspection', () => {
  it('reads geo, place, eating, and cardinality from the squirrel fixture', () => {
    const dataset = getSquirrelDatasetPreview()
    const shape = inspectDatasetShape(dataset.columns, dataset.previewRows)
    expect(shape.geo).toEqual({ lat: 'y', lng: 'x' })
    expect(shape.placeColumns).toEqual(expect.arrayContaining(['location', 'hectare']))
    expect(shape.hasEating).toBe(true)
    expect(shape.hasPlayState).toBe(false)
    expect(shape.columns.find((column) => column.name === 'location')?.cardinality).toBe(2)
    expect(schemaStripParts(shape).join(' · ')).toMatch(/geo/)
    expect(schemaColumnLabel(shape.columns.find((column) => column.name === 'location')!)).toMatch(/location 2/)
  })

  it('reads sequential play state from the Seahawks fixture and does not invent geo', () => {
    const dataset = getSampleDatasetPreview()
    const shape = inspectDatasetShape(dataset.columns, dataset.previewRows)
    expect(shape.hasPlayState).toBe(true)
    expect(shape.sequential).toBe(true)
    expect(shape.geo).toBeUndefined()
    expect(shape.hasEating).toBe(false)
  })
})

describe('shape → viz routing', () => {
  it('routes squirrel eating places to a map, never Location vs Activity Choice bars', () => {
    const dataset = getSquirrelDatasetPreview()
    const insights = proposeInsights(dataset)
    expect(insights[0]).toEqual(expect.objectContaining({
      id: 'places-eating',
      title: 'Where they eat',
      visual: 'places',
      task: SQUIRREL_EATING_TASK,
      questionKind: 'noul',
      cannedQuery: SQUIRREL_EATING_NOUL_QUERY,
    }))
    expect(insights.some((item) => item.visual === 'bars')).toBe(false)
    expect(insights.flatMap((item) => item.classes)).not.toEqual(expect.arrayContaining(['Location', 'Activity']))
    expect(resolveChartVisual({
      datasetId: SQUIRREL_FIXTURE_ID,
      task: 'identify common locations where squirrels are spotted eating',
      questionKind: 'choice',
      classes: ['Location', 'Activity'],
      columns: dataset.columns.map((column) => column.name),
      rows: dataset.previewRows,
    })).toBe('places')
    expect(resolveChartVisual({ visual: 'places', questionKind: 'noul' })).toBe('places')
    expect(isJunkLocationActivitySplit(['Location', 'Activity'])).toBe(true)
    expect(isJunkLocationActivitySplit(['Ground Plane', 'Above Ground'])).toBe(false)
    expect(looksLikePlaceEatingTask('Identify common locations where squirrels are spotted eating.')).toBe(true)
    expect(chartIsRowStreamed('places')).toBe(false)
  })

  it('routes Seahawks win-likelihood to a P(win) series', () => {
    const dataset = getSampleDatasetPreview()
    const insight = defaultInsightFor(dataset)
    expect(insight).toEqual(expect.objectContaining({
      id: 'series-win',
      title: 'Win likelihood',
      visual: 'series',
      task: SAMPLE_WIN_LIKELIHOOD_TASK,
      cannedQuery: SAMPLE_WIN_NOUL_QUERY,
    }))
    expect(resolveChartVisual({
      datasetId: FOOTBALL_FIXTURE_ID,
      task: SAMPLE_WIN_LIKELIHOOD_TASK,
      questionKind: 'noul',
    })).toBe('series')
    expect(chartIsRowStreamed('series')).toBe(true)
    expect(proposeInsights(dataset).some((item) => item.visual === 'places')).toBe(false)
  })

  it('proposes label-class bars for a fruit/vehicle table without a place split', () => {
    const insights = proposeInsights({
      datasetId: 'classify',
      sourceType: 'upload',
      columns: [
        { name: 'id', normalizedName: 'id', inferredType: 'number' },
        { name: 'text', normalizedName: 'text', inferredType: 'string' },
        { name: 'label_hint', normalizedName: 'label_hint', inferredType: 'string' },
      ],
      previewRows: [
        { id: 1, text: 'apple', label_hint: 'fruit' },
        { id: 2, text: 'truck', label_hint: 'vehicle' },
      ],
    })
    expect(insights[0]).toEqual(expect.objectContaining({
      visual: 'bars',
      questionKind: 'choice',
      classes: ['fruit', 'vehicle'],
    }))
    expect(insights[0]?.classes).not.toEqual(['Location', 'Activity'])
  })
})
