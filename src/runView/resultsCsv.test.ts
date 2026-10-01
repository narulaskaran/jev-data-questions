import { describe, expect, it, vi } from 'vitest'
import { downloadTextFile, escapeCsvCell, resultsCsv, resultsCsvFilename } from './resultsCsv'
import type { AnalysisSnapshot } from '../shared/analysis'

const snapshot = (overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot => ({
  analysisId: 'analysis-demo-1',
  fixtureId: 'dataset-1',
  datasetId: 'dataset-1',
  sourceType: 'upload',
  query: '{"type":"choice","instructions":"Classify","classes":["gold","silver"]}',
  status: 'complete',
  createdAt: '2026-09-17T18:00:00.000Z',
  updatedAt: '2026-09-17T18:01:00.000Z',
  progress: { completedRows: 2, totalRows: 2, completedCalls: 2, totalCalls: 2 },
  questionKind: 'choice',
  classes: ['gold', 'silver'],
  columns: ['message'],
  resultRows: [
    { rowIndex: 0, input: { message: 'hello' }, model: 'jev', selectedClass: 'gold', probabilities: { gold: 0.9, silver: 0.1 } },
    { rowIndex: 1, input: { message: '=1+2' }, model: 'jev', selectedClass: 'silver', probabilities: { gold: 0.2, silver: 0.8 } },
  ],
  ...overrides,
})

describe('results CSV export', () => {
  it('emits row_id plus class probability columns and formula-escapes cells', () => {
    expect(escapeCsvCell('=1+2')).toBe("'=1+2")
    expect(escapeCsvCell('+hi')).toBe("'+hi")
    expect(escapeCsvCell('gold,silver')).toBe('"gold,silver"')
    const csv = resultsCsv(snapshot())
    expect(csv).toBe('row_id,selected_class,gold,silver\n1,gold,0.9,0.1\n2,silver,0.2,0.8\n')
    expect(resultsCsvFilename(snapshot())).toBe('jev-results-analysis-demo-1.csv')
  })

  it('emits row_id,probability for Noul runs', () => {
    const csv = resultsCsv(snapshot({
      query: '{"type":"noul","instructions":"Will SEA win given this play state?"}',
      questionKind: 'noul',
      classes: [],
      resultRows: [
        { rowIndex: 0, input: { play_id: 57 }, model: 'jev', questionKind: 'noul', value: 0.42 },
        { rowIndex: 1, input: { play_id: 58 }, model: 'jev', questionKind: 'noul', value: 0.55 },
      ],
    }))
    expect(csv).toBe('row_id,probability\n1,0.42\n2,0.55\n')
  })

  it('downloads through a Blob object URL', () => {
    const click = vi.fn()
    const revoke = vi.fn()
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:results'),
      revokeObjectURL: revoke,
    })
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const node = originalCreate(tag)
      if (tag === 'a') Object.assign(node, { click })
      return node
    })
    try {
      downloadTextFile('jev-results.csv', 'row_id,probability\n1,0.5\n')
      expect(URL.createObjectURL).toHaveBeenCalled()
      expect(click).toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })
  it('labels normalized scores accurately and exports out-of-order results in source order', () => {
    const csv = resultsCsv(snapshot({ query: '{"type":"score","instructions":"Score quality"}', questionKind: 'score', classes: [], resultRows: [
      { rowIndex: 4, input: {}, model: 'illustrative-demo', value: 0.8 },
      { rowIndex: 0, input: {}, model: 'illustrative-demo', value: 0.2 },
    ] }))
    expect(csv).toBe('row_id,score\n1,0.2\n5,0.8\n')
  })
})
