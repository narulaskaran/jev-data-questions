import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api'
import schema from './schema'

const modules = (import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob('./**/*.ts')
const secret = ['analysis', 'convex', 'test', 'auth'].join('-')
const record = {
  analysisId: 'a1',
  datasetId: 'd1',
  datasetName: 'Tickets',
  sourceType: 'upload' as const,
  query: 'Classify',
  classes: [{ name: 'yes', description: 'y' }, { name: 'no', description: 'n' }],
  columns: ['a', 'b'],
  status: 'queued' as const,
  mode: 'mock' as const,
  createdAt: 1,
  updatedAt: 1,
  progress: { totalRows: 3, completedRows: 0, failedRows: 0 },
  controlTokenHash: 'private-hash',
}
const row = { rowIndex: 0, model: 'm', selectedClass: 'yes', probabilities: [0.9, 0.1] }

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = secret
})
afterEach(() => {
  process.env.CONVEX_WRITE_SECRET = secret
})

describe('analyses authorization', () => {
  const calls = (t: ReturnType<typeof convexTest>, authToken: string) => ({
    create: () => t.mutation(api.analyses.create, { authToken, record }),
    claim: () => t.mutation(api.analyses.claim, { authToken, analysisId: 'a1', ownerToken: 'o', leaseMs: 1000 }),
    append: () => t.mutation(api.analyses.append, { authToken, analysisId: 'a1', ownerToken: 'o', rows: [row], leaseMs: 1000 }),
    finish: () => t.mutation(api.analyses.finish, { authToken, analysisId: 'a1', ownerToken: 'o', outcome: { status: 'complete' } }),
    cancel: () => t.mutation(api.analyses.cancel, { authToken, analysisId: 'a1' }),
    getRecord: () => t.query(api.analyses.getRecord, { authToken, analysisId: 'a1' }),
  })

  it.each(['create', 'claim', 'append', 'finish', 'cancel', 'getRecord'] as const)('rejects wrong and empty tokens on %s', async (name) => {
    const t = convexTest(schema, modules)
    await expect(calls(t, 'wrong')[name]()).rejects.toThrow(/Unauthorized/)
    await expect(calls(t, '')[name]()).rejects.toThrow(/Unauthorized/)
    await expect(calls(t, `${secret}x`)[name]()).rejects.toThrow(/Unauthorized/)
  })

  it.each(['create', 'claim', 'append', 'finish', 'cancel', 'getRecord'] as const)('fails closed on %s when CONVEX_WRITE_SECRET is unset or empty', async (name) => {
    const t = convexTest(schema, modules)
    delete process.env.CONVEX_WRITE_SECRET
    await expect(calls(t, '')[name]()).rejects.toThrow(/Unauthorized/)
    await expect(calls(t, 'anything')[name]()).rejects.toThrow(/Unauthorized/)
    process.env.CONVEX_WRITE_SECRET = ''
    await expect(calls(t, '')[name]()).rejects.toThrow(/Unauthorized/)
  })

  it('changes nothing when a write is rejected', async () => {
    const t = convexTest(schema, modules)
    await expect(calls(t, 'wrong').create()).rejects.toThrow()
    expect(await t.query(api.analyses.readPage, { analysisId: 'a1', after: -1, limit: 10 })).toBeNull()
  })
})

describe('analyses public reads', () => {
  it('never return the control token hash or lease fields, including in stored documents', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(api.analyses.create, { authToken: secret, record })
    await t.mutation(api.analyses.claim, { authToken: secret, analysisId: 'a1', ownerToken: 'owner-secret', leaseMs: 1000 })
    await t.mutation(api.analyses.append, { authToken: secret, analysisId: 'a1', ownerToken: 'owner-secret', rows: [row], leaseMs: 1000 })
    const page = await t.query(api.analyses.readPage, { analysisId: 'a1', after: -1, limit: 10 })
    const list = await t.query(api.analyses.listRecent, { limit: 10 })
    const text = JSON.stringify([page, list])
    expect(text).not.toContain('private-hash')
    expect(text).not.toContain('owner-secret')
    expect(text).not.toMatch(/controlTokenHash|runOwnerToken|runLeaseExpiresAt|_id|_creationTime/)
    expect(page?.rows[0]).toEqual(row)
    const stored = await t.run((ctx) => ctx.db.query('analyses').first())
    expect(stored).toMatchObject({ runOwnerToken: 'owner-secret' })
  })
})

describe('analyses validation', () => {
  const create = (t: ReturnType<typeof convexTest>, overrides: Record<string, unknown>) =>
    t.mutation(api.analyses.create, { authToken: secret, record: { ...record, ...overrides } })

  it('enforces the shared bounds on create', async () => {
    const t = convexTest(schema, modules)
    await expect(create(t, { analysisId: 'x'.repeat(65) })).rejects.toThrow()
    await expect(create(t, { analysisId: '' })).rejects.toThrow()
    await expect(create(t, { query: 'q'.repeat(4_001) })).rejects.toThrow()
    await expect(create(t, { classes: [{ name: 'only', description: '' }] })).rejects.toThrow()
    await expect(create(t, { classes: Array.from({ length: 33 }, (_, index) => ({ name: `c${index}`, description: '' })) })).rejects.toThrow()
    await expect(create(t, { classes: [{ name: 'n'.repeat(81), description: '' }, { name: 'b', description: '' }] })).rejects.toThrow()
    await expect(create(t, { progress: { totalRows: 5_001, completedRows: 0, failedRows: 0 } })).rejects.toThrow()
    expect(await create(t, { analysisId: 'x'.repeat(64), query: 'q'.repeat(4_000) })).toBe('created')
  })

  it('rejects malformed append rows and oversize batches, and bad leases', async () => {
    const t = convexTest(schema, modules)
    await create(t, {})
    await t.mutation(api.analyses.claim, { authToken: secret, analysisId: 'a1', ownerToken: 'o', leaseMs: 1000 })
    const append = (rows: unknown[], leaseMs = 1000) =>
      t.mutation(api.analyses.append, { authToken: secret, analysisId: 'a1', ownerToken: 'o', rows: rows as never, leaseMs })
    await expect(append([{ ...row, rowIndex: 5_000 }])).rejects.toThrow()
    await expect(append([{ ...row, rowIndex: -1 }])).rejects.toThrow()
    await expect(append([{ ...row, rowIndex: 1.5 }])).rejects.toThrow()
    await expect(append([{ ...row, probabilities: { yes: 1 } }])).rejects.toThrow()
    await expect(append([{ ...row, probabilities: new Array(33).fill(0) }])).rejects.toThrow()
    await expect(append(Array.from({ length: 65 }, (_, index) => ({ ...row, rowIndex: index })))).rejects.toThrow()
    await expect(append([row], 0)).rejects.toThrow()
    await expect(append([row], Number.POSITIVE_INFINITY)).rejects.toThrow()
    const page = await t.query(api.analyses.readPage, { analysisId: 'a1', after: -1, limit: 10 })
    expect(page?.rows).toEqual([])
  })
})
