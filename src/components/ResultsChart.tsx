import { memo, useCallback, useMemo, useRef, type CSSProperties, type PointerEvent, type SyntheticEvent } from 'react'
import { classDistribution, distributionAt } from '../dataset/classDistribution'
import { classColor } from '../runView/classColor'
import { areChartPropsEqual, barWidth } from '../runView/chartProps'
import { clampPlayhead, playDomainCount, playIndexFromRatio, type PlayheadMotion } from '../runView/playhead'
import { areaPath, jevSeriesPoints, linePath, seriesExtent, seriesX } from '../runView/seriesPath'
import { normalizePoints, placeCentroids, projectPlaces } from '../runView/places'
import { chartVisualFor, inferQuestionKind, type ChartVisualKind, type JevQuestionKind } from '../shared/questionKind'
import type { AnalysisResultRow, AnalysisRowInput } from '../shared/analysis'
import { chartHeading, seriesPlayStatus } from '../runView/format'
import { Button } from './ui/button'

const EMPTY_CLASSES: readonly string[] = []

const ClassBar = memo(function ClassBar({
  name,
  count,
  scale,
  color,
}: {
  name: string
  count: number
  scale: number
  color: string
}) {
  return (
    <div className="distribution-row" data-class={name} data-count={count}>
      <div className="distribution-label">
        <span>{name}</span>
        <b>{count}</b>
      </div>
      <div className="distribution-track">
        <span
          style={{
            '--bar-width': barWidth(count, scale),
            '--bar-color': color,
          } as CSSProperties}
        />
      </div>
    </div>
  )
})

export const ResultsChart = memo(function ResultsChart({
  rows,
  playheadIndex,
  classes = EMPTY_CLASSES,
  totalRows = 0,
  motion = 'tick',
  questionKind,
  chartKind,
  playing = false,
  playbackEnabled = false,
  sourceRows,
  perspectiveLabel,
  compact = false,
  rankPlaces = false,
  heading: headingOverride,
  headingId = 'distribution-heading',
  onSeek,
  onTogglePlayback,
}: {
  rows: readonly AnalysisResultRow[]
  playheadIndex: number
  classes?: readonly string[]
  totalRows?: number
  motion?: PlayheadMotion
  questionKind?: JevQuestionKind
  chartKind?: ChartVisualKind
  playing?: boolean
  playbackEnabled?: boolean
  sourceRows?: readonly AnalysisRowInput[]
  perspectiveLabel?: string
  compact?: boolean
  rankPlaces?: boolean
  heading?: string
  headingId?: string
  onSeek: (index: number, phase?: 'scrub' | 'release') => void
  onTogglePlayback?: () => void
}) {
  const plotRef = useRef<HTMLDivElement>(null)
  const completedCount = rows.length
  const domainCount = playDomainCount(totalRows, completedCount)
  const prefixCount = completedCount === 0 ? 0 : playheadIndex + 1
  const kind = questionKind
    ?? rows.find((row) => row.questionKind)?.questionKind
    ?? inferQuestionKind('', classes)
  const visual = chartKind ?? chartVisualFor(kind)
  const values = useMemo(
    () => (visual === 'bars' ? (completedCount === 0 ? classDistribution([], classes) : distributionAt(rows, prefixCount, classes)) : []),
    [classes, completedCount, prefixCount, rows, visual],
  )
  const series = useMemo(
    () => (visual === 'series' ? jevSeriesPoints(rows, prefixCount, domainCount) : []),
    [domainCount, prefixCount, rows, visual],
  )
  const classified = visual === 'bars' ? values.reduce((sum, item) => sum + item.count, 0) : series.length
  const scale = Math.max(totalRows, classified, 1)
  const heading = headingOverride ?? chartHeading(kind, visual, perspectiveLabel)
  const placeRows = useMemo(() => {
    if (visual !== 'places' && !rankPlaces) return []
    if (rows.length > 0) return rows
    return (sourceRows ?? []).map((input, rowIndex) => ({ rowIndex, input, model: 'dataset' }))
  }, [rankPlaces, rows, sourceRows, visual])
  const places = useMemo(
    () => ((visual === 'places' || rankPlaces) ? projectPlaces(placeRows) : { points: [], ranks: [], hasMap: false }),
    [placeRows, rankPlaces, visual],
  )
  const mapPoints = useMemo(
    () => (places.hasMap ? normalizePoints(places.points) : []),
    [places.hasMap, places.points],
  )
  const labels = useMemo(() => placeCentroids(mapPoints), [mapPoints])
  const eatingDots = mapPoints.filter((point) => point.weight >= 0.5).length
  const otherDots = mapPoints.length - eatingDots
  const rankScale = Math.max(...places.ranks.map((entry) => entry.eating || entry.count), 1)
  const waiting = visual === 'places' || rankPlaces
    ? placeRows.length === 0
    : classified === 0
  const playheadValue = series.find((point) => point.rowIndex === playheadIndex)?.yValue
  const eatingSummary = places.ranks
    .map((item) => `${item.name} ${item.eating}`)
    .join(' · ')
  const latestLabel = completedCount === 0
    ? (visual === 'places' && placeRows.length > 0
      ? (eatingSummary || `${placeRows.length} places`)
      : rankPlaces && places.ranks.length > 0
        ? eatingSummary
        : 'Waiting')
    : visual === 'series'
      ? seriesPlayStatus(prefixCount, playheadValue, perspectiveLabel)
      : visual === 'places'
        ? (eatingSummary || `${placeRows.length} places`)
        : rankPlaces
          ? eatingSummary
          : `Through row ${prefixCount}`
  const aria = waiting
    ? 'Waiting for the first row'
    : visual === 'series'
      ? `${heading} over ${headingOverride && !perspectiveLabel ? 'each row' : 'play index'}`
      : visual === 'places'
        ? (places.hasMap ? 'Map of where they are eating, with counts per place' : 'Eating count by place')
        : rankPlaces
          ? 'Eating count by place'
          : 'Class distribution visualization'

  const indexFromClientX = useCallback((clientX: number) => {
    const node = plotRef.current
    if (!node || completedCount === 0) return 0
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0) return 0
    const t = (clientX - rect.left) / rect.width
    return playIndexFromRatio(t, totalRows, completedCount)
  }, [completedCount, totalRows])

  const emitSeek = (index: number, phase?: 'scrub' | 'release') => {
    onSeek(clampPlayhead(index, completedCount), phase)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (completedCount === 0 || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    emitSeek(indexFromClientX(event.clientX), 'scrub')
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (completedCount === 0 || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    emitSeek(indexFromClientX(event.clientX), 'scrub')
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (completedCount === 0 || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    emitSeek(indexFromClientX(event.clientX), 'release')
  }

  const handleRange = (event: SyntheticEvent<HTMLInputElement>) => {
    emitSeek(Number(event.currentTarget.value), 'scrub')
  }

  const handleRangeCommit = (event: SyntheticEvent<HTMLInputElement>) => {
    emitSeek(Number(event.currentTarget.value), 'release')
  }

  const cursorX = seriesX(playheadIndex, domainCount)
  const extent = visual === 'series' ? seriesExtent(series, domainCount) : 1

  return (
    <section
      className={`distribution-card chart-hero${compact ? ' is-compact' : ''}`}
      aria-labelledby={compact ? undefined : headingId}
      aria-label={compact ? aria : undefined}
    >
      {compact ? null : (
      <div className="section-heading">
        <div>
          <p className="eyebrow">Live chart</p>
          <h3 id={headingId}>{heading}</h3>
        </div>
        <span className="table-count">{latestLabel}</span>
      </div>
      )}
      <div
        className="chart-shell"
        data-motion={motion}
        data-waiting={waiting ? 'true' : 'false'}
        data-chart-kind={visual}
        data-rank-places={rankPlaces ? 'true' : undefined}
        role="img"
        aria-label={aria}
      >
        <div
          ref={plotRef}
          className="chart-plot"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {visual !== 'places' && !rankPlaces ? (
            <div className="chart-axes" aria-hidden="true">
              <span className="chart-y-axis" />
              <span className="chart-x-axis" />
            </div>
          ) : null}
          {visual === 'series' ? (
            <div className="chart-y-ticks" aria-hidden="true">
              <span>100%</span>
              <span>50%</span>
              <span>0%</span>
            </div>
          ) : null}
          {waiting && !compact ? <p className="chart-empty">Waiting for the first row…</p> : null}
          {visual === 'series' && series.length > 0 ? (
            <svg
              className="series-svg"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              data-series-points={series.length}
              data-series-extent={extent}
              style={{ '--series-extent': String(extent) } as CSSProperties}
            >
              <path className="series-fill" d={areaPath(series)} />
              <path className="series-line" d={linePath(series)} />
              <line className="series-cursor" data-play-cursor="true" x1={cursorX} x2={cursorX} y1="0" y2="1" />
            </svg>
          ) : null}
          {visual === 'bars' && !rankPlaces && values.length > 0 ? (
            <div className="distribution-chart" data-waiting={waiting ? 'true' : 'false'}>
              {values.map(({ name, count }) => (
                <ClassBar
                  key={name}
                  name={name}
                  count={count}
                  scale={scale}
                  color={classColor(name, classes)}
                />
              ))}
            </div>
          ) : null}
          {rankPlaces && places.ranks.length > 0 ? (
            <div className="distribution-chart" data-waiting="false" data-place-ranks={places.ranks.length} data-rank-kind="eating">
              <p className="chart-caption">Eating count</p>
              {places.ranks.map((item) => (
                <ClassBar
                  key={item.name}
                  name={item.name}
                  count={item.eating}
                  scale={rankScale}
                  color={classColor(item.name, places.ranks.map((entry) => entry.name))}
                />
              ))}
            </div>
          ) : null}
          {visual === 'places' && places.hasMap && mapPoints.length > 0 ? (
            <>
              <svg className="places-svg" viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet" data-place-points={mapPoints.length}>
                {mapPoints.map((point) => (
                  <circle
                    key={point.rowIndex}
                    className="place-dot"
                    cx={point.px}
                    cy={point.py}
                    r={0.018 + point.weight * 0.012}
                    data-eating={point.weight >= 0.5 ? 'true' : 'false'}
                    opacity={0.25 + point.weight * 0.7}
                  />
                ))}
              </svg>
              <div className="place-labels" aria-hidden="true">
                {labels.map((label) => (
                  <span
                    key={label.name}
                    className="place-pin"
                    style={{ left: `${label.px * 100}%`, top: `${label.py * 100}%` }}
                    data-place-label={label.name}
                    data-eating-count={label.eating}
                  >
                    {label.name} · {label.eating}
                  </span>
                ))}
              </div>
              <ul className="place-legend" aria-label="Eating map legend">
                <li data-eating="true">Eating · {eatingDots}</li>
                <li data-eating="false">Not eating · {otherDots}</li>
              </ul>
            </>
          ) : null}
          {visual === 'places' && !places.hasMap && places.ranks.length > 0 ? (
            <div className="distribution-chart" data-waiting="false" data-place-ranks={places.ranks.length} data-rank-kind="eating">
              <p className="chart-caption">Eating count</p>
              {places.ranks.map((item) => (
                <ClassBar
                  key={item.name}
                  name={item.name}
                  count={item.eating}
                  scale={rankScale}
                  color={classColor(item.name, places.ranks.map((entry) => entry.name))}
                />
              ))}
            </div>
          ) : null}
        </div>
        {visual === 'places' || rankPlaces || compact ? null : (
        <div className="chart-transport">
          {playbackEnabled ? (
            <Button
              type="button"
              variant="outline"
              className="chart-transport-toggle"
              aria-label={playing ? 'Pause' : 'Play'}
              aria-pressed={playing}
              disabled={completedCount < 2}
              onClick={onTogglePlayback}
            >
              {playing ? 'Pause' : 'Play'}
            </Button>
          ) : null}
          <label className="chart-scrubber">
            <span className="visually-hidden">Chart playhead</span>
            <input
              aria-label="Chart playhead"
              aria-valuetext={completedCount ? `Row ${playheadIndex + 1} of ${totalRows || completedCount}` : 'Waiting'}
              type="range"
              min={0}
              max={completedCount ? Math.max(0, domainCount - 1) : 0}
              value={completedCount ? playheadIndex : 0}
              disabled={!completedCount}
              onChange={handleRange}
              onPointerDown={(event) => {
                if (!completedCount) return
                emitSeek(Number(event.currentTarget.value), 'scrub')
              }}
              onPointerUp={handleRangeCommit}
              onKeyUp={handleRangeCommit}
            />
          </label>
        </div>
        )}
      </div>
    </section>
  )
}, areChartPropsEqual)
