import { describe, expect, it } from 'vitest'
import {
  boxesOverlap,
  declutterPlaceLabels,
  estimateMapLabelSize,
  humanPlaceLabel,
  mapLabelText,
  normalizePoints,
  placeCentroids,
  placeCountLabel,
  projectPlaces,
  type PlaceLabel,
} from './places'

describe('places projection', () => {
  it('maps lat/lng eating rows and ranks Ground Plane above Location/Activity', () => {
    const rows = [
      { rowIndex: 0, input: { x: -73.97, y: 40.78, location: 'Ground Plane', eating: true }, value: 0.9 },
      { rowIndex: 1, input: { x: -73.96, y: 40.79, location: 'Above Ground', eating: false }, value: 0.1 },
      { rowIndex: 2, input: { x: -73.975, y: 40.782, location: 'Ground Plane', eating: true }, value: 0.8 },
    ]
    const projected = projectPlaces(rows)
    expect(projected.hasMap).toBe(true)
    expect(projected.points).toHaveLength(3)
    expect(projected.ranks.map((item) => item.name)).toEqual(['On the ground', 'In the trees'])
    expect(projected.ranks.map((item) => item.name)).not.toEqual(['Location', 'Activity'])
    expect(projected.ranks[0]).toEqual(expect.objectContaining({ name: 'On the ground', count: 2, eating: 2 }))
    const normalized = normalizePoints(projected.points)
    expect(normalized.every((point) => point.px >= 0 && point.px <= 1 && point.py >= 0 && point.py <= 1)).toBe(true)
  })

  it('falls back to ranked location bars when lat/lng are missing', () => {
    const projected = projectPlaces([
      { rowIndex: 0, input: { location: 'Ground Plane', eating: true } },
      { rowIndex: 1, input: { location: 'Ground Plane', eating: true } },
      { rowIndex: 2, input: { location: 'Above Ground', eating: false } },
    ])
    expect(projected.hasMap).toBe(false)
    expect(projected.ranks[0]).toEqual(expect.objectContaining({ name: 'On the ground', count: 2, eating: 2 }))
    expect(projected.ranks[1]).toEqual(expect.objectContaining({ name: 'In the trees', count: 1, eating: 0 }))
  })

  it('renames census jargon to plain place names', () => {
    expect(humanPlaceLabel('Ground Plane')).toBe('On the ground')
    expect(humanPlaceLabel('Above Ground')).toBe('In the trees')
    expect(humanPlaceLabel('Central Park')).toBe('Central Park')
  })

  it('formats ranked eating end labels as place · count', () => {
    expect(placeCountLabel('16C', 7)).toBe('16C · 7')
    expect(mapLabelText({ name: '16C', eating: 7 })).toBe('16C · 7 eating')
  })

  it('hides overlapping map labels and keeps the top eating places readable', () => {
    const clustered: PlaceLabel[] = [
      { name: '07F', px: 0.5, py: 0.5, eating: 12, count: 20 },
      { name: '11B', px: 0.51, py: 0.5, eating: 9, count: 18 },
      { name: '13A', px: 0.5, py: 0.51, eating: 8, count: 16 },
      { name: '14D', px: 0.49, py: 0.5, eating: 6, count: 14 },
      { name: '16C', px: 0.5, py: 0.49, eating: 4, count: 12 },
      { name: '22A', px: 0.52, py: 0.51, eating: 3, count: 10 },
      { name: '32E', px: 0.48, py: 0.51, eating: 2, count: 8 },
      { name: '33B', px: 0.51, py: 0.49, eating: 1, count: 6 },
    ]
    const visible = declutterPlaceLabels(clustered)
    expect(visible[0]?.name).toBe('07F')
    expect(visible.length).toBeGreaterThanOrEqual(2)
    expect(visible.length).toBeLessThan(clustered.length)
    const boxes = visible.map((label) => {
      const size = estimateMapLabelSize(label)
      return {
        left: label.px - size.width / 2,
        right: label.px + size.width / 2,
        top: label.py - size.height / 2,
        bottom: label.py + size.height / 2,
      }
    })
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(boxesOverlap(boxes[i]!, boxes[j]!, 0)).toBe(false)
      }
    }
  })

  it('keeps far-apart place labels instead of dropping them', () => {
    const visible = declutterPlaceLabels([
      { name: 'On the ground', px: 0.15, py: 0.8, eating: 1, count: 1 },
      { name: 'In the trees', px: 0.85, py: 0.15, eating: 0, count: 1 },
    ])
    expect(visible.map((item) => item.name)).toEqual(['On the ground', 'In the trees'])
  })

  it('pins labels to a median eating point instead of a scattered centroid', () => {
    const labels = placeCentroids([
      { rowIndex: 0, x: 0, y: 0, px: 0.1, py: 0.1, weight: 1, label: '16C' },
      { rowIndex: 1, x: 0, y: 0, px: 0.9, py: 0.9, weight: 0, label: '16C' },
      { rowIndex: 2, x: 0, y: 0, px: 0.2, py: 0.2, weight: 1, label: '16C' },
    ])
    expect(labels).toHaveLength(1)
    expect(labels[0]).toEqual(expect.objectContaining({ name: '16C', eating: 2, count: 3 }))
    expect(labels[0]?.px).toBeCloseTo(0.15)
    expect(labels[0]?.py).toBeCloseTo(0.15)
  })
})
