import { ConvexHttpClient } from 'convex/browser'
import { api } from './convexGenerated.js'
import { DatasetError } from '../dataset/csvTypes.js'
import {
  cloneAnalysisSnapshot,
  normalizeSnapshot,
  ANALYSIS_MAX_DAILY_DRAFT_BUDGET,
  type AnalysisDraftResult,
  type AnalysisRowInput,
  type AnalysisSnapshot,
  type AnalysisStorage,
} from '../shared/analysis.js'
import type { DatasetRecord } from '../shared/dataset.js'
import { toConvexDatasetPutArgs, wrapConvexPutError } from './convexDatasetPut.js'
import { analysisContentKeyFromSnapshot } from './analysisContentKey.js'
import { type DatasetStorage } from './datasetStore.js'
import { AnalysisError } from './analysis.js'
import { ANALYSIS_MAX_DAILY_CALL_BUDGET } from '../shared/analysis.js'

/**
 * Server-only durable analysis boundary. Authenticated actions are used for
 * writes and private readbacks; the share query returns the already-bounded
 * public snapshot and never starts execution.
 */
export class ConvexAnalysisStore implements AnalysisStorage {
  readonly client: ConvexHttpClient
  private readonly writeSecret?: string
  private readonly dailyCallBudget?: number
  private readonly dailyDraftBudget?: number

  constructor(convexUrl: string, writeSecret?: string, client = new ConvexHttpClient(convexUrl), dailyCallBudget?: number, dailyDraftBudget?: number) {
    this.client = client
    this.writeSecret = writeSecret?.trim() || undefined
    this.dailyCallBudget = Number.isInteger(dailyCallBudget) && dailyCallBudget! >= 1 && dailyCallBudget! <= ANALYSIS_MAX_DAILY_CALL_BUDGET
      ? dailyCallBudget
      : undefined
    this.dailyDraftBudget = Number.isInteger(dailyDraftBudget) && dailyDraftBudget! >= 1 && dailyDraftBudget! <= ANALYSIS_MAX_DAILY_DRAFT_BUDGET
      ? dailyDraftBudget
      : undefined
  }

  private authToken(): string {
    if (!this.writeSecret) throw new Error('Convex write authorization is not configured')
    return this.writeSecret
  }

  hasCallBudget(): boolean {
    return !!this.writeSecret && this.dailyCallBudget !== undefined
  }

  async reserveCall(): Promise<void> {
    if (!this.hasCallBudget()) throw new AnalysisError('ANALYSIS_BUDGET_NOT_CONFIGURED', 'Paid analysis is unavailable until the daily Jev call budget is configured.', 503, false)
    await this.reserveDailyProviderCall('jev', this.dailyCallBudget!, 'ANALYSIS_DAILY_BUDGET_EXHAUSTED', 'The daily Jev call budget has been reached. Try again after the budget resets.')
  }

  hasDraftBudget(): boolean {
    return !!this.writeSecret && this.dailyDraftBudget !== undefined
  }

  async reserveDraftCall(): Promise<void> {
    if (!this.hasDraftBudget()) throw new AnalysisError('ANALYSIS_DRAFT_BUDGET_NOT_CONFIGURED', 'OpenRouter generation is unavailable until the daily draft budget is configured.', 503, false)
    await this.reserveDailyProviderCall('openrouter', this.dailyDraftBudget!, 'ANALYSIS_DAILY_DRAFT_BUDGET_EXHAUSTED', 'The daily OpenRouter generation budget has been reached. Try again after the budget resets.')
  }

  private async reserveDailyProviderCall(provider: 'jev' | 'openrouter', dailyLimit: number, code: string, message: string): Promise<void> {
    const result = await this.client.action(api.analyses.authorizedReserveAnalysisCall, {
      authToken: this.authToken(),
      provider,
      dailyLimit,
    }) as { allowed?: boolean }
    if (result?.allowed !== true) {
      throw new AnalysisError(code, message, 429, true)
    }
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
