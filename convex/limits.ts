import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { assertAuthorized } from './auth'

const MAX_KEY_LENGTH = 200

const check = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message)
}

export const consumeRate = mutation({
  args: { authToken: v.string(), key: v.string(), limit: v.number(), windowMs: v.number() },
  handler: async (ctx, { authToken, key, limit, windowMs }): Promise<{ allowed: boolean; retryAfterMs: number }> => {
    assertAuthorized(authToken)
    check(key.length > 0 && key.length <= MAX_KEY_LENGTH, 'Invalid key')
    check(Number.isInteger(limit) && limit >= 1, 'Invalid limit')
    check(Number.isFinite(windowMs) && windowMs > 0, 'Invalid window')
    const now = Date.now()
    const doc = await ctx.db.query('rateLimits').withIndex('by_key', (q) => q.eq('key', key)).unique()
    if (!doc) {
      await ctx.db.insert('rateLimits', { key, windowStart: now, count: 1 })
      return { allowed: true, retryAfterMs: 0 }
    }
    if (now - doc.windowStart >= windowMs) {
      await ctx.db.patch(doc._id, { windowStart: now, count: 1 })
      return { allowed: true, retryAfterMs: 0 }
    }
    if (doc.count >= limit) return { allowed: false, retryAfterMs: Math.max(1, doc.windowStart + windowMs - now) }
    await ctx.db.patch(doc._id, { count: doc.count + 1 })
    return { allowed: true, retryAfterMs: 0 }
  },
})

export const reserveBudget = mutation({
  args: { authToken: v.string(), scope: v.string(), amount: v.number(), max: v.number() },
  handler: async (ctx, { authToken, scope, amount, max }): Promise<{ allowed: boolean; remaining: number }> => {
    assertAuthorized(authToken)
    check(scope.length > 0 && scope.length <= MAX_KEY_LENGTH, 'Invalid scope')
    check(Number.isFinite(amount) && amount >= 0, 'Invalid amount')
    check(Number.isFinite(max) && max >= 0, 'Invalid max')
    const doc = await ctx.db.query('budgets').withIndex('by_scope', (q) => q.eq('scope', scope)).unique()
    const total = doc?.total ?? 0
    if (total + amount > max) return { allowed: false, remaining: max - total }
    if (doc) await ctx.db.patch(doc._id, { total: total + amount })
    else await ctx.db.insert('budgets', { scope, total: amount })
    return { allowed: true, remaining: max - (total + amount) }
  },
})
