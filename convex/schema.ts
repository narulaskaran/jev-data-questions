import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const probabilityValidator = v.object({
  home: v.number(),
  away: v.number(),
  tie: v.number(),
})

const errorValidator = v.object({
  code: v.string(),
  retryable: v.boolean(),
  providerStatus: v.optional(v.number()),
})

const limitsValidator = v.object({
  cadenceMs: v.number(),
  rateWindowMs: v.number(),
  maxRequestsPerWindow: v.number(),
  maxRequests: v.number(),
  maxSpendCents: v.number(),
  estimatedCostCentsPerRequest: v.number(),
})

const analysisProgressValidator = v.object({
  completedRows: v.number(),
  totalRows: v.number(),
  completedCalls: v.number(),
  totalCalls: v.number(),
})

const analysisErrorValidator = v.object({
  code: v.string(),
  retryable: v.boolean(),
})

export default defineSchema({
  forecastRecords: defineTable({
    idempotencyKey: v.string(),
    gameId: v.string(),
    providerEventId: v.string(),
    providerPlayId: v.optional(v.string()),
    stateHash: v.string(),
    rawNormalizedState: v.any(),
    model: v.string(),
    status: v.union(v.literal('success'), v.literal('error'), v.literal('limited')),
    source: v.union(v.literal('live'), v.literal('mock'), v.literal('replay'), v.literal('stale')),
    requestedAt: v.string(),
    completedAt: v.string(),
    latencyMs: v.number(),
    choice: v.optional(v.union(v.literal('home'), v.literal('away'), v.literal('tie'))),
    probabilities: v.optional(probabilityValidator),
    confidence: v.optional(v.number()),
    error: v.optional(errorValidator),
  })
    .index('by_idempotency_key', ['idempotencyKey'])
    .index('by_game_requested_at', ['gameId', 'requestedAt']),
  forecastClaims: defineTable({
    idempotencyKey: v.string(),
    ownerToken: v.string(),
    leaseExpiresAt: v.number(),
  }).index('by_idempotency_key', ['idempotencyKey']),
  forecastBudgets: defineTable({
    budgetScope: v.string(),
    limits: limitsValidator,
    totalRequests: v.number(),
    totalSpendCents: v.number(),
    lastAttemptAtMs: v.optional(v.number()),
    activeReservationCount: v.number(),
    activeReservedCents: v.number(),
    recentAttempts: v.array(v.object({ atMs: v.number(), costCents: v.number() })),
    updatedAtMs: v.number(),
  }).index('by_scope', ['budgetScope']),
  forecastBudgetReservations: defineTable({
    budgetScope: v.string(),
    reservationId: v.string(),
    ownerToken: v.string(),
    reservedAtMs: v.number(),
    estimatedCostCents: v.number(),
    outcome: v.union(v.literal('pending'), v.literal('consumed'), v.literal('released')),
  })
    .index('by_reservation_id', ['reservationId'])
    .index('by_scope', ['budgetScope']),
  analyses: defineTable({
    analysisId: v.string(),
    fixtureId: v.string(),
    datasetId: v.optional(v.string()),
    sourceType: v.optional(v.union(v.literal('fixture'), v.literal('upload'), v.literal('public_url'))),
    query: v.string(),
    status: v.union(v.literal('queued'), v.literal('running'), v.literal('complete'), v.literal('error')),
    createdAt: v.string(),
    updatedAt: v.string(),
    progress: analysisProgressValidator,
    questionKind: v.optional(v.union(v.literal('noul'), v.literal('score'), v.literal('choice'))),
    classes: v.optional(v.array(v.string())),
    columns: v.optional(v.array(v.string())),
    currentFixtureRow: v.optional(v.any()),
    error: v.optional(analysisErrorValidator),
    runOwnerToken: v.optional(v.string()),
    runLeaseExpiresAt: v.optional(v.number()),
    contentKey: v.optional(v.string()),
  }).index('by_analysis_id', ['analysisId'])
    .index('by_content_key_status', ['contentKey', 'status']),
  analysisDrafts: defineTable({
    contentKey: v.string(),
    fixtureId: v.string(),
    datasetId: v.string(),
    sourceType: v.union(v.literal('fixture'), v.literal('upload'), v.literal('public_url')),
    query: v.string(),
    metadata: v.object({
      provider: v.string(),
      model: v.string(),
      rowCount: v.number(),
      classes: v.array(v.string()),
      columns: v.array(v.string()),
      displayName: v.string(),
      questionKind: v.optional(v.union(v.literal('noul'), v.literal('score'), v.literal('choice'))),
      inputHalf: v.optional(v.literal('H1')),
      labelHalf: v.optional(v.literal('H2')),
      cacheWrite: v.optional(v.union(v.literal('ok'), v.literal('skipped'))),
    }),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index('by_content_key', ['contentKey']),
  analysisDailyBudgets: defineTable({
    provider: v.union(v.literal('jev'), v.literal('openrouter')),
    day: v.string(),
    callsReserved: v.number(),
    dailyLimit: v.number(),
    updatedAtMs: v.number(),
  }).index('by_provider_day', ['provider', 'day']),
  analysisRows: defineTable({
    analysisId: v.string(),
    rowIndex: v.number(),
    input: v.any(),
    model: v.string(),
    selectedClass: v.optional(v.string()),
    probabilities: v.optional(v.any()),
    confidence: v.optional(v.number()),
    value: v.optional(v.number()),
    questionKind: v.optional(v.union(v.literal('noul'), v.literal('score'), v.literal('choice'))),
    error: v.optional(analysisErrorValidator),
  }).index('by_analysis_row', ['analysisId', 'rowIndex']),
  datasets: defineTable({
    datasetId: v.string(),
    sourceType: v.union(v.literal('fixture'), v.literal('upload'), v.literal('public_url')),
    displayName: v.string(),
    fixtureKey: v.optional(v.string()),
    blobKey: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    byteSize: v.number(),
    contentHash: v.string(),
    encoding: v.string(),
    delimiter: v.string(),
    columns: v.array(v.object({
      name: v.string(),
      normalizedName: v.string(),
      inferredType: v.string(),
    })),
    acceptedRowCount: v.number(),
    previewRows: v.array(v.any()),
    validationWarnings: v.array(v.string()),
    visibility: v.literal('published'),
    createdAt: v.number(),
    publishedAt: v.optional(v.number()),
  }).index('by_dataset_id', ['datasetId']),
  datasetRows: defineTable({
    datasetId: v.string(),
    rowIndex: v.number(),
    rowHash: v.string(),
    values: v.any(),
  }).index('by_dataset_row', ['datasetId', 'rowIndex']),
})
