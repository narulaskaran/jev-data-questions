import { describe, expect, it } from 'vitest'
import { asPerspectiveLabel, perspectiveMetricTitle, perspectivePercentLabel, teamCode } from './teamMetadata'

describe('perspective labels', () => {
  it('keeps fixture team codes and compresses longer names', () => {
    expect(asPerspectiveLabel('SEA')).toBe('SEA')
    expect(asPerspectiveLabel('ne')).toBe('NE')
    expect(asPerspectiveLabel('Seattle')).toBe('SEA')
    expect(asPerspectiveLabel('')).toBeUndefined()
    expect(asPerspectiveLabel(null)).toBeUndefined()
    expect(teamCode('Seattle')).toBe('SEA')
  })

  it('prefixes the metric with the team and never leaves a bare title when a team is known', () => {
    expect(perspectiveMetricTitle('win probability')).toBe('Win probability')
    expect(perspectiveMetricTitle('Win probability', 'SEA')).toBe('SEA win probability')
    expect(perspectiveMetricTitle('play quality', 'SEA')).toBe('SEA play quality')
    expect(perspectiveMetricTitle('Play quality', 'SEA')).not.toBe('Play quality')
    expect(perspectiveMetricTitle('Win probability', 'SEA')).not.toBe('Win probability')
  })

  it('puts the team immediately before the percent', () => {
    expect(perspectivePercentLabel('91%')).toBe('91%')
    expect(perspectivePercentLabel('91%', 'SEA')).toBe('SEA 91%')
    expect(perspectivePercentLabel('91%', 'SEA')).not.toMatch(/^91%/)
  })
})
