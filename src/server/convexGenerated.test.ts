import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getFunctionName } from 'convex/server'
import { api } from './convexGenerated'

describe('convex generated API boundary', () => {
  it('loads function refs from convex/server anyApi instead of requiring generated ESM', () => {
    const source = readFileSync('src/server/convexGenerated.ts', 'utf8')
    expect(source).toContain("import { anyApi } from 'convex/server'")
    expect(source).toMatch(/export const api = anyApi/)
    expect(source).not.toMatch(/createRequire\(/)
    expect(getFunctionName(api.analyses.authorizedGetAnalysis)).toBe('analyses:authorizedGetAnalysis')
    expect(getFunctionName(api.analyses.authorizedGetCompleteAnalysisByContentKey)).toBe('analyses:authorizedGetCompleteAnalysisByContentKey')
    expect(getFunctionName(api.analyses.authorizedClaimAnalysisByContentKey)).toBe('analyses:authorizedClaimAnalysisByContentKey')
    expect(getFunctionName(api.analyses.authorizedHealStaleAnalysis)).toBe('analyses:authorizedHealStaleAnalysis')
    expect(getFunctionName(api.analyses.authorizedGetDraftByContentKey)).toBe('analyses:authorizedGetDraftByContentKey')
    expect(getFunctionName(api.analyses.authorizedPutDraft)).toBe('analyses:authorizedPutDraft')
    expect(getFunctionName(api.datasets.authorizedPutDataset)).toBe('datasets:authorizedPutDataset')
  })
})
