import { afterEach, beforeEach, vi } from 'vitest'
import { convexTest } from 'convex-test'
import schema from './schema'
import { ConvexAnalysisStore, ConvexDatasetStore, ConvexLimitsStore, type ConvexFunctionClient } from '../src/server/convexStores'
import { analysisStorageContract, datasetStorageContract, limitsStorageContract } from '../src/server/storageContract'

const modules = (import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob('./**/*.ts')
const writeSecret = 'convex-store-contract-secret'

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = writeSecret
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_700_000_000_000)
})

afterEach(() => {
  vi.useRealTimers()
})

const harness = <S>(create: (client: ConvexFunctionClient, secret: string) => S) => () => {
  const t = convexTest(schema, modules)
  const client: ConvexFunctionClient = {
    query: (reference, args) => t.query(reference, args),
    mutation: (reference, args) => t.mutation(reference, args),
  }
  return { store: create(client, writeSecret), advance: (ms: number) => { vi.setSystemTime(Date.now() + ms) } }
}

analysisStorageContract('convex', harness((client, secret) => new ConvexAnalysisStore(client, secret)), { bulkRows: 5_000 })
datasetStorageContract('convex', harness((client, secret) => new ConvexDatasetStore(client, secret)))
limitsStorageContract('convex', harness((client, secret) => new ConvexLimitsStore(client, secret)))
