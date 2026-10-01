import { InMemoryAnalysisStore, InMemoryDatasetStore, InMemoryLimitsStore } from './memoryStores'
import { analysisStorageContract, datasetStorageContract, limitsStorageContract } from './storageContract'

const harness = <S>(create: (now: () => number) => S) => () => {
  let clock = 1_700_000_000_000
  return { store: create(() => clock), advance: (ms: number) => { clock += ms } }
}

analysisStorageContract('in-memory', harness((now) => new InMemoryAnalysisStore(now)), { bulkRows: 5_000 })
datasetStorageContract('in-memory', harness((now) => new InMemoryDatasetStore(now)))
limitsStorageContract('in-memory', harness((now) => new InMemoryLimitsStore(now)))
