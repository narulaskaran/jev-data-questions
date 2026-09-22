import type { AnalysisResultRow } from '../shared/analysis'
import type { ChartVisualKind, JevQuestionKind } from '../shared/questionKind'
import type { PlayheadMotion } from './playhead'

export const barWidth = (count: number, scale: number): string => {
  if (count <= 0 || scale <= 0) return '0%'
  return `${(count / scale) * 100}%`
}

export const sameStringList = (left: readonly string[] = [], right: readonly string[] = []): boolean => (
  left === right || (left.length === right.length && left.every((value, index) => value === right[index]))
)

type ChartVisual = {
  rows: readonly AnalysisResultRow[]
  playheadIndex: number
  classes?: readonly string[]
  totalRows?: number
  motion?: PlayheadMotion
  questionKind?: JevQuestionKind
  chartKind?: ChartVisualKind
  playing?: boolean
  playbackEnabled?: boolean
  perspectiveLabel?: string
  compact?: boolean
  rankPlaces?: boolean
  heading?: string
  headingId?: string
  sourceRows?: readonly unknown[]
}

export const areChartPropsEqual = (prev: ChartVisual, next: ChartVisual): boolean => (
  prev.playheadIndex === next.playheadIndex
  && prev.motion === next.motion
  && prev.playing === next.playing
  && prev.playbackEnabled === next.playbackEnabled
  && prev.totalRows === next.totalRows
  && prev.rows.length === next.rows.length
  && prev.questionKind === next.questionKind
  && prev.chartKind === next.chartKind
  && prev.perspectiveLabel === next.perspectiveLabel
  && prev.compact === next.compact
  && prev.rankPlaces === next.rankPlaces
  && prev.heading === next.heading
  && prev.headingId === next.headingId
  && (prev.sourceRows?.length ?? 0) === (next.sourceRows?.length ?? 0)
  && sameStringList(prev.classes, next.classes)
  && prev.rows[prev.playheadIndex]?.selectedClass === next.rows[next.playheadIndex]?.selectedClass
  && prev.rows[prev.playheadIndex]?.value === next.rows[next.playheadIndex]?.value
  && prev.rows[prev.rows.length - 1]?.rowIndex === next.rows[next.rows.length - 1]?.rowIndex
  && prev.rows[prev.rows.length - 1]?.value === next.rows[next.rows.length - 1]?.value
)

type RailVisual = {
  rows: readonly AnalysisResultRow[]
  playheadIndex: number
  totalRows: number
  classes?: readonly string[]
  chartKind?: ChartVisualKind
  perspectiveLabel?: string
}

export const areRailPropsEqual = (prev: RailVisual, next: RailVisual): boolean => (
  prev.playheadIndex === next.playheadIndex
  && prev.totalRows === next.totalRows
  && prev.rows.length === next.rows.length
  && prev.chartKind === next.chartKind
  && prev.perspectiveLabel === next.perspectiveLabel
  && sameStringList(prev.classes, next.classes)
  && prev.rows[prev.playheadIndex]?.selectedClass === next.rows[next.playheadIndex]?.selectedClass
  && prev.rows[prev.playheadIndex]?.value === next.rows[next.playheadIndex]?.value
  && prev.rows[prev.rows.length - 1]?.rowIndex === next.rows[next.rows.length - 1]?.rowIndex
)
