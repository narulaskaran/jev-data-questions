import { ConvexHttpClient } from 'convex/browser'
import { api } from './convexGenerated.js'
import { DatasetError } from '../dataset/csvTypes.js'
import {
  cloneAnalysisSnapshot,
  normalizeSnapshot,
  type AnalysisDraftResult,
  type AnalysisRowInput,
  type AnalysisSnapshot,
  type AnalysisStorage,
} from '../shared/analysis.js'
import type { DatasetRecord } from '../shared/dataset.js'
import { toConvexDatasetPutArgs, wrapConvexPutError } from './convexDatasetPut.js'
import { analysisContentKeyFromSnapshot } from './analysisContentKey.js'
import { type DatasetStorage } from './datasetStore.js'

/**
 * Server-only durable analysis boundary. Authenticated actions are used for
 * writes and private readbacks; the share query returns the already-bounded
 * public snapshot and never starts execution.
 */
export class ConvexAnalysisStore implements AnalysisStorage {
  readonly client: ConvexHttpClient
  private readonly writeSecret?: string

  constructor(convexUrl: string, writeSecret?: string, client = new ConvexHttpClient(convexUrl)) {
    this.client = client
    this.writeSecret = writeSecret?.trim() || undefined
  }

  private authToken(): string {
    if (!this.writeSecret) throw new Error('Convex write authorization is not configured')
    return this.writeSecret
  }

  async get(analysisId: string): Promise<AnalysisSnapshot | undefined> {
    const healed = await this.healStale(analysisId, Date.now())
    if (healed) return healed
    const snapshot = await this.client.action(api.analyses.authorizedGetAnalysis, { authToken: this.authToken(), analysisId }) as AnalysisSnapshot | null
    return snapshot ? cloneAnalysisSnapshot(normalizeSnapshot(snapshot)) : undefined
  }

  async getPublic(analysisId: string): Promise<AnalysisSnapshot | undefined> {
    const healed = await this.healStale(analysisId, Date.now())
    if (healed) return healed
    const snapshot = await this.client.query(api.analyses.getAnalysisShareSnapshot, { analysisId }) as AnalysisSnapshot | null
    return snapshot ? cloneAnalysisSnapshot(normalizeSnapshot(snapshot)) : undefined
  }

  async findCompleteByContentKey(contentKey: string): Promise<AnalysisSnapshot | undefined> {
    const snapshot = await this.client.action(api.analyses.authorizedGetCompleteAnalysisByContentKey, { authToken: this.authToken(), contentKey }) as AnalysisSnapshot | null
    return snapshot ? cloneAnalysisSnapshot(normalizeSnapshot(snapshot)) : undefined
  }

  async claimByContentKey(contentKey: string, snapshot: AnalysisSnapshot): Promise<AnalysisSnapshot> {
    const claimed = await this.client.action(api.analyses.authorizedClaimAnalysisByContentKey, {
      authToken: this.authToken(),
      contentKey,
      snapshot: { ...snapshot, contentKey: contentKey || analysisContentKeyFromSnapshot(snapshot) },
    }) as AnalysisSnapshot
    return cloneAnalysisSnapshot(normalizeSnapshot(claimed))
  }

  async getDraftByContentKey(contentKey: string): Promise<AnalysisDraftResult | undefined> {
    const draft = await this.client.action(api.analyses.authorizedGetDraftByContentKey, { authToken: this.authToken(), contentKey }) as AnalysisDraftResult | null
    return draft ? JSON.parse(JSON.stringify(draft)) as AnalysisDraftResult : undefined
  }

  async putDraft(contentKey: string, draft: AnalysisDraftResult): Promise<void> {
    await this.client.action(api.analyses.authorizedPutDraft, { authToken: this.authToken(), contentKey, draft })
  }

  async put(snapshot: AnalysisSnapshot): Promise<void> {
    await this.client.action(api.analyses.authorizedPutAnalysisSnapshot, {
      authToken: this.authToken(),
      snapshot: { ...snapshot, contentKey: analysisContentKeyFromSnapshot(snapshot) },
    })
  }

  async claim(analysisId: string, ownerToken: string, nowMs: number, leaseMs: number): Promise<'claimed' | 'busy' | 'complete' | 'missing' | 'error'> {
    return await this.client.action(api.analyses.authorizedClaimAnalysis, { authToken: this.authToken(), analysisId, ownerToken, nowMs, leaseMs }) as 'claimed' | 'busy' | 'complete' | 'missing' | 'error'
  }

  async release(analysisId: string, ownerToken: string): Promise<void> {
    await this.client.action(api.analyses.authorizedReleaseAnalysis, { authToken: this.authToken(), analysisId, ownerToken })
  }

  async healStale(analysisId: string, nowMs: number): Promise<AnalysisSnapshot | undefined> {
    const snapshot = await this.client.action(api.analyses.authorizedHealStaleAnalysis, { authToken: this.authToken(), analysisId, nowMs }) as AnalysisSnapshot | null
    return snapshot ? cloneAnalysisSnapshot(normalizeSnapshot(snapshot)) : undefined
  }
}

export class ConvexDatasetStore implements DatasetStorage {
  readonly client: ConvexHttpClient
  private readonly writeSecret?: string

  constructor(convexUrl: string, writeSecret?: string, client = new ConvexHttpClient(convexUrl)) {
    this.client = client
    this.writeSecret = writeSecret?.trim() || undefined
  }

  private authToken(): string {
    if (!this.writeSecret) {
      throw new DatasetError('DATASET_INTAKE_UNAVAILABLE', 'Convex write authorization is not configured.', 503, 'CONVEX_PUT_FAILED')
    }
    return this.writeSecret
  }

  async get(datasetId: string): Promise<DatasetRecord | undefined> {
    const dataset = await this.client.action(api.datasets.authorizedGetDataset, { authToken: this.authToken(), datasetId }) as DatasetRecord | null
    return dataset ?? undefined
  }

  async put(dataset: DatasetRecord, rows: readonly AnalysisRowInput[]): Promise<void> {
    try {
      await this.client.action(api.datasets.authorizedPutDataset, {
        authToken: this.authToken(),
        ...toConvexDatasetPutArgs(dataset, rows),
      })
    } catch (error) {
      wrapConvexPutError(error)
    }
  }

  async getRows(datasetId: string): Promise<readonly AnalysisRowInput[]> {
    const rows = await this.client.action(api.datasets.authorizedGetDatasetRows, { authToken: this.authToken(), datasetId }) as AnalysisRowInput[] | null
    return rows ?? []
  }

  async listPublic(): Promise<readonly DatasetRecord[]> {
    const items = await this.client.query(api.datasets.listPublicDatasets, {}) as Array<Pick<DatasetRecord, 'datasetId' | 'displayName' | 'sourceType' | 'acceptedRowCount' | 'createdAt'>>
    return items.map((item) => ({
      datasetId: item.datasetId,
      sourceType: item.sourceType,
      displayName: item.displayName,
      byteSize: 0,
      contentHash: '',
      encoding: 'utf-8',
      delimiter: ',',
      columns: [],
      acceptedRowCount: item.acceptedRowCount,
      previewRows: [],
      validationWarnings: [],
      publicDataWarning: 'This playground publishes datasets and results. Do not upload secrets or personal data.',
      visibility: 'published',
      createdAt: item.createdAt,
    }))
  }
}
