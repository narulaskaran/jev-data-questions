import { ConvexHttpClient } from 'convex/browser'
import { api } from './convexGenerated.js'
import type {
  AnalysisAppendResult,
  AnalysisClaimResult,
  AnalysisMeta,
  AnalysisRecord,
  AnalysisResultRow,
  AnalysisRowError,
  AnalysisStorage,
  LimitsStorage,
} from '../shared/analysis.js'
import type { DatasetRecord, DatasetRowValues, DatasetStorage } from '../shared/dataset.js'

/** The slice of a Convex client the stores need. `ConvexHttpClient` and convex-test adapters fit. */
export interface ConvexFunctionClient {
  query(reference: any, args: Record<string, unknown>): Promise<any>
  mutation(reference: any, args: Record<string, unknown>): Promise<any>
}

export const createConvexClient = (convexUrl: string): ConvexFunctionClient => {
  const client = new ConvexHttpClient(convexUrl)
  return {
    query: (reference, args) => client.query(reference, args),
    mutation: (reference, args) => client.mutation(reference, args),
  }
}

const MAX_CHUNK_ROWS = 200
const MAX_CHUNK_BYTES = 400_000
const MAX_CALL_BYTES = 2_000_000
const MAX_CALL_CHUNKS = 32

// Convex rejects `undefined` inside arguments; JSON drops those fields.
const strip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

abstract class ConvexStoreBase {
  constructor(protected readonly client: ConvexFunctionClient, private readonly writeSecret: string) {}

  protected get authToken(): string {
    if (!this.writeSecret) throw new Error('Convex write authorization is not configured')
    return this.writeSecret
  }
}

export class ConvexAnalysisStore extends ConvexStoreBase implements AnalysisStorage {
  async create(record: AnalysisRecord): Promise<'created' | 'exists'> {
    return this.client.mutation(api.analyses.create, { authToken: this.authToken, record: strip(record) })
  }

  async getRecord(analysisId: string): Promise<AnalysisRecord | undefined> {
    return (await this.client.query(api.analyses.getRecord, { authToken: this.authToken, analysisId })) ?? undefined
  }

  async readPage(analysisId: string, after: number, limit: number): Promise<{ analysis: AnalysisMeta; rows: AnalysisResultRow[] } | undefined> {
    return (await this.client.query(api.analyses.readPage, { analysisId, after, limit })) ?? undefined
  }

  async claim(analysisId: string, ownerToken: string, leaseMs: number): Promise<AnalysisClaimResult> {
    return this.client.mutation(api.analyses.claim, { authToken: this.authToken, analysisId, ownerToken, leaseMs })
  }

  async append(analysisId: string, ownerToken: string, rows: readonly AnalysisResultRow[], leaseMs: number): Promise<AnalysisAppendResult> {
    return this.client.mutation(api.analyses.append, { authToken: this.authToken, analysisId, ownerToken, rows: strip([...rows]), leaseMs })
  }

  async finish(
    analysisId: string,
    ownerToken: string,
    outcome: { status: 'complete' } | { status: 'error'; error: AnalysisRowError } | { status: 'yield' },
  ): Promise<void> {
    await this.client.mutation(api.analyses.finish, { authToken: this.authToken, analysisId, ownerToken, outcome: strip(outcome) })
  }

  async cancel(analysisId: string): Promise<boolean> {
    return this.client.mutation(api.analyses.cancel, { authToken: this.authToken, analysisId })
  }

  async listRecent(limit: number): Promise<AnalysisMeta[]> {
    return this.client.query(api.analyses.listRecent, { limit })
  }
}

interface Chunk {
  startIndex: number
  rows: DatasetRowValues[]
  bytes: number
}

/** Greedy chunking: at most MAX_CHUNK_ROWS rows and MAX_CHUNK_BYTES of JSON; an oversized row gets its own chunk. */
export const chunkRows = (rows: readonly DatasetRowValues[]): Chunk[] => {
  const chunks: Chunk[] = []
  let current: Chunk | undefined
  rows.forEach((row, index) => {
    const bytes = Buffer.byteLength(JSON.stringify(row)) + 1
    if (!current || current.rows.length >= MAX_CHUNK_ROWS || current.bytes + bytes > MAX_CHUNK_BYTES) {
      current = { startIndex: index, rows: [], bytes: 0 }
      chunks.push(current)
    }
    current.rows.push(row)
    current.bytes += bytes
  })
  return chunks
}

export class ConvexDatasetStore extends ConvexStoreBase implements DatasetStorage {
  async put(record: DatasetRecord, rows: readonly DatasetRowValues[]): Promise<void> {
    const created = await this.client.mutation(api.datasets.createDataset, { authToken: this.authToken, record: strip(record) })
    if (created === 'exists') return
    let batch: Chunk[] = []
    let batchBytes = 0
    const flush = async () => {
      if (batch.length === 0) return
      await this.client.mutation(api.datasets.appendDatasetChunk, {
        authToken: this.authToken,
        datasetId: record.datasetId,
        chunks: batch.map(({ startIndex, rows: chunk }) => ({ startIndex, rows: chunk })),
      })
      batch = []
      batchBytes = 0
    }
    for (const chunk of chunkRows(rows)) {
      if (batch.length > 0 && (batch.length >= MAX_CALL_CHUNKS || batchBytes + chunk.bytes > MAX_CALL_BYTES)) await flush()
      batch.push(chunk)
      batchBytes += chunk.bytes
    }
    await flush()
    await this.client.mutation(api.datasets.finalizeDataset, { authToken: this.authToken, datasetId: record.datasetId })
  }

  async get(datasetId: string): Promise<DatasetRecord | undefined> {
    return (await this.client.query(api.datasets.get, { datasetId })) ?? undefined
  }

  async getRows(datasetId: string, offset: number, limit: number): Promise<DatasetRowValues[]> {
    return this.client.query(api.datasets.getRows, { datasetId, offset, limit })
  }

  async listRecent(limit: number): Promise<DatasetRecord[]> {
    return this.client.query(api.datasets.listRecent, { limit })
  }
}

export class ConvexLimitsStore extends ConvexStoreBase implements LimitsStorage {
  async consumeRate(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterMs: number }> {
    return this.client.mutation(api.limits.consumeRate, { authToken: this.authToken, key, limit, windowMs })
  }

  async reserveBudget(scope: string, amount: number, max: number): Promise<{ allowed: boolean; remaining: number }> {
    return this.client.mutation(api.limits.reserveBudget, { authToken: this.authToken, scope, amount, max })
  }
}
