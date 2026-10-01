import { describe, expect, it } from 'vitest'
import { FOOTBALL_FIXTURE_ID, footballPerspectiveLabel } from '../fixtures/footballTimeline'
import { SQUIRREL_EATING_NOUL_QUERY, SQUIRREL_EATING_TASK, SQUIRREL_FIXTURE_ID, getSquirrelDatasetPreview } from '../fixtures/squirrelCensus'
import { getSampleDatasetPreview } from './sampleDataset'
import { inspectDatasetShape, schemaColumnLabel, schemaStripParts } from './shape'
import {
  chartIsRowStreamed,
  defaultInsightFor,
  hasNamedHeuristicCuts,
  isBannedRawColumnClassInsight,
  isJunkLocationActivitySplit,
  looksLikePlaceEatingTask,
  observedEatingInsight,
  perspectiveLabelFor,
  proposeInsights,
  resolveChartVisual,
  resolveDashboardInsights,
  sanitizeLlmInsightProposals,
  dashboardVisualQaOk,
  hasDiverseChartTypes,
  insightEyebrow,
  isJunkDashboardInsight,
} from './insight'
import { SAMPLE_PLAY_QUALITY_LEVELS, SAMPLE_PLAY_QUALITY_QUERY, SAMPLE_PLAY_QUALITY_TASK, SAMPLE_WIN_LIKELIHOOD_TASK, SAMPLE_WIN_NOUL_QUERY } from '../shared/questionKind'

describe('shape inspection', () => {
  it('reads geo, place, eating, and cardinality from the squirrel fixture', () => {
    const dataset = getSquirrelDatasetPreview()
    const shape = inspectDatasetShape(dataset.columns, dataset.previewRows)
    expect(shape.geo).toEqual({ lat: 'latitude', lng: 'longitude' })
    expect(shape.placeColumns).toEqual(expect.arrayContaining(['location', 'hectare']))
    expect(shape.hasEating).toBe(true)
    expect(shape.hasPlayState).toBe(false)
    expect(shape.columns.find((column) => column.name === 'location')?.cardinality).toBe(2)
    expect(schemaStripParts(shape).join(' · ')).toMatch(/Places/)
    expect(schemaStripParts(shape).join(' · ')).not.toMatch(/\bgeo\b/)
    expect(schemaColumnLabel(shape.columns.find((column) => column.name === 'location')!).toLowerCase()).toMatch(/places/)
  })

  it('treats an activity column with eating values as an eating table', () => {
    const shape = inspectDatasetShape(
      [
        { name: 'x', normalizedName: 'x', inferredType: 'number' },
        { name: 'y', normalizedName: 'y', inferredType: 'number' },
        { name: 'location', normalizedName: 'location', inferredType: 'string' },
        { name: 'activity', normalizedName: 'activity', inferredType: 'string' },
      ],
      [
        { x: -73.97, y: 40.78, location: 'Ground Plane', activity: 'eating' },
        { x: -73.96, y: 40.79, location: 'Above Ground', activity: 'running' },
      ],
    )
    expect(shape.geo).toEqual({ lat: 'y', lng: 'x' })
    expect(shape.hasEating).toBe(true)
    expect(shape.placeColumns).toEqual(expect.arrayContaining(['location']))
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
  it('proposes no model run for squirrel eating places: the table already answers it', () => {
    const dataset = getSquirrelDatasetPreview()
    // Where rows are and how often a column is true come from the story
    // dashboard, so nothing is queued for a paid per-row run.
    expect(proposeInsights(dataset)).toEqual([])
    expect(hasNamedHeuristicCuts(proposeInsights(dataset))).toBe(false)
    // The saved replay and older shared runs still draw the observed map.
    const saved = observedEatingInsight({ geo: { lat: 'latitude', lng: 'longitude' } })
    expect(saved).toEqual(expect.objectContaining({
      id: 'places-eating',
      title: 'Where are they eating?',
      visual: 'places',
      task: SQUIRREL_EATING_TASK,
      questionKind: 'noul',
      cannedQuery: SQUIRREL_EATING_NOUL_QUERY,
    }))
    expect(insightEyebrow(saved)).toBe('Eating')
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
      title: 'Will SEA win?',
      visual: 'series',
      task: SAMPLE_WIN_LIKELIHOOD_TASK,
      cannedQuery: SAMPLE_WIN_NOUL_QUERY,
      perspectiveLabel: footballPerspectiveLabel,
    }))
    expect(insight?.title).not.toBe('Win probability')
    expect(insight?.title).not.toBe('Win likelihood')
    expect(footballPerspectiveLabel).toBe('SEA')
    expect(resolveChartVisual({
      datasetId: FOOTBALL_FIXTURE_ID,
      task: SAMPLE_WIN_LIKELIHOOD_TASK,
      questionKind: 'noul',
    })).toBe('series')
    expect(chartIsRowStreamed('series')).toBe(true)
    const insights = proposeInsights(dataset)
    expect(insights.map((item) => item.id)).toEqual(['series-win', 'series-play-quality'])
    expect(insights.find((item) => item.id === 'series-win')).toBe(insights[0])
    expect(insights.find((item) => item.id === 'series-play-quality')).toBe(insights[1])
    expect(dashboardVisualQaOk(insights)).toBe(true)
    expect(insights.every((item) => item.visual === 'series')).toBe(true)
    expect(insights.some((item) => item.id === 'bars-success')).toBe(false)
    expect(insights.some((item) => item.visual === 'places')).toBe(false)
    expect(insights.some((item) => /classify sea/i.test(item.title))).toBe(false)
    expect(insights.find((item) => item.id === 'series-play-quality')).toEqual(expect.objectContaining({
      title: "How good were SEA's plays?",
      visual: 'series',
      task: SAMPLE_PLAY_QUALITY_TASK,
      questionKind: 'score',
      cannedQuery: SAMPLE_PLAY_QUALITY_QUERY,
      classes: [...SAMPLE_PLAY_QUALITY_LEVELS],
      perspectiveLabel: footballPerspectiveLabel,
    }))
    expect(insights.find((item) => item.id === 'series-play-quality')?.title).not.toBe('Play quality')
    expect(resolveChartVisual({
      datasetId: FOOTBALL_FIXTURE_ID,
      task: 'Evaluate the quality of the plays.',
      questionKind: 'score',
      classes: [...SAMPLE_PLAY_QUALITY_LEVELS],
    })).toBe('series')
    expect(resolveChartVisual({
      datasetId: FOOTBALL_FIXTURE_ID,
      task: 'Evaluate the quality of the plays.',
    })).toBe('series')
  })

  it('does not replay fruit/vehicle labels as class-bar tiles', () => {
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
    expect(insights.every((item) => item.classes.join(' ').toLowerCase() !== 'fruit vehicle')).toBe(true)
    expect(insights.every((item) => !/^classify by /i.test(item.title))).toBe(true)
    expect(insights.every((item) => !/labels in this table/i.test(item.reason))).toBe(true)
    expect(insights.every((item) => !isJunkDashboardInsight(item))).toBe(true)
    expect(insights.every((item) => !/location vs activity|not class bars/i.test(`${item.title} ${item.reason}`))).toBe(true)
    expect(insights.every((item) => !/class bars/i.test(item.reason))).toBe(true)
  })

  it('omits junk filler tiles when a BYOD preview has no named cut', () => {
    const insights = proposeInsights({
      datasetId: 'tickets',
      sourceType: 'upload',
      columns: [
        { name: 'message', normalizedName: 'message', inferredType: 'string' },
        { name: 'tier', normalizedName: 'tier', inferredType: 'string' },
      ],
      previewRows: [{ message: 'hello', tier: 'gold' }],
    })
    expect(insights.every((item) => !isJunkDashboardInsight(item))).toBe(true)
    expect(insights.every((item) => !isJunkLocationActivitySplit(item.classes))).toBe(true)
    expect(insights.every((item) => !/hello|world/i.test(item.title))).toBe(true)
    expect(insights.every((item) => !/^classify by /i.test(item.title))).toBe(true)
    expect(insights.every((item) => item.classes.join(' ').toLowerCase() !== 'gold silver')).toBe(true)
    expect(insights.every((item) => !/^(notable rows|rate each row|yes or no)$/i.test(item.title))).toBe(true)
  })

  it('proposes no model run for a messy BYOD table with geo, location, activity, and eating', () => {
    const insights = proposeInsights({
      datasetId: 'dataset-messy-squirrel',
      sourceType: 'upload',
      columns: [
        { name: 'x', normalizedName: 'x', inferredType: 'number' },
        { name: 'y', normalizedName: 'y', inferredType: 'number' },
        { name: 'location', normalizedName: 'location', inferredType: 'string' },
        { name: 'activity', normalizedName: 'activity', inferredType: 'string' },
        { name: 'eating', normalizedName: 'eating', inferredType: 'boolean' },
        { name: 'primary_fur_color', normalizedName: 'primary_fur_color', inferredType: 'string' },
      ],
      previewRows: [
        { x: -73.97, y: 40.78, location: 'Ground Plane', activity: 'eating', eating: true, primary_fur_color: 'Gray' },
        { x: -73.96, y: 40.79, location: 'Above Ground', activity: 'running', eating: false, primary_fur_color: 'Cinnamon' },
        { x: -73.975, y: 40.782, location: 'Ground Plane', activity: 'foraging', eating: true, primary_fur_color: 'Black' },
      ],
    })
    expect(insights).toEqual([])
  })

  it('does not propose Location vs Activity bars when a type column holds those meta labels', () => {
    const insights = proposeInsights({
      datasetId: 'dataset-meta-split',
      sourceType: 'upload',
      columns: [
        { name: 'type', normalizedName: 'type', inferredType: 'string' },
        { name: 'name', normalizedName: 'name', inferredType: 'string' },
      ],
      previewRows: [
        { type: 'Location', name: 'park' },
        { type: 'Activity', name: 'eating' },
      ],
    })
    expect(insights.every((item) => !isJunkLocationActivitySplit(item.classes))).toBe(true)
    expect(insights.every((item) => !isJunkDashboardInsight(item))).toBe(true)
    expect(insights.every((item) => item.classes.join(' ').toLowerCase() !== 'location activity')).toBe(true)
    expect(insights[0]?.classes ?? []).not.toEqual(['Location', 'Activity'])
    expect(insights.every((item) => !/^classify by /i.test(item.title))).toBe(true)
  })

  it('bans AM/PM and raw-column class bars', () => {
    const dataset = getSquirrelDatasetPreview()
    expect(isBannedRawColumnClassInsight({
      title: 'Classify by shift',
      reason: 'Labels in this table.',
      visual: 'bars',
      questionKind: 'choice',
      classes: ['AM', 'PM'],
    })).toBe(true)
    expect(isBannedRawColumnClassInsight({
      title: 'Where they sit',
      reason: 'A cut.',
      visual: 'bars',
      questionKind: 'choice',
      classes: ['Ground Plane', 'Above Ground'],
    }, inspectDatasetShape(dataset.columns, dataset.previewRows), dataset.previewRows)).toBe(true)
  })

  it('fails QA if every dashboard tile is the same viz kind', () => {
    expect(hasDiverseChartTypes([{ visual: 'series' }, { visual: 'series' }])).toBe(false)
    expect(hasDiverseChartTypes([{ visual: 'series' }, { visual: 'bars' }])).toBe(true)
    expect(hasDiverseChartTypes([{ visual: 'places' }, { visual: 'series' }])).toBe(true)
    expect(isJunkDashboardInsight({
      title: 'Play success',
      reason: 'A call for each play.',
      visual: 'bars',
      questionKind: 'choice',
      classes: ['Converted', 'Did not'],
    })).toBe(true)
    expect(dashboardVisualQaOk(proposeInsights(getSampleDatasetPreview()))).toBe(true)
    expect(hasDiverseChartTypes(proposeInsights(getSampleDatasetPreview()))).toBe(false)
  })
})

describe('LLM insight proposals', () => {
  const tickets = {
    datasetId: 'tickets',
    sourceType: 'upload' as const,
    columns: [
      { name: 'message', normalizedName: 'message', inferredType: 'string' as const },
      { name: 'tier', normalizedName: 'tier', inferredType: 'string' as const },
    ],
    previewRows: [
      { message: 'server down', tier: 'gold' },
      { message: 'thanks', tier: 'silver' },
    ],
  }

  it('packs valid LLM insights and lets the viz pack pick the chart', () => {
    const insights = sanitizeLlmInsightProposals({
      insights: [
        {
          title: 'Urgent tickets',
          question: 'Is this ticket urgent given the message and tier?',
          visual: 'places',
          perspective: '',
          preparation: 'Read message and tier.',
          reason: 'Support load.',
          questionKind: 'noul',
        },
        {
          title: 'Frustrated customers',
          question: 'Is this ticket frustrated given the message?',
          visual: 'bars',
          reason: 'Customer heat.',
          questionKind: 'noul',
        },
      ],
    }, tickets)
    expect(insights.length).toBeGreaterThanOrEqual(2)
    expect(insights.length).toBeLessThanOrEqual(4)
    expect(insights.every((item) => item.question && item.title && item.reason)).toBe(true)
    expect(insights.every((item) => item.visual !== 'places')).toBe(true)
    expect(insights.some((item) => item.visual === 'series')).toBe(true)
    expect(insights.every((item) => !isJunkDashboardInsight(item))).toBe(true)
  })

  it('drops raw-column junk such as AM/PM, shift, and labels-in-table', () => {
    const insights = sanitizeLlmInsightProposals([
      { title: 'Classify by shift', question: 'Is this AM or PM?', visual: 'bars', reason: 'Labels in this table.', classes: ['AM', 'PM'] },
      { title: 'AM/PM', question: 'Classify each row by shift.', visual: 'bars', reason: 'Shift labels.', classes: ['AM', 'PM'] },
      { title: 'Play success', question: 'Did the play convert?', visual: 'bars', reason: 'A call for each play.', classes: ['Converted', 'Did not'] },
      { title: 'Urgent tickets', question: 'Is this ticket urgent given the message?', visual: 'series', reason: 'A real cut.', questionKind: 'noul' },
    ], tickets)
    expect(insights.every((item) => !/classify by shift|am\s*\/\s*pm|labels in this table/i.test(`${item.title} ${item.reason}`))).toBe(true)
    expect(insights.every((item) => !isBannedRawColumnClassInsight(item))).toBe(true)
    expect(insights.every((item) => !isJunkDashboardInsight(item))).toBe(true)
    expect(insights.map((item) => item.title)).toEqual(['Urgent tickets'])
  })

  it('falls back to empty when every proposal is junk or missing', () => {
    expect(sanitizeLlmInsightProposals({ insights: [{ title: 'Nope' }] }, tickets)).toEqual([])
    expect(resolveDashboardInsights(tickets, { insights: [] }).insights).toEqual([])
    expect(resolveDashboardInsights(tickets, { insights: [] }).source).toBe('empty')
    expect(resolveDashboardInsights(tickets).source).toBe('empty')
  })

  it('keeps Seahawks and squirrel heuristics when those CSVs arrive as BYOD', () => {
    const seahawks = {
      ...getSampleDatasetPreview(),
      datasetId: 'dataset-byod-sea',
      sourceType: 'upload' as const,
    }
    const squirrel = {
      ...getSquirrelDatasetPreview(),
      datasetId: 'dataset-byod-squirrel',
      sourceType: 'upload' as const,
    }
    const sea = resolveDashboardInsights(seahawks, {
      insights: [{ title: 'Classify by shift', question: 'AM or PM?', visual: 'bars', reason: 'Labels in this table.', classes: ['AM', 'PM'] }],
    })
    expect(hasNamedHeuristicCuts(sea.insights)).toBe(true)
    expect(sea.source).toBe('heuristic')
    expect(sea.insights.map((item) => item.id)).toEqual(['series-win', 'series-play-quality'])
    const places = resolveDashboardInsights(squirrel, { insights: [] })
    expect(places.insights).toEqual([])
    expect(places.source).toBe('empty')
  })

  it('drops proposals that only restate a column the table already has', () => {
    const squirrel = {
      ...getSquirrelDatasetPreview(),
      datasetId: 'dataset-byod-squirrel',
      sourceType: 'upload' as const,
    }
    const resolved = resolveDashboardInsights(squirrel, {
      insights: [
        // Asks for a value the `eating` column records for every row.
        { title: 'Eating squirrels', question: 'Is this squirrel eating?', reason: 'Diet.', questionKind: 'noul' },
        // Classes that name columns instead of values (issue #56).
        { title: 'Eating spots', question: 'Identify common locations where squirrels are spotted eating.', reason: 'Places.', questionKind: 'choice', classes: ['Location', 'Activity'] },
        // A judgment no column holds.
        { title: 'Used to people', question: 'Is this squirrel comfortable around people, given its behavior?', reason: 'Habituation.', questionKind: 'noul' },
      ],
    })
    expect(resolved.insights.map((item) => item.title)).toEqual(['Used to people'])
    expect(resolved.insights[0]?.visual).toBe('series')
    expect(resolved.source).toBe('llm')
  })
})

describe('team perspective labels', () => {
  it('reads SEA from Seahawks fixture metadata, not a hardcoded home team', () => {
    const dataset = getSampleDatasetPreview()
    expect(perspectiveLabelFor({ datasetId: dataset.datasetId, rows: dataset.previewRows })).toBe(footballPerspectiveLabel)
    expect(footballPerspectiveLabel).toBe('SEA')
    expect(footballPerspectiveLabel).not.toBe('NE')
    expect(perspectiveLabelFor({ datasetId: FOOTBALL_FIXTURE_ID, rows: [{ play_id: 1 }] })).toBe('SEA')
  })

  it('labels a sequential play-state table from a unique posteam and skips mixed teams', () => {
    expect(perspectiveLabelFor({
      datasetId: 'upload-plays',
      rows: [{ play_id: 1, posteam: 'SEA' }, { play_id: 2, posteam: 'SEA' }],
    })).toBe('SEA')
    expect(perspectiveLabelFor({
      datasetId: 'upload-plays',
      rows: [{ play_id: 1, posteam: 'SEA' }, { play_id: 2, posteam: 'NE' }],
    })).toBeUndefined()
    expect(perspectiveLabelFor({ datasetId: SQUIRREL_FIXTURE_ID, rows: [{ location: 'Ground Plane' }] })).toBeUndefined()
  })
})
