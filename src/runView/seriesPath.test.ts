import { describe, expect, it } from 'vitest'
import type { AnalysisResultRow } from '../shared/analysis'
import { areaPath, jevSeriesPoints, linePath, seriesExtent, seriesX } from './seriesPath'

const row = (rowIndex: number, value: number | undefined, wpa = 0.88): AnalysisResultRow => ({
  rowIndex,
  input: { play_id: rowIndex, wpa },
  model: 'jev-latest',
  ...(value === undefined ? {} : { value }),
})

describe('Jev series path', () => {
  it('places points on play index 0-1 and ignores CSV wpa', () => {
    expect(seriesX(0, 39)).toBe(0)
    expect(seriesX(38, 39)).toBe(1)
    const points = jevSeriesPoints([
      row(0, 0.4, 0.99),
      row(1, undefined, 0.5),
      row(2, 0.7, 0.01),
    ], 3, 39)
    expect(points).toEqual([
      { x: 0, yValue: 0.4, rowIndex: 0 },
      { x: 2 / 38, yValue: 0.7, rowIndex: 2 },
    ])
    expect(points.every((point) => point.yValue !== 0.99 && point.yValue !== 0.5 && point.yValue !== 0.01)).toBe(true)
  })

  it('keeps a denser 71-play domain so a mid-run prefix does not stretch to the right edge', () => {
    expect(seriesX(0, 71)).toBe(0)
    expect(seriesX(70, 71)).toBe(1)
    expect(seriesX(2, 71)).toBeCloseTo(2 / 70)
    expect(seriesX(1, 71)).toBeLessThan(seriesX(1, 39))
    const points = jevSeriesPoints([row(0, 0.2), row(1, 0.4), row(2, 0.6)], 3, 71)
    expect(points).toHaveLength(3)
    expect(points[0]?.x).toBe(0)
    expect(points.at(-1)?.x).toBeCloseTo(2 / 70)
    expect(points.at(-1)?.x).toBeLessThan(1)
    expect(linePath(points).startsWith('M0 ')).toBe(true)
    expect(areaPath(points).endsWith('Z')).toBe(true)
    expect(linePath(points)).toContain('L')
  })

  it('clips the area+line to the latest row so the series grows left to right', () => {
    expect(seriesExtent([], 71)).toBe(0)
    expect(seriesExtent(jevSeriesPoints([row(0, 0.2)], 1, 71), 71)).toBeCloseTo(1 / 70)
    expect(seriesExtent(jevSeriesPoints([row(0, 0.2), row(70, 0.8)], 2, 71), 71)).toBe(1)
  })

  it('builds a left-to-right area and line that grow with persisted Jev values', () => {
    const points = jevSeriesPoints([row(0, 0.2), row(1, 0.8)], 2, 3)
    expect(linePath(points)).toBe('M0 0.8 L0.5 0.2')
    expect(areaPath(points)).toBe('M0 0.8 L0.5 0.2 L0.5 1 L0 1 Z')
    expect(jevSeriesPoints([row(0, 0.2), row(1, 0.8)], 1, 3)).toHaveLength(1)
  })
})
