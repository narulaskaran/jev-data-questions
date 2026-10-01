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

const sameRows = (left: readonly AnalysisResultRow[], right: readonly AnalysisResultRow[]): boolean => (
  left === right || (left.length === right.length && left.every((row, index) => {
    const other = right[index]
    if (!other) return false
    return row.rowIndex === other.rowIndex
      && row.input === other.input
      && row.selectedClass === other.selectedClass
      && row.value === other.value
  }))
)

const sameSourceRows = (left: readonly unknown[] = [], right: readonly unknown[] = []): boolean => (
  left === right || (left.length === right.length && left.every((row, index) => row === right[index]))
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
  banded?: boolean
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
  && prev.banded === next.banded
  && prev.heading === next.heading
  && prev.headingId === next.headingId
  && sameSourceRows(prev.sourceRows, next.sourceRows)
  && sameStringList(prev.classes, next.classes)
  && sameRows(prev.rows, next.rows)
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
  && sameRows(prev.rows, next.rows)
)
