import { beforeEach, describe, expect, it } from 'vitest'
import type { AnalysisRecord, AnalysisResultRow, AnalysisStorage, LimitsStorage } from '../shared/analysis.js'
import type { DatasetRecord, DatasetRowValues, DatasetStorage } from '../shared/dataset.js'

/** A fresh store plus a way to move its clock forward. */
export interface StorageHarness<S> {
  store: S
  advance: (ms: number) => void
}

export interface AnalysisContractOptions {
  /** Rows appended in the long-run test. */
  bulkRows?: number
}

const LEASE = 1_000
const classes = [
  { name: 'urgent', description: 'Needs attention now' },
  { name: 'routine', description: 'Can wait' },
]

export const analysisRecord = (analysisId: string, overrides: Partial<AnalysisRecord> = {}): AnalysisRecord => ({
  analysisId,
  datasetId: 'dataset-1',
  datasetName: 'Tickets',
  sourceType: 'upload',
  query: 'Classify the ticket',
  classes,
  columns: ['subject', 'body'],
  status: 'queued',
  mode: 'mock',
  createdAt: 0,
  updatedAt: 0,
  progress: { totalRows: 10, completedRows: 0, failedRows: 0 },
  controlTokenHash: 'hash-secret',
  ...overrides,
})

const okRow = (rowIndex: number): AnalysisResultRow => ({
  rowIndex,
  model: 'jev-test',
  selectedClass: 'urgent',
  probabilities: [0.75, 0.25],
  confidence: 0.75,
  latencyMs: 12,
})

const failedRow = (rowIndex: number): AnalysisResultRow => ({ rowIndex, model: 'jev-test', error: { code: 'PROVIDER_FAILED', retryable: true } })

const collectPages = async (store: AnalysisStorage, id: string, limit: number): Promise<AnalysisResultRow[]> => {
  const all: AnalysisResultRow[] = []
  let after = -1
  for (;;) {
    const page = await store.readPage(id, after, limit)
    if (!page || page.rows.length === 0) return all
    all.push(...page.rows)
    after = page.rows[page.rows.length - 1].rowIndex
  }
}

export const analysisStorageContract = (
  name: string,
  factory: () => StorageHarness<AnalysisStorage> | Promise<StorageHarness<AnalysisStorage>>,
  { bulkRows = 5_000 }: AnalysisContractOptions = {},
): void => {
  describe(`${name} analysis storage`, () => {
    let store: AnalysisStorage
    let advance: (ms: number) => void
    beforeEach(async () => {
      ;({ store, advance } = await factory())
    })

    const seed = async (id = 'a1', overrides: Partial<AnalysisRecord> = {}) => {
      await store.create(analysisRecord(id, overrides))
    }
    const running = async (id = 'a1', owner = 'owner-a') => {
      await seed(id)
      expect(await store.claim(id, owner, LEASE)).toBe('claimed')
    }

    describe('create and read', () => {
      it('creates once and reports exists without modifying', async () => {
        expect(await store.create(analysisRecord('a1'))).toBe('created')
        expect(await store.create(analysisRecord('a1', { query: 'changed', controlTokenHash: 'other' }))).toBe('exists')
        const record = await store.getRecord('a1')
        expect(record?.query).toBe('Classify the ticket')
        expect(record?.controlTokenHash).toBe('hash-secret')
      })

      it('returns the hash from getRecord but never from readPage', async () => {
        await seed()
        expect((await store.getRecord('a1'))?.controlTokenHash).toBe('hash-secret')
        const page = await store.readPage('a1', -1, 10)
        expect(page?.analysis.analysisId).toBe('a1')
        expect(JSON.stringify(page)).not.toContain('hash-secret')
        expect(page?.analysis).not.toHaveProperty('controlTokenHash')
        expect(JSON.stringify(await store.listRecent(10))).not.toContain('hash-secret')
      })

      it('returns undefined for unknown ids', async () => {
        expect(await store.getRecord('nope')).toBeUndefined()
        expect(await store.readPage('nope', -1, 10)).toBeUndefined()
      })

      it('never exposes lease details', async () => {
        await running()
        await store.append('a1', 'owner-a', [okRow(0)], LEASE)
        const text = JSON.stringify([await store.getRecord('a1'), await store.readPage('a1', -1, 10), await store.listRecent(5)])
        expect(text).not.toContain('owner-a')
        expect(text).not.toMatch(/lease|runOwner/i)
      })

      it('round-trips non-ASCII and special-character class names, columns and probabilities', async () => {
        const special = [
          { name: 'très urgent', description: 'à traiter' },
          { name: '$routine', description: '_later' },
        ]
        const columns = ['_id', '$price', 'naïve', '日本']
        await seed('a1', { classes: special, columns, labelColumn: '日本' })
        await store.claim('a1', 'o', LEASE)
        await store.append('a1', 'o', [{ rowIndex: 0, model: 'm', selectedClass: 'très urgent', probabilities: [0.6, 0.4], confidence: 0.6 }], LEASE)
        const record = await store.getRecord('a1')
        expect(record?.classes).toEqual(special)
        expect(record?.columns).toEqual(columns)
        expect(record?.labelColumn).toBe('日本')
        expect((await store.readPage('a1', -1, 5))?.rows[0]).toMatchObject({ selectedClass: 'très urgent', probabilities: [0.6, 0.4] })
      })

      it('does not let callers mutate stored state', async () => {
        const input = analysisRecord('a1')
        await store.create(input)
        input.query = 'mutated'
        input.classes[0].name = 'mutated'
        const first = await store.getRecord('a1')
        first!.query = 'mutated again'
        first!.progress.totalRows = 999
        const second = await store.getRecord('a1')
        expect(second?.query).toBe('Classify the ticket')
        expect(second?.classes[0].name).toBe('urgent')
        expect(second?.progress.totalRows).toBe(10)
      })
    })

    describe('claim', () => {
      it('reports missing', async () => {
        expect(await store.claim('nope', 'o', LEASE)).toBe('missing')
      })

      it('claims, sets running and startedAt', async () => {
        await seed()
        expect(await store.claim('a1', 'owner-a', LEASE)).toBe('claimed')
        const record = await store.getRecord('a1')
        expect(record?.status).toBe('running')
        expect(typeof record?.startedAt).toBe('number')
      })

      it('is busy for a second owner while leased, but renewable by the same owner', async () => {
        await running()
        expect(await store.claim('a1', 'owner-b', LEASE)).toBe('busy')
        expect(await store.claim('a1', 'owner-a', LEASE)).toBe('claimed')
      })

      it('is claimable again after the lease expires, and keeps the first startedAt', async () => {
        await running()
        const startedAt = (await store.getRecord('a1'))?.startedAt
        advance(LEASE - 1)
        expect(await store.claim('a1', 'owner-b', LEASE)).toBe('busy')
        advance(1)
        expect(await store.claim('a1', 'owner-b', LEASE)).toBe('claimed')
        expect((await store.getRecord('a1'))?.startedAt).toBe(startedAt)
        expect(await store.append('a1', 'owner-a', [okRow(0)], LEASE)).toBe('lost')
      })

      it('is finished after complete or cancel', async () => {
        await running('done')
        await store.finish('done', 'owner-a', { status: 'complete' })
        expect(await store.claim('done', 'owner-b', LEASE)).toBe('finished')
        await seed('stopped')
        await store.cancel('stopped')
        expect(await store.claim('stopped', 'owner-b', LEASE)).toBe('finished')
      })

      it('clears the error when claiming an errored run', async () => {
        await running()
        await store.finish('a1', 'owner-a', { status: 'error', error: { code: 'BOOM', retryable: true } })
        expect((await store.getRecord('a1'))?.status).toBe('error')
        expect(await store.claim('a1', 'owner-b', LEASE)).toBe('claimed')
        const record = await store.getRecord('a1')
        expect(record?.status).toBe('running')
        expect(record?.error).toBeUndefined()
      })
    })

    describe('append', () => {
      it('inserts rows and counts them', async () => {
        await running()
        expect(await store.append('a1', 'owner-a', [okRow(0), okRow(1)], LEASE)).toBe('ok')
        const page = await store.readPage('a1', -1, 10)
        expect(page?.rows).toEqual([okRow(0), okRow(1)])
        expect(page?.analysis.progress).toEqual({ totalRows: 10, completedRows: 2, failedRows: 0 })
      })

      it('is idempotent for rows that already exist', async () => {
        await running()
        await store.append('a1', 'owner-a', [okRow(0), okRow(1)], LEASE)
        expect(await store.append('a1', 'owner-a', [{ ...okRow(1), selectedClass: 'routine' }, okRow(2)], LEASE)).toBe('ok')
        expect(await store.append('a1', 'owner-a', [okRow(0), okRow(0)], LEASE)).toBe('ok')
        const page = await store.readPage('a1', -1, 10)
        expect(page?.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2])
        expect(page?.rows[1].selectedClass).toBe('urgent')
        expect(page?.analysis.progress.completedRows).toBe(3)
      })

      it('counts failed rows', async () => {
        await running()
        await store.append('a1', 'owner-a', [okRow(0), failedRow(1), failedRow(2)], LEASE)
        const page = await store.readPage('a1', -1, 10)
        expect(page?.analysis.progress).toEqual({ totalRows: 10, completedRows: 3, failedRows: 2 })
        expect(page?.rows[1]).toEqual(failedRow(1))
      })

      it('returns lost for a non-owner or an unclaimed or unknown run and stores nothing', async () => {
        await seed()
        expect(await store.append('a1', 'owner-a', [okRow(0)], LEASE)).toBe('lost')
        expect(await store.claim('a1', 'owner-a', LEASE)).toBe('claimed')
        expect(await store.append('a1', 'owner-b', [okRow(0)], LEASE)).toBe('lost')
        expect(await store.append('missing', 'owner-a', [okRow(0)], LEASE)).toBe('lost')
        const page = await store.readPage('a1', -1, 10)
        expect(page?.rows).toEqual([])
        expect(page?.analysis.progress.completedRows).toBe(0)
      })

      it('lets the current owner append after its own lease lapsed if nobody took over', async () => {
        await running()
        advance(LEASE * 5)
        expect(await store.append('a1', 'owner-a', [okRow(0)], LEASE)).toBe('ok')
        expect(await store.claim('a1', 'owner-b', LEASE)).toBe('busy')
      })

      it('returns cancelled after cancel and stores nothing', async () => {
        await running()
        await store.append('a1', 'owner-a', [okRow(0)], LEASE)
        expect(await store.cancel('a1')).toBe(true)
        expect(await store.append('a1', 'owner-a', [okRow(1)], LEASE)).toBe('cancelled')
        const page = await store.readPage('a1', -1, 10)
        expect(page?.rows.map((row) => row.rowIndex)).toEqual([0])
        expect(page?.analysis.progress.completedRows).toBe(1)
        expect(page?.analysis.status).toBe('cancelled')
      })

      it('renews the lease and updatedAt', async () => {
        await running()
        const before = (await store.getRecord('a1'))?.updatedAt ?? 0
        advance(800)
        await store.append('a1', 'owner-a', [okRow(0)], LEASE)
        advance(800)
        expect(await store.claim('a1', 'owner-b', LEASE)).toBe('busy')
        expect((await store.getRecord('a1'))?.updatedAt).toBeGreaterThan(before)
        advance(300)
        expect(await store.claim('a1', 'owner-b', LEASE)).toBe('claimed')
      })

      it(`stores ${bulkRows} rows appended in batches of 8 with exact counters and gap-free paging`, async () => {
        await running('big')
        for (let start = 0; start < bulkRows; start += 8) {
          const batch = Array.from({ length: Math.min(8, bulkRows - start) }, (_, offset) => (start + offset) % 50 === 7 ? failedRow(start + offset) : okRow(start + offset))
          expect(await store.append('big', 'owner-a', batch, 60_000)).toBe('ok')
        }
        const failures = Math.floor((bulkRows + 42) / 50)
        const rows = await collectPages(store, 'big', 500)
        expect(rows).toHaveLength(bulkRows)
        expect(rows.map((row) => row.rowIndex)).toEqual(Array.from({ length: bulkRows }, (_, index) => index))
        const page = await store.readPage('big', bulkRows - 3, 500)
        expect(page?.rows.map((row) => row.rowIndex)).toEqual([bulkRows - 2, bulkRows - 1])
        expect(page?.analysis.progress.completedRows).toBe(bulkRows)
        expect(page?.analysis.progress.failedRows).toBe(failures)
      }, 120_000)
    })

    describe('readPage', () => {
      it('returns rows after the cursor ascending, whatever the insert order', async () => {
        await running()
        await store.append('a1', 'owner-a', [okRow(3), okRow(1)], LEASE)
        await store.append('a1', 'owner-a', [okRow(0), okRow(2)], LEASE)
        expect((await store.readPage('a1', -1, 10))?.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2, 3])
        expect((await store.readPage('a1', 1, 10))?.rows.map((row) => row.rowIndex)).toEqual([2, 3])
        expect((await store.readPage('a1', 3, 10))?.rows).toEqual([])
      })

      it('respects the limit and caps it at 500', async () => {
        await running()
        await store.append('a1', 'owner-a', Array.from({ length: 8 }, (_, index) => okRow(index)), LEASE)
        expect((await store.readPage('a1', -1, 3))?.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2])
        expect((await store.readPage('a1', 2, 3))?.rows.map((row) => row.rowIndex)).toEqual([3, 4, 5])
        expect((await store.readPage('a1', -1, 0))?.rows).toEqual([])
        expect(await collectPages(store, 'a1', 3)).toHaveLength(8)
      })
    })

    describe('finish', () => {
      it('complete sets status and completedAt and frees the lease', async () => {
        await running()
        advance(5)
        await store.finish('a1', 'owner-a', { status: 'complete' })
        const record = await store.getRecord('a1')
        expect(record?.status).toBe('complete')
        expect(typeof record?.completedAt).toBe('number')
        expect(await store.append('a1', 'owner-a', [okRow(0)], LEASE)).toBe('lost')
      })

      it('error stores the error and frees the lease', async () => {
        await running()
        await store.finish('a1', 'owner-a', { status: 'error', error: { code: 'BOOM', retryable: false } })
        const record = await store.getRecord('a1')
        expect(record?.status).toBe('error')
        expect(record?.error).toEqual({ code: 'BOOM', retryable: false })
        expect(await store.claim('a1', 'owner-b', LEASE)).toBe('claimed')
      })

      it('yield keeps the run running and frees the lease', async () => {
        await running()
        await store.finish('a1', 'owner-a', { status: 'yield' })
        expect((await store.getRecord('a1'))?.status).toBe('running')
        expect(await store.claim('a1', 'owner-b', LEASE)).toBe('claimed')
      })

      it('is a no-op for a non-owner, an unknown run, and a cancelled run', async () => {
        await running()
        await store.finish('a1', 'owner-b', { status: 'complete' })
        await store.finish('missing', 'owner-a', { status: 'complete' })
        expect((await store.getRecord('a1'))?.status).toBe('running')
        expect(await store.claim('a1', 'owner-b', LEASE)).toBe('busy')
        await store.cancel('a1')
        await store.finish('a1', 'owner-a', { status: 'complete' })
        expect((await store.getRecord('a1'))?.status).toBe('cancelled')
      })
    })

    describe('cancel', () => {
      it('cancels a queued or running run once', async () => {
        await seed('queued')
        expect(await store.cancel('queued')).toBe(true)
        const record = await store.getRecord('queued')
        expect(record?.status).toBe('cancelled')
        expect(typeof record?.completedAt).toBe('number')
        expect(await store.cancel('queued')).toBe(false)
        await running('live')
        expect(await store.cancel('live')).toBe(true)
        expect(await store.claim('live', 'owner-b', LEASE)).toBe('finished')
      })

      it('returns false for complete and missing runs', async () => {
        await running()
        await store.finish('a1', 'owner-a', { status: 'complete' })
        expect(await store.cancel('a1')).toBe(false)
        expect((await store.getRecord('a1'))?.status).toBe('complete')
        expect(await store.cancel('missing')).toBe(false)
      })
    })

    describe('listRecent', () => {
      it('lists newest first and honours the limit', async () => {
        for (const id of ['first', 'second', 'third']) {
          await seed(id)
          advance(10)
        }
        expect((await store.listRecent(10)).map((meta) => meta.analysisId)).toEqual(['third', 'second', 'first'])
        expect((await store.listRecent(2)).map((meta) => meta.analysisId)).toEqual(['third', 'second'])
        expect(await store.listRecent(0)).toEqual([])
      })

      it('caps the list at 50', async () => {
        for (let index = 0; index < 55; index += 1) {
          await seed(`a${index}`)
          advance(1)
        }
        const list = await store.listRecent(1_000)
        expect(list).toHaveLength(50)
        expect(list[0].analysisId).toBe('a54')
      }, 60_000)
    })
  })
}

const datasetRecord = (datasetId: string, rows: readonly DatasetRowValues[], columns: string[], overrides: Partial<DatasetRecord> = {}): DatasetRecord => ({
  datasetId,
  sourceType: 'upload',
  displayName: `${datasetId}.csv`,
  byteSize: 1_234,
  contentHash: `hash-${datasetId}`,
  delimiter: ',',
  columns: columns.map((name) => ({ name, inferredType: 'string' as const })),
  acceptedRowCount: rows.length,
  previewRows: rows.slice(0, 8).map((row) => [...row]),
  validationWarnings: ['one warning'],
  createdAt: 0,
  ...overrides,
})

export const datasetStorageContract = (
  name: string,
  factory: () => StorageHarness<DatasetStorage> | Promise<StorageHarness<DatasetStorage>>,
): void => {
  describe(`${name} dataset storage`, () => {
    let store: DatasetStorage
    let advance: (ms: number) => void
    beforeEach(async () => {
      ;({ store, advance } = await factory())
    })

    const smallRows = (count: number): DatasetRowValues[] =>
      Array.from({ length: count }, (_, index) => [`row-${index}`, index, index % 2 === 0, index % 5 === 0 ? null : `v${index}`])

    it('stores and returns metadata, and omits unknown ids', async () => {
      const rows = smallRows(5)
      await store.put(datasetRecord('d1', rows, ['name', 'n', 'flag', 'note'], { sourceUrl: 'https://example.com/a.csv' }), rows)
      const record = await store.get('d1')
      expect(record).toMatchObject({
        datasetId: 'd1',
        sourceType: 'upload',
        displayName: 'd1.csv',
        acceptedRowCount: 5,
        sourceUrl: 'https://example.com/a.csv',
        validationWarnings: ['one warning'],
      })
      expect(record?.previewRows).toEqual(rows)
      expect(record?.columns.map((column) => column.name)).toEqual(['name', 'n', 'flag', 'note'])
      expect(await store.get('missing')).toBeUndefined()
      expect(await store.getRows('missing', 0, 10)).toEqual([])
    })

    it('omits sourceUrl when not provided', async () => {
      const rows = smallRows(1)
      await store.put(datasetRecord('d1', rows, ['a', 'b', 'c', 'd']), rows)
      expect(await store.get('d1')).not.toHaveProperty('sourceUrl')
    })

    it('reads ranges across chunk boundaries', async () => {
      const rows = smallRows(1_000)
      await store.put(datasetRecord('big', rows, ['name', 'n', 'flag', 'note']), rows)
      expect(await store.getRows('big', 0, 5)).toEqual(rows.slice(0, 5))
      expect(await store.getRows('big', 195, 10)).toEqual(rows.slice(195, 205))
      expect(await store.getRows('big', 199, 2)).toEqual(rows.slice(199, 201))
      expect(await store.getRows('big', 200, 200)).toEqual(rows.slice(200, 400))
      expect(await store.getRows('big', 150, 500)).toEqual(rows.slice(150, 650))
      expect(await store.getRows('big', 990, 500)).toEqual(rows.slice(990))
      expect(await store.getRows('big', 0, 10_000)).toEqual(rows.slice(0, 500))
      expect(await store.getRows('big', 1_000, 10)).toEqual([])
      expect(await store.getRows('big', 5_000, 10)).toEqual([])
      expect(await store.getRows('big', 5, 0)).toEqual([])
    })

    it('splits very large cells across chunks without losing or reordering rows', async () => {
      const big = (seed: string) => seed.repeat(100_000 / seed.length)
      const rows: DatasetRowValues[] = Array.from({ length: 14 }, (_, index) => [`id-${index}`, big(`${index}x`), big('y'), index])
      await store.put(datasetRecord('wide', rows, ['id', 'a', 'b', 'n']), rows)
      expect(await store.getRows('wide', 0, 100)).toEqual(rows)
      expect(await store.getRows('wide', 3, 6)).toEqual(rows.slice(3, 9))
      expect(await store.getRows('wide', 13, 5)).toEqual(rows.slice(13))
    }, 60_000)

    it('round-trips special headers, non-ASCII text and every value type', async () => {
      const columns = ['_id', '$price', 'naïve', '日本', 'très urgent']
      const rows: DatasetRowValues[] = [
        ['a', 1.5, true, null, 'très urgent'],
        ['', -3, false, '日本語', '$ok _fine'],
      ]
      await store.put(datasetRecord('special', rows, columns), rows)
      expect((await store.get('special'))?.columns.map((column) => column.name)).toEqual(columns)
      expect(await store.getRows('special', 0, 10)).toEqual(rows)
    })

    it('handles an empty dataset', async () => {
      await store.put(datasetRecord('empty', [], ['a']), [])
      expect((await store.get('empty'))?.acceptedRowCount).toBe(0)
      expect(await store.getRows('empty', 0, 10)).toEqual([])
    })

    it('keeps the first copy when the same id is put again', async () => {
      const rows = smallRows(3)
      await store.put(datasetRecord('d1', rows, ['name', 'n', 'flag', 'note']), rows)
      const other = smallRows(2)
      await store.put(datasetRecord('d1', other, ['x', 'y', 'z', 'w'], { displayName: 'other.csv' }), other)
      expect((await store.get('d1'))?.displayName).toBe('d1.csv')
      expect(await store.getRows('d1', 0, 10)).toEqual(rows)
    })

    it('rejects rows that do not match acceptedRowCount and leaves nothing readable', async () => {
      const rows = smallRows(3)
      await expect(store.put(datasetRecord('bad', rows, ['name', 'n', 'flag', 'note'], { acceptedRowCount: 4 }), rows)).rejects.toThrow()
      expect(await store.get('bad')).toBeUndefined()
      expect(await store.getRows('bad', 0, 10)).toEqual([])
    })

    it('does not let callers mutate stored data', async () => {
      const rows = smallRows(3)
      const record = datasetRecord('d1', rows, ['name', 'n', 'flag', 'note'])
      await store.put(record, rows)
      rows[0][0] = 'mutated'
      record.displayName = 'mutated'
      const read = await store.getRows('d1', 0, 1)
      read[0][0] = 'mutated again'
      ;(await store.get('d1'))!.columns[0].name = 'mutated'
      expect((await store.getRows('d1', 0, 1))[0][0]).toBe('row-0')
      expect((await store.get('d1'))?.displayName).toBe('d1.csv')
      expect((await store.get('d1'))?.columns[0].name).toBe('name')
    })

    it('lists recent datasets newest first and honours the limit', async () => {
      for (const id of ['d1', 'd2', 'd3']) {
        const rows = smallRows(2)
        await store.put(datasetRecord(id, rows, ['name', 'n', 'flag', 'note']), rows)
        advance(10)
      }
      expect((await store.listRecent(10)).map((record) => record.datasetId)).toEqual(['d3', 'd2', 'd1'])
      expect((await store.listRecent(2)).map((record) => record.datasetId)).toEqual(['d3', 'd2'])
      expect(await store.listRecent(0)).toEqual([])
    })
  })
}

export const limitsStorageContract = (
  name: string,
  factory: () => StorageHarness<LimitsStorage> | Promise<StorageHarness<LimitsStorage>>,
): void => {
  describe(`${name} limits storage`, () => {
    let store: LimitsStorage
    let advance: (ms: number) => void
    beforeEach(async () => {
      ;({ store, advance } = await factory())
    })

    describe('consumeRate', () => {
      it('allows the limit, then blocks with a positive retryAfterMs', async () => {
        for (let index = 0; index < 3; index += 1) expect(await store.consumeRate('ip:1', 3, 1_000)).toEqual({ allowed: true, retryAfterMs: 0 })
        const blocked = await store.consumeRate('ip:1', 3, 1_000)
        expect(blocked.allowed).toBe(false)
        expect(blocked.retryAfterMs).toBeGreaterThan(0)
        expect(blocked.retryAfterMs).toBeLessThanOrEqual(1_000)
      })

      it('reports the time left in the window and does not extend it while blocked', async () => {
        await store.consumeRate('k', 1, 1_000)
        advance(400)
        expect(await store.consumeRate('k', 1, 1_000)).toEqual({ allowed: false, retryAfterMs: 600 })
        advance(300)
        expect(await store.consumeRate('k', 1, 1_000)).toEqual({ allowed: false, retryAfterMs: 300 })
      })

      it('starts a new window once the old one has expired', async () => {
        for (let index = 0; index < 2; index += 1) await store.consumeRate('k', 2, 1_000)
        expect((await store.consumeRate('k', 2, 1_000)).allowed).toBe(false)
        advance(1_000)
        expect(await store.consumeRate('k', 2, 1_000)).toEqual({ allowed: true, retryAfterMs: 0 })
        expect(await store.consumeRate('k', 2, 1_000)).toEqual({ allowed: true, retryAfterMs: 0 })
        expect((await store.consumeRate('k', 2, 1_000)).allowed).toBe(false)
      })

      it('tracks keys independently', async () => {
        await store.consumeRate('a', 1, 1_000)
        expect((await store.consumeRate('a', 1, 1_000)).allowed).toBe(false)
        expect((await store.consumeRate('b', 1, 1_000)).allowed).toBe(true)
      })

      it('rejects invalid limits and windows', async () => {
        await expect(store.consumeRate('k', 0, 1_000)).rejects.toThrow()
        await expect(store.consumeRate('k', 1, 0)).rejects.toThrow()
        await expect(store.consumeRate('k', 1, Number.NaN)).rejects.toThrow()
      })
    })

    describe('reserveBudget', () => {
      it('allows up to max exactly and reports what remains', async () => {
        expect(await store.reserveBudget('day', 4, 10)).toEqual({ allowed: true, remaining: 6 })
        expect(await store.reserveBudget('day', 6, 10)).toEqual({ allowed: true, remaining: 0 })
        expect(await store.reserveBudget('day', 0, 10)).toEqual({ allowed: true, remaining: 0 })
      })

      it('blocks beyond max and leaves the total unchanged', async () => {
        await store.reserveBudget('day', 8, 10)
        expect(await store.reserveBudget('day', 3, 10)).toEqual({ allowed: false, remaining: 2 })
        expect(await store.reserveBudget('day', 3, 10)).toEqual({ allowed: false, remaining: 2 })
        expect(await store.reserveBudget('day', 2, 10)).toEqual({ allowed: true, remaining: 0 })
      })

      it('blocks a first reservation that exceeds max without creating a total', async () => {
        expect(await store.reserveBudget('day', 11, 10)).toEqual({ allowed: false, remaining: 10 })
        expect(await store.reserveBudget('day', 10, 10)).toEqual({ allowed: true, remaining: 0 })
      })

      it('tracks scopes independently', async () => {
        await store.reserveBudget('a', 10, 10)
        expect((await store.reserveBudget('b', 1, 10)).allowed).toBe(true)
      })

      it('rejects non-finite or negative amounts', async () => {
        await expect(store.reserveBudget('s', -1, 10)).rejects.toThrow()
        await expect(store.reserveBudget('s', Number.NaN, 10)).rejects.toThrow()
        await expect(store.reserveBudget('s', Number.POSITIVE_INFINITY, 10)).rejects.toThrow()
        await expect(store.reserveBudget('s', 1, Number.NaN)).rejects.toThrow()
        expect(await store.reserveBudget('s', 10, 10)).toEqual({ allowed: true, remaining: 0 })
      })
    })
  })
}
