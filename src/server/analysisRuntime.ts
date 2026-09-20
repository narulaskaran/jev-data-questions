import { AnalysisError, AnalysisService, type AnalysisStorage } from './analysis.js'
import { ConvexAnalysisStore, ConvexDatasetStore } from './analysisStore.js'
import { OpenRouterDraftProvider, TypeSafeClassifierProvider } from './analysisProviders.js'
import { isConvexWriteConfigured, readConvexRuntimeConfig } from './liveConfig.js'
import { DatasetIntakeService, unconfiguredIntake } from './datasetIntake.js'
import { analysisSourceFromDatasetStore, type DatasetStorage } from './datasetStore.js'
import { createCsvBlobStore } from './uploadthing.js'

class UnconfiguredAnalysisStore implements AnalysisStorage {
  private unavailable(): never {
    throw new AnalysisError('ANALYSIS_STORAGE_NOT_CONFIGURED', 'Analysis storage is not configured', 503, true)
  }

  get(): never { return this.unavailable() }
  put(): never { return this.unavailable() }
  getPublic(): never { return this.unavailable() }
  findCompleteByContentKey(): never { return this.unavailable() }
  claimByContentKey(): never { return this.unavailable() }
  getDraftByContentKey(): never { return this.unavailable() }
  putDraft(): never { return this.unavailable() }
  claim(): never { return this.unavailable() }
  release(): never { return this.unavailable() }
  healStale(): never { return this.unavailable() }
}

class UnconfiguredDatasetStore implements DatasetStorage {
  private unavailable(): never {
    throw new AnalysisError('ANALYSIS_STORAGE_NOT_CONFIGURED', 'Analysis storage is not configured', 503, true)
  }

  get(): never { return this.unavailable() }
  put(): never { return this.unavailable() }
  getRows(): never { return this.unavailable() }
  listPublic(): never { return this.unavailable() }
}

const convex = readConvexRuntimeConfig()
const convexConfigured = isConvexWriteConfigured()
const storage: AnalysisStorage = convexConfigured && convex
  ? new ConvexAnalysisStore(convex.convexUrl, convex.writeSecret)
  : new UnconfiguredAnalysisStore()
const datasetStore: DatasetStorage = convexConfigured && convex
  ? new ConvexDatasetStore(convex.convexUrl, convex.writeSecret)
  : new UnconfiguredDatasetStore()

export const datasetIntake = convexConfigured
  ? new DatasetIntakeService({
    datasets: datasetStore,
    blobs: createCsvBlobStore(),
    convexConfigured: true,
  })
  : unconfiguredIntake()

/**
 * Production runtime: Convex is mandatory for reads, writes, claims, and
 * incremental snapshots. Missing deployment configuration fails closed rather
 * than falling back to a process-local store that would lose serverless state.
 * UploadThing is required for BYOD CSV blobs; the sample fixture does not need it.
 */
export const analysisService = new AnalysisService({
  store: storage,
  draftProvider: new OpenRouterDraftProvider(),
  classifier: new TypeSafeClassifierProvider(),
  datasets: analysisSourceFromDatasetStore(datasetStore),
})
