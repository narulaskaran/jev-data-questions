import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api'
import schema from './schema'

const modules = (import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob('./**/*.ts')
const secret = ['limits', 'convex', 'test', 'auth'].join('-')

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = secret
})
afterEach(() => {
  vi.useRealTimers()
})

describe('limits authorization', () => {
  const calls = (t: ReturnType<typeof convexTest>, authToken: string) => ({
    consumeRate: () => t.mutation(api.limits.consumeRate, { authToken, key: 'k', limit: 1, windowMs: 1000 }),
    reserveBudget: () => t.mutation(api.limits.reserveBudget, { authToken, scope: 's', amount: 1, max: 10 }),
  })

  it.each(['consumeRate', 'reserveBudget'] as const)('rejects wrong and empty tokens on %s', async (name) => {
    const t = convexTest(schema, modules)
    await expect(calls(t, 'wrong')[name]()).rejects.toThrow(/Unauthorized/)
    await expect(calls(t, '')[name]()).rejects.toThrow(/Unauthorized/)
  })

  it.each(['consumeRate', 'reserveBudget'] as const)('fails closed on %s when CONVEX_WRITE_SECRET is unset', async (name) => {
    const t = convexTest(schema, modules)
    delete process.env.CONVEX_WRITE_SECRET
    await expect(calls(t, '')[name]()).rejects.toThrow(/Unauthorized/)
    await expect(calls(t, 'anything')[name]()).rejects.toThrow(/Unauthorized/)
  })

  it('does not consume anything when rejected', async () => {
    const t = convexTest(schema, modules)
    await expect(calls(t, 'wrong').consumeRate()).rejects.toThrow()
    expect(await t.mutation(api.limits.consumeRate, { authToken: secret, key: 'k', limit: 1, windowMs: 1000 })).toEqual({ allowed: true, retryAfterMs: 0 })
  })
})

describe('limits storage shape', () => {
  it('keeps one document per key and per scope', async () => {
    const t = convexTest(schema, modules)
    for (let index = 0; index < 3; index += 1) {
      await t.mutation(api.limits.consumeRate, { authToken: secret, key: 'k', limit: 2, windowMs: 1000 })
      await t.mutation(api.limits.reserveBudget, { authToken: secret, scope: 's', amount: 1, max: 10 })
    }
    expect(await t.run((ctx) => ctx.db.query('rateLimits').collect())).toMatchObject([{ key: 'k', count: 2 }])
    expect(await t.run((ctx) => ctx.db.query('budgets').collect())).toMatchObject([{ scope: 's', total: 3 }])
  })

  it('stamps windows with the server clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(5_000)
    const t = convexTest(schema, modules)
    await t.mutation(api.limits.consumeRate, { authToken: secret, key: 'k', limit: 1, windowMs: 1000 })
    expect(await t.run((ctx) => ctx.db.query('rateLimits').first())).toMatchObject({ windowStart: 5_000 })
  })
})
