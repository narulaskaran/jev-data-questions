import { randomBytes } from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import type { AnalysisStorage, LimitsStorage } from '../shared/analysis.js'
import type { DatasetStorage } from '../shared/dataset.js'
import { AnalysisService } from './analysis.js'
import { readRuntimeConfig, type RuntimeConfig } from './config.js'
import { ConvexAnalysisStore, ConvexDatasetStore, ConvexLimitsStore, createConvexClient } from './convexStores.js'
import { DatasetService } from './datasets.js'
import { createApi, type ApiRequest, type ApiRuntime } from './http.js'
import { InMemoryAnalysisStore, InMemoryDatasetStore, InMemoryLimitsStore } from './memoryStores.js'
import { JevClassifier, MockClassifier, MockDraftProvider, OpenRouterDraftProvider, type Classifier, type DraftProvider } from './providers.js'

interface Stores {
  analyses: AnalysisStorage
  datasets: DatasetStorage
  limits: LimitsStorage
}

/**
 * Durable storage is Convex. Without it everything except the sample preview
 * fails closed. Process-local stores exist only for one local dev process and
 * are never selected on Vercel, where each invocation may be a new instance.
 */
const createStores = (config: RuntimeConfig): Stores | undefined => {
  if (config.convex) {
    const client = createConvexClient(config.convex.url)
    return {
      analyses: new ConvexAnalysisStore(client, config.convex.writeSecret),
      datasets: new ConvexDatasetStore(client, config.convex.writeSecret),
      limits: new ConvexLimitsStore(client, config.convex.writeSecret),
    }
  }
  if (config.localStorage) {
    return { analyses: new InMemoryAnalysisStore(), datasets: new InMemoryDatasetStore(), limits: new InMemoryLimitsStore() }
  }
  return undefined
}

const createDraftProvider = (config: RuntimeConfig): DraftProvider | undefined => {
  if (config.openRouterKey) return new OpenRouterDraftProvider({ apiKey: config.openRouterKey, model: config.openRouterModel })
  return config.allowMock ? new MockDraftProvider() : undefined
}

const createClassifier = (config: RuntimeConfig): Classifier | undefined => {
  if (config.jevApiKey) return new JevClassifier({ apiKey: config.jevApiKey, baseURL: config.jevBaseUrl })
  return config.allowMock ? new MockClassifier() : undefined
}

const header = (request: ApiRequest, name: string): string | undefined => {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * Where this deployment can reach itself to hand a long run to a fresh
 * invocation. The Host header is only trusted off Vercel (local dev), so a
 * forged Host can never receive a continuation token.
 */
const selfOrigin = (request: ApiRequest, env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const explicit = env.JEV_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '')
  if (explicit && /^https?:\/\/[^\s/]+$/.test(explicit)) return explicit
  if (env.VERCEL) {
    const host = env.VERCEL_ENV === 'production' ? env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL : env.VERCEL_URL
    return host ? `https://${host}` : undefined
  }
  const host = header(request, 'host')
  return host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? `http://${host}` : undefined
}

export const createRuntime = (env: NodeJS.ProcessEnv = process.env): ApiRuntime => {
  const config = readRuntimeConfig(env)
  const stores = createStores(config)
  const datasets = new DatasetService({ store: stores?.datasets })
  const analysis = new AnalysisService({
    store: stores?.analyses,
    limits: stores?.limits,
    datasets,
    draftProvider: createDraftProvider(config),
    classifier: createClassifier(config),
    config,
  })
  return {
    config,
    datasets,
    analysis,
    limits: stores?.limits,
    internalSecret: config.convex?.writeSecret ?? randomBytes(32).toString('hex'),
    // The promise is already running; waitUntil only keeps a Vercel invocation alive for it.
    schedule: (task) => { waitUntil(task) },
    selfOrigin: (request) => selfOrigin(request, env),
  }
}

export const api = createApi(createRuntime())
