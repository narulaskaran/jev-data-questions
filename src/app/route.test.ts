import { describe, expect, it } from 'vitest'
import { datasetHref, landHref, parseAppPath, shareHref } from './route'

describe('app routes', () => {
  it('parses land, dataset, and share paths', () => {
    expect(parseAppPath('/')).toEqual({ kind: 'land' })
    expect(parseAppPath('/dataset/nyc-squirrel-census-2018-jev-v1')).toEqual({
      kind: 'dataset',
      datasetId: 'nyc-squirrel-census-2018-jev-v1',
    })
    expect(parseAppPath('/dataset/dataset%2F1/')).toEqual({ kind: 'dataset', datasetId: 'dataset/1' })
    expect(parseAppPath('/share/analysis-1')).toEqual({ kind: 'share', analysisId: 'analysis-1' })
    expect(parseAppPath('/share/analysis%20%2F1')).toEqual({ kind: 'share', analysisId: 'analysis /1' })
  })

  it('builds dataset hrefs without dropping Engineer search', () => {
    expect(datasetHref('sea-1')).toBe('/dataset/sea-1')
    expect(datasetHref('sea 1', '?mode=engineer')).toBe('/dataset/sea%201?mode=engineer')
    expect(landHref('?mode=engineer')).toBe('/?mode=engineer')
    expect(shareHref('analysis /1')).toBe('/share/analysis%20%2F1')
  })
})
