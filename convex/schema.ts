import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// User-controlled strings (CSV headers, class names) are only ever stored as values, never as field names.
export const rowValueValidator = v.union(v.string(), v.number(), v.boolean(), v.null())
export const rowValuesValidator = v.array(rowValueValidator)
export const rowErrorValidator = v.object({ code: v.string(), retryable: v.boolean() })
export const sourceTypeValidator = v.union(v.literal('sample'), v.literal('upload'), v.literal('public_url'))
export const analysisStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('complete'),
  v.literal('error'),
  v.literal('cancelled'),
)
export const analysisClassValidator = v.object({ name: v.string(), description: v.string() })
export const analysisProgressValidator = v.object({
  totalRows: v.number(),
  completedRows: v.number(),
  failedRows: v.number(),
})
export const datasetColumnValidator = v.object({
  name: v.string(),
  inferredType: v.union(v.literal('string'), v.literal('number'), v.literal('boolean'), v.literal('empty')),
})

export const analysisMetaFields = {
  analysisId: v.string(),
  datasetId: v.string(),
  datasetName: v.string(),
  sourceType: sourceTypeValidator,
  query: v.string(),
  classes: v.array(analysisClassValidator),
  columns: v.array(v.string()),
  labelColumn: v.optional(v.string()),
  status: analysisStatusValidator,
  mode: v.union(v.literal('live'), v.literal('mock')),
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  progress: analysisProgressValidator,
  error: v.optional(rowErrorValidator),
}

export const analysisRowFields = {
  rowIndex: v.number(),
  model: v.string(),
  selectedClass: v.optional(v.string()),
  probabilities: v.optional(v.array(v.number())),
  confidence: v.optional(v.number()),
  latencyMs: v.optional(v.number()),
  error: v.optional(rowErrorValidator),
}

export const datasetRecordFields = {
  datasetId: v.string(),
  sourceType: sourceTypeValidator,
  displayName: v.string(),
  byteSize: v.number(),
  contentHash: v.string(),
  delimiter: v.string(),
  columns: v.array(datasetColumnValidator),
  acceptedRowCount: v.number(),
  previewRows: v.array(rowValuesValidator),
  validationWarnings: v.array(v.string()),
  sourceUrl: v.optional(v.string()),
  createdAt: v.number(),
}

export default defineSchema({
  analyses: defineTable({
    ...analysisMetaFields,
    controlTokenHash: v.string(),
    runOwnerToken: v.optional(v.string()),
    runLeaseExpiresAt: v.optional(v.number()),
  })
    .index('by_analysis_id', ['analysisId'])
    .index('by_created_at', ['createdAt']),
  analysisRows: defineTable({
    analysisId: v.string(),
    ...analysisRowFields,
  }).index('by_analysis_row', ['analysisId', 'rowIndex']),
  datasets: defineTable({
    ...datasetRecordFields,
    ready: v.boolean(),
  })
    .index('by_dataset_id', ['datasetId'])
    .index('by_ready_created_at', ['ready', 'createdAt']),
  datasetChunks: defineTable({
    datasetId: v.string(),
    startIndex: v.number(),
    rows: v.array(rowValuesValidator),
  }).index('by_dataset_start', ['datasetId', 'startIndex']),
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index('by_key', ['key']),
  budgets: defineTable({
    scope: v.string(),
    total: v.number(),
  }).index('by_scope', ['scope']),
})
