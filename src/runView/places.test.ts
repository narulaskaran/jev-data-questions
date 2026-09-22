import { describe, expect, it } from 'vitest'
import { projectPlaces, normalizePoints, humanPlaceLabel } from './places'

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
})
