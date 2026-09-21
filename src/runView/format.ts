import type { AnalysisResultRow, AnalysisStatus } from '../shared/analysis'
import { ANALYSIS_RUN_STALLED_CODE, ANALYSIS_STALL_AFTER_MS, progressAgeMs } from '../shared/analysis'
import type { DatasetSourceType } from '../shared/dataset'
import { INVALID_CLASSES_COPY, type ChartVisualKind, type JevQuestionKind } from '../shared/questionKind'
import { perspectiveMetricTitle, perspectivePercentLabel } from '../teamMetadata'
import { formatPercentTick } from './seriesPath'

export const SAMPLE_DATASET_ROW_COUNT = 71
export const SAMPLE_H1_ROW_COUNT = 39

export const runViewHeading = (): string => 'Results'

export const runProgressPercent = (
  completedRows: number,
  totalRows: number,
  status?: 'queued' | 'running' | 'complete' | 'error',
): number => {
  if (status === 'complete') return 100
  if (totalRows <= 0) return 0
  return Math.min(100, Math.round((completedRows / totalRows) * 100))
}

export const runProgressCount = (
  completedRows: number,
  totalRows: number,
  status?: 'queued' | 'running' | 'complete' | 'error',
): string => (
  status === 'complete' ? `${totalRows} of ${totalRows}` : `${completedRows} / ${totalRows}`
)

export const chartHeading = (
  kind: JevQuestionKind,
  visual?: ChartVisualKind,
  perspectiveLabel?: string,
): string => {
  if (visual === 'places') return 'Places'
  if (kind === 'noul') return perspectiveMetricTitle('win probability', perspectiveLabel)
  if (kind === 'score') return perspectiveMetricTitle(perspectiveLabel ? 'play quality' : 'Score', perspectiveLabel)
  return 'Class distribution'
}

export const seriesPlayStatus = (
  playNumber: number,
  value?: number,
  perspectiveLabel?: string,
): string => {
  if (value === undefined) return `Play ${playNumber}`
  return `Play ${playNumber} · ${perspectivePercentLabel(formatPercentTick(value), perspectiveLabel)}`
}

export const STILL_WORKING_COPY = 'Still working…'
export const STUCK_RUN_COPY = 'This run may be stuck — Resume or start again'

export const runStallCopy = (status: AnalysisStatus, updatedAt: string, nowMs: number): string | undefined => {
  if (status !== 'queued' && status !== 'running') return undefined
  if (progressAgeMs(updatedAt, nowMs) < ANALYSIS_STALL_AFTER_MS) return undefined
  return STILL_WORKING_COPY
}

export const ANALYSIS_ERROR_COPY: Record<string, string> = {
  INVALID_CLASSES: INVALID_CLASSES_COPY,
  JEV_MALFORMED_RESPONSE: 'Jev returned a response this run could not use.',
  MALFORMED_PROVIDER_RESPONSE: 'Jev returned a response this run could not use.',
  JEV_TIMEOUT: 'Jev timed out while classifying a row.',
  JEV_CONNECTION: 'Could not reach Jev.',
  ANALYSIS_PROVIDER_ERROR: 'Jev hit a provider error.',
  JEV_NOT_CONFIGURED: 'Jev is not configured on this deployment.',
  ANALYSIS_RUN_STALLED: STUCK_RUN_COPY,
  ANALYSIS_STORAGE_ERROR: 'Could not save analysis progress.',
}

export const plainAnalysisError = (code: string, fallback = 'This run hit an error.'): string => {
  if (ANALYSIS_ERROR_COPY[code]) return ANALYSIS_ERROR_COPY[code]
  if (/^JEV_\d+$/.test(code)) return 'Jev could not classify a row.'
  return fallback
}

export const runErrorHint = (retryable: boolean): string => (
  retryable ? 'You can try again.' : 'This run stopped.'
)

export const runErrorCopy = (
  error: { code: string; retryable: boolean },
  completedRows: number,
): { title: string; detail: string } => {
  const next = completedRows > 0
    ? `Saved rows are kept. You can resume from row ${completedRows + 1}.`
    : 'You can retry this run.'
  if (error.code === ANALYSIS_RUN_STALLED_CODE) {
    return { title: STUCK_RUN_COPY, detail: next }
  }
  const reason = plainAnalysisError(error.code)
  return { title: "Couldn't finish this run", detail: `${reason} ${next}` }
}

export const resumeRunLabel = (completedRows: number): string => (
  completedRows > 0 ? `Resume from row ${completedRows + 1}` : 'Retry'
)

export const savedRunCopy = (): string => ''

export const runSubsetCopy = ({
  analyzedRows,
  datasetRows,
  sourceType,
  inputHalf,
  tense = 'analyzing',
}: {
  analyzedRows: number
  datasetRows?: number
  sourceType?: DatasetSourceType
  inputHalf?: 'H1'
  tense?: 'analyzing' | 'analyzed'
}): string | undefined => {
  let rows = datasetRows
  if (sourceType === 'fixture' && analyzedRows === SAMPLE_H1_ROW_COUNT) {
    rows = rows ?? SAMPLE_DATASET_ROW_COUNT
  }
  if (!rows || analyzedRows < 1 || analyzedRows >= rows) return undefined
  const verb = tense === 'analyzed' ? 'Classified' : 'Classifying'
  if (inputHalf === 'H1') return `${verb} ${analyzedRows} of ${rows} rows (H1 plays).`
  return `${verb} ${analyzedRows} of ${rows} rows.`
}

export const percent = (value: number | undefined): string => (
  value === undefined ? '—' : `${Math.round(value * 100)}%`
)

export const cell = (value: unknown): string => (
  value === null || value === undefined || value === '' ? '—' : String(value)
)

const SKIP_META_KEYS = new Set(['wpa', 'epa', 'game_id', 'game_date'])

const isCompact = (value: unknown): value is string | number => {
  if (typeof value === 'number' && Number.isFinite(value)) return true
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 && trimmed.length <= 24
  }
  return false
}

export const railMetaLine = (
  row: AnalysisResultRow,
  chartKind: ChartVisualKind = 'bars',
  perspectiveLabel?: string,
): string => {
  const parts: string[] = []
  const playId = row.input.play_id
  const qtr = row.input.qtr
  if (isCompact(playId)) parts.push(String(playId))
  if (isCompact(qtr)) parts.push(`Q${qtr}`)
  if (parts.length === 0) {
    for (const [key, value] of Object.entries(row.input)) {
      if (SKIP_META_KEYS.has(key) || key === 'posteam' || !isCompact(value)) continue
      parts.push(String(value).trim())
      break
    }
  }
  if (chartKind === 'series' && row.value !== undefined) {
    parts.push(perspectivePercentLabel(percent(row.value), perspectiveLabel))
  } else if (chartKind === 'places' && row.value !== undefined) parts.push(percent(row.value))
  else if (row.selectedClass) parts.push(row.selectedClass)
  else if (row.value !== undefined) parts.push(percent(row.value))
  else if (chartKind === 'series' && perspectiveLabel) parts.push(perspectiveLabel)
  return parts.join(' · ')
}
