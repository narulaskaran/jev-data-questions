import { describe, expect, it } from 'vitest'

describe('serverless handler import safety', () => {
  it('loads dataset and analysis handlers without a module-init throw', async () => {
    const handlers = await Promise.all([
      import('../../api/datasets/status'),
      import('../../api/datasets/from-csv'),
      import('../../api/datasets/from-url'),
      import('../../api/datasets/[datasetId]'),
      import('../../api/analysis/draft'),
      import('../../api/analysis/propose'),
      import('../../api/analysis/run'),
      import('../../api/analysis/[analysisId]'),
      import('../../api/share/[analysisId]'),
      import('../../api/browse'),
    ])
    for (const mod of handlers) {
      expect(typeof mod.default).toBe('function')
    }
  })
})
