import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoDatasets, demoReplayDisclosure, getDemoDashboard, getDemoSnapshot } from './index'
import { buildStoryDashboard } from '../insights/dashboard'

const dashboard = (id: 'squirrels' | 'football') => {
  const result = getDemoDashboard(id)
  if (!result) throw new Error(`Missing built-in demo: ${id}`)
  return result
}

const story = (id: 'squirrels' | 'football') => {
  const { dataset, noun } = dashboard(id)
  return buildStoryDashboard(dataset.columns.map((column) => column.name), dataset.previewRows, { noun })
}

describe('offline demo fixtures', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('demo must not fetch') }))
  })

  it('exposes both curated datasets with an observed-data disclosure', () => {
    expect(demoDatasets.map(({ id }) => id)).toEqual(['squirrels', 'football'])
    for (const id of ['squirrels', 'football'] as const) {
      const { dataset, disclosure, noun } = dashboard(id)
      expect(dataset.acceptedRowCount).toBe(dataset.previewRows.length)
      expect(disclosure).toMatch(/observed data demo/i)
      expect(disclosure).toMatch(/nothing here is an? (AI|Jev) prediction/i)
      expect(noun.plural).not.toBe('rows')
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('builds the squirrel dashboard from the census columns: a map, a trend, and rates', () => {
    const { kpis, views } = story('squirrels')
    expect(kpis[0]).toEqual({ label: 'Sightings', value: '3,023' })
    expect(views.map((view) => view.kind)).toEqual(expect.arrayContaining(['map', 'trend', 'traits', 'rate']))
    expect(views[0]?.kind).toBe('map')
    // Every headline is a finding stated in words, not a column name.
    expect(views.every((view) => view.title.split(' ').length >= 5)).toBe(true)
    expect(views.find((view) => view.kind === 'trend')?.title).toBe('Sightings fell 59% from the start of the period to the end')
  })

  it('builds the football dashboard from observed play columns, never EPA or WPA', () => {
    const { dataset } = dashboard('football')
    const names = dataset.columns.map((column) => column.name)
    expect(names).not.toEqual(expect.arrayContaining(['wpa']))
    expect(names).not.toEqual(expect.arrayContaining(['epa']))
    const { kpis, views } = story('football')
    expect(kpis[0]).toEqual({ label: 'Plays', value: '71' })
    expect(kpis[1]).toEqual(expect.objectContaining({ label: 'Total yards gained', value: '335' }))
    expect(views[0]).toEqual(expect.objectContaining({ kind: 'sequence', title: 'Seahawks score went from 0 to 29 over 71 plays' }))
    expect(views.some((view) => view.kind === 'ranking')).toBe(true)
    expect(JSON.stringify(views.map((view) => view.fields))).not.toMatch(/wpa|epa/)
  })

  it('answers "where are they eating" from the eating and location columns', () => {
    const { dataset, noun } = dashboard('squirrels')
    const asked = buildStoryDashboard(dataset.columns.map((column) => column.name), dataset.previewRows, {
      noun,
      question: 'Identify common locations where squirrels are spotted eating',
    })
    expect(asked.focus).toEqual(expect.arrayContaining(['Location', 'Eating']))
    expect(asked.views[0]).toEqual(expect.objectContaining({
      kind: 'rate',
      title: 'Eating is 1.5× as common for Ground Plane as for Above Ground',
      fields: ['location', 'eating'],
    }))
  })

  it('keeps the saved replays local, complete, and honestly labeled', () => {
    for (const id of ['demo-squirrels', 'demo-football'] as const) {
      const snapshot = getDemoSnapshot(id)
      expect(snapshot?.analysisId).toBe(id)
      expect(snapshot?.status).toBe('complete')
      expect(snapshot?.progress.completedRows).toBe(snapshot?.resultRows.length)
      expect(snapshot?.progress.totalCalls).toBe(0)
      expect(snapshot?.resultRows.every(({ value }) => Number.isFinite(value) && (value ?? -1) >= 0 && (value ?? 2) <= 1)).toBe(true)
    }
    const squirrels = getDemoSnapshot('demo-squirrels')!
    expect(squirrels.resultRows.every(({ model }) => model === 'observed-data')).toBe(true)
    expect(squirrels.resultRows.map(({ value }) => value)).toEqual(squirrels.resultRows.map(({ input }) => (input.eating ? 1 : 0)))
    expect(demoReplayDisclosure('demo-squirrels')).toMatch(/observed counts, not AI predictions/i)

    const football = getDemoSnapshot('demo-football')!
    expect(football.resultRows.every(({ model }) => model === 'illustrative-demo')).toBe(true)
    expect(football.resultRows.map(({ value }) => value)).toEqual(getDemoSnapshot('demo-football')!.resultRows.map(({ value }) => value))
    expect(demoReplayDisclosure('demo-football')).toMatch(/not Jev predictions/i)

    expect(getDemoSnapshot('anything-else')).toBeUndefined()
    expect(getDemoDashboard('anything-else')).toBeUndefined()
    expect(demoReplayDisclosure('anything-else')).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })
})
