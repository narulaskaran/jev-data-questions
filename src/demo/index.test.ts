import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoDatasets, getDemoDashboard, getDemoSnapshot } from './index'

const dashboard = (id: 'squirrels' | 'football') => {
  const result = getDemoDashboard(id)
  if (!result) throw new Error(`Missing built-in demo: ${id}`)
  return result
}

describe('offline demo fixtures', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('demo must not fetch') }))
  })

  it('exposes both curated datasets and complete bounded snapshots for every tile', () => {
    expect(demoDatasets.map(({ id }) => id)).toEqual(['squirrels', 'football'])

    for (const id of ['squirrels', 'football'] as const) {
      const { dataset, tiles, disclosure } = dashboard(id)
      expect(dataset.acceptedRowCount).toBeGreaterThan(0)
      expect(tiles.length).toBeGreaterThan(0)
      expect(disclosure).toMatch(/demo/i)
      for (const { snapshot } of tiles) {
        expect(snapshot?.status).toBe('complete')
        expect(snapshot?.progress.completedRows).toBe(dataset.acceptedRowCount)
        expect(snapshot?.progress.totalRows).toBe(dataset.acceptedRowCount)
        expect(snapshot?.progress.completedCalls).toBe(0)
        expect(snapshot?.progress.totalCalls).toBe(0)
        expect(snapshot?.resultRows).toHaveLength(dataset.acceptedRowCount)
        expect(snapshot?.resultRows.map(({ rowIndex }) => rowIndex)).toEqual(
          Array.from({ length: dataset.acceptedRowCount }, (_, index) => index),
        )
        expect(snapshot?.resultRows.every(({ value }) => Number.isFinite(value) && (value ?? -1) >= 0 && (value ?? 2) <= 1)).toBe(true)
        expect(snapshot?.resultRows.every(({ confidence }) => confidence === undefined)).toBe(true)
      }
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the source eating booleans as observed values and discloses their meaning', () => {
    const { dataset, tiles, disclosure } = dashboard('squirrels')
    const rows = tiles[0]?.snapshot?.resultRows ?? []
    expect(rows.map(({ value }) => value)).toEqual(dataset.previewRows.map(({ eating }) => eating ? 1 : 0))
    expect(rows.every(({ model }) => model === 'observed-data')).toBe(true)
    expect(disclosure).toMatch(/observed counts/i)
    expect(disclosure).toMatch(/not AI predictions/i)
  })

  it('keeps football demos on deterministic score and yardage rules, never WPA', () => {
    const first = dashboard('football')
    const second = dashboard('football')
    expect(first.disclosure).toMatch(/not Jev predictions/i)
    expect(first.tiles.map(({ snapshot }) => snapshot?.query)).toEqual(
      second.tiles.map(({ snapshot }) => snapshot?.query),
    )
    for (let tileIndex = 0; tileIndex < first.tiles.length; tileIndex += 1) {
      const rows = first.tiles[tileIndex]?.snapshot?.resultRows ?? []
      const repeated = second.tiles[tileIndex]?.snapshot?.resultRows ?? []
      expect(rows.map(({ value }) => value)).toEqual(repeated.map(({ value }) => value))
      expect(rows.every(({ model }) => model === 'illustrative-demo')).toBe(true)
      expect(rows.every(({ input }) => Object.prototype.hasOwnProperty.call(input, 'wpa'))).toBe(true)
    }
  })

  it('resolves the stable lead snapshot IDs without network access', () => {
    expect(getDemoSnapshot('demo-squirrels')?.analysisId).toBe('demo-squirrels')
    expect(getDemoSnapshot('demo-football')?.analysisId).toBe('demo-football')
    expect(getDemoSnapshot('anything-else')).toBeUndefined()
    expect(getDemoDashboard('anything-else')).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })
})
