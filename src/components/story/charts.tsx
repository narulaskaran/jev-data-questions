import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { formatNumber, niceTicks } from '../../insights/format'
import type {
  BarItem,
  BarsChart,
  HistogramChart,
  LineChart,
  MapChart,
  ScatterChart,
  ViewChart,
} from '../../insights/views'

const FALLBACK_WIDTH = 560
const PLOT_HEIGHT = 240
const TICK_FONT = 11
/** Rough advance of one character of tick text, for fitting labels without measuring. */
const CHAR_WIDTH = 6.4

/** Tracks the rendered width so SVG text stays a constant size at every breakpoint. */
const useWidth = (): [React.RefObject<HTMLDivElement>, number] => {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(FALLBACK_WIDTH)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const measure = () => {
      const next = Math.round(node.getBoundingClientRect().width)
      if (next > 0) setWidth(next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

/** Keeps the first and last tick and as many evenly spaced ones between as fit. */
const thin = <T,>(ticks: readonly T[], maxCount: number): T[] => {
  if (ticks.length <= Math.max(2, maxCount)) return [...ticks]
  const count = Math.max(2, maxCount)
  const picked = new Set<number>()
  for (let index = 0; index < count; index += 1) picked.add(Math.round((index / (count - 1)) * (ticks.length - 1)))
  return ticks.filter((_, index) => picked.has(index))
}

const valueAxis = (min: number, max: number, zeroBased: boolean) => {
  const low = zeroBased ? Math.min(0, min) : min
  const high = max === low ? low + 1 : max
  const ticks = niceTicks(low, high, 4)
  return { ticks, min: ticks[0]!, max: ticks[ticks.length - 1]! }
}

const Tooltip = ({ left, width, children }: { left: number; width: number; children: React.ReactNode }) => (
  <div className="story-tooltip" role="presentation" style={{ left: clamp(left, 64, Math.max(64, width - 64)) }}>
    {children}
  </div>
)

// ---------------------------------------------------------------------------

export const BarsView = ({ chart, label }: { chart: BarsChart; label: string }) => {
  const max = chart.max > 0 ? chart.max : 1
  const reference = chart.reference
  return (
    <div className="story-bars-wrap">
      <ul className="story-bars" aria-label={label}>
        {chart.items.map((item) => (
          <BarRow key={item.label} item={item} max={max} reference={reference?.value} />
        ))}
      </ul>
      {reference ? (
        <p className="story-bars-key"><span className="story-key-line" aria-hidden="true" />{reference.label}</p>
      ) : null}
    </div>
  )
}

const BarRow = ({ item, max, reference }: { item: BarItem; max: number; reference?: number }) => (
  <li className="story-bar-row" data-muted={item.muted || undefined} title={item.detail ? `${item.label}: ${item.display} (${item.detail})` : `${item.label}: ${item.display}`}>
    <span className="story-bar-label">{item.label}</span>
    <span className="story-bar-track">
      <span className="story-bar-fill" style={{ '--bar': `${clamp(item.value / max, 0, 1) * 100}%` } as CSSProperties} />
      {reference !== undefined ? (
        <span className="story-bar-reference" aria-hidden="true" style={{ left: `${clamp(reference / max, 0, 1) * 100}%` }} />
      ) : null}
    </span>
    <span className="story-bar-value">{item.display}</span>
  </li>
)

// ---------------------------------------------------------------------------

export const LineView = ({ chart, label }: { chart: LineChart; label: string }) => {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number>()
  const values = chart.points.map((point) => point.value)
  const axis = valueAxis(Math.min(...values), Math.max(...values), chart.zeroBased)
  const tickLabels = axis.ticks.map((tick) => formatNumber(tick, chart.unit))
  const left = Math.max(...tickLabels.map((text) => text.length)) * CHAR_WIDTH + 14
  const right = 18
  const top = 26
  const bottom = 30
  const plotWidth = Math.max(40, width - left - right)
  const plotHeight = PLOT_HEIGHT - top - bottom
  const x = (position: number): number => left + position * plotWidth
  const y = (value: number): number => top + (1 - (value - axis.min) / (axis.max - axis.min)) * plotHeight
  const coordinates = chart.points.map((point) => `${x(point.x).toFixed(1)},${y(point.value).toFixed(1)}`)
  const line = `M${coordinates.join('L')}`
  const baseline = y(clamp(0, axis.min, axis.max))
  const area = `${line}L${x(chart.points[chart.points.length - 1]!.x).toFixed(1)},${baseline.toFixed(1)}L${x(chart.points[0]!.x).toFixed(1)},${baseline.toFixed(1)}Z`
  const longest = Math.max(...chart.ticks.map((tick) => tick.label.length))
  const xTicks = thin(chart.ticks, Math.floor(plotWidth / (longest * CHAR_WIDTH + 18)))
  const highlight = chart.highlight === undefined ? undefined : chart.points[chart.highlight]
  const active = hover === undefined ? undefined : chart.points[hover]

  const handleMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = (event.clientX - bounds.left - left) / plotWidth
    let nearest = 0
    chart.points.forEach((point, index) => {
      if (Math.abs(point.x - position) < Math.abs(chart.points[nearest]!.x - position)) nearest = index
    })
    setHover(nearest)
  }

  return (
    <div className="story-plot" ref={ref}>
      <svg
        width={width}
        height={PLOT_HEIGHT}
        role="img"
        aria-label={label}
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(undefined)}
      >
        {axis.ticks.map((tick, index) => (
          <g key={tick}>
            <line className={tick === 0 ? 'story-axis' : 'story-gridline'} x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} />
            <text className="story-tick" x={left - 8} y={y(tick)} textAnchor="end" dominantBaseline="central">{tickLabels[index]}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text
            key={`${tick.x}-${tick.label}`}
            className="story-tick"
            x={x(tick.x)}
            y={PLOT_HEIGHT - 10}
            textAnchor={tick.x < 0.04 ? 'start' : tick.x > 0.96 ? 'end' : 'middle'}
          >
            {tick.label}
          </text>
        ))}
        {chart.zeroBased ? <path className="story-area" d={area} /> : null}
        <path className="story-line" d={line} />
        {chart.markers ? chart.points.map((point, index) => (
          <circle key={index} className="story-marker" cx={x(point.x)} cy={y(point.value)} r={3} />
        )) : null}
        {highlight ? (
          <g>
            <circle className="story-marker is-highlight" cx={x(highlight.x)} cy={y(highlight.value)} r={5} />
            {active ? null : (
              <text
                className="story-direct-label"
                x={x(highlight.x)}
                y={y(highlight.value) - 12}
                textAnchor={highlight.x < 0.12 ? 'start' : highlight.x > 0.88 ? 'end' : 'middle'}
              >
                {highlight.display}
              </text>
            )}
          </g>
        ) : null}
        {active ? (
          <g>
            <line className="story-crosshair" x1={x(active.x)} x2={x(active.x)} y1={top} y2={top + plotHeight} />
            <circle className="story-marker is-highlight" cx={x(active.x)} cy={y(active.value)} r={5} />
          </g>
        ) : null}
      </svg>
      {active ? <Tooltip left={x(active.x)} width={width}><b>{active.display}</b><span>{active.label}</span></Tooltip> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

export const HistogramView = ({ chart, label }: { chart: HistogramChart; label: string }) => {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number>()
  const axis = valueAxis(0, Math.max(...chart.bins.map((bin) => bin.count)), true)
  const tickLabels = axis.ticks.map((tick) => formatNumber(tick))
  const left = Math.max(...tickLabels.map((text) => text.length)) * CHAR_WIDTH + 14
  const right = 12
  const top = 26
  const bottom = 30
  const plotWidth = Math.max(40, width - left - right)
  const plotHeight = PLOT_HEIGHT - top - bottom
  const slot = plotWidth / chart.bins.length
  const gap = slot > 8 ? 2 : 1
  const y = (value: number): number => top + (1 - value / axis.max) * plotHeight
  const first = chart.bins[0]!.from
  const last = chart.bins[chart.bins.length - 1]!.to
  const medianX = left + clamp((chart.median - first) / (last - first), 0, 1) * plotWidth
  const edges = chart.bins.map((bin, index) => ({ x: left + index * slot, label: formatNumber(bin.from, chart.unit) }))
  const longest = Math.max(...edges.map((edge) => edge.label.length))
  const xTicks = thin(edges, Math.floor(plotWidth / (longest * CHAR_WIDTH + 20)))
  const active = hover === undefined ? undefined : chart.bins[hover]
  return (
    <div className="story-plot" ref={ref}>
      <svg width={width} height={PLOT_HEIGHT} role="img" aria-label={label} onPointerLeave={() => setHover(undefined)}>
        {axis.ticks.map((tick, index) => (
          <g key={tick}>
            <line className={tick === 0 ? 'story-axis' : 'story-gridline'} x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} />
            <text className="story-tick" x={left - 8} y={y(tick)} textAnchor="end" dominantBaseline="central">{tickLabels[index]}</text>
          </g>
        ))}
        {chart.bins.map((bin, index) => {
          const height = Math.max(bin.count > 0 ? 1 : 0, y(0) - y(bin.count))
          const barWidth = Math.max(1, slot - gap)
          const barX = left + index * slot + gap / 2
          const radius = Math.min(3, barWidth / 2, height)
          return (
            <g key={bin.from} onPointerEnter={() => setHover(index)}>
              {/* The hit area is the whole column, so short bars stay easy to point at. */}
              <rect x={left + index * slot} y={top} width={slot} height={plotHeight} fill="transparent" />
              <path
                className={`story-column${hover === index ? ' is-active' : ''}`}
                d={`M${barX},${y(0)}V${y(0) - height + radius}Q${barX},${y(0) - height} ${barX + radius},${y(0) - height}H${barX + barWidth - radius}Q${barX + barWidth},${y(0) - height} ${barX + barWidth},${y(0) - height + radius}V${y(0)}Z`}
              />
            </g>
          )
        })}
        {xTicks.map((tick) => (
          <text key={tick.x} className="story-tick" x={tick.x} y={PLOT_HEIGHT - 10} textAnchor="start">{tick.label}</text>
        ))}
        <line className="story-reference" x1={medianX} x2={medianX} y1={top - 6} y2={top + plotHeight} />
        <text className="story-direct-label" x={medianX + (medianX > left + plotWidth * 0.7 ? -6 : 6)} y={top - 10} textAnchor={medianX > left + plotWidth * 0.7 ? 'end' : 'start'}>
          {chart.medianLabel}
        </text>
      </svg>
      {active && hover !== undefined ? (
        <Tooltip left={left + (hover + 0.5) * slot} width={width}><b>{formatNumber(active.count)}</b><span>{active.label}</span></Tooltip>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

export const ScatterView = ({ chart, label }: { chart: ScatterChart; label: string }) => {
  const [ref, width] = useWidth()
  const xs = chart.points.map((point) => point.x)
  const ys = chart.points.map((point) => point.y)
  const xAxis = valueAxis(Math.min(...xs), Math.max(...xs), false)
  const yAxis = valueAxis(Math.min(...ys), Math.max(...ys), false)
  const yLabels = yAxis.ticks.map((tick) => formatNumber(tick, chart.yUnit))
  const left = Math.max(...yLabels.map((text) => text.length)) * CHAR_WIDTH + 14
  const right = 16
  const top = 26
  const bottom = 44
  const height = PLOT_HEIGHT + 24
  const plotWidth = Math.max(40, width - left - right)
  const plotHeight = height - top - bottom
  const x = (value: number): number => left + ((value - xAxis.min) / (xAxis.max - xAxis.min)) * plotWidth
  const y = (value: number): number => top + (1 - (value - yAxis.min) / (yAxis.max - yAxis.min)) * plotHeight
  const xLabels = xAxis.ticks.map((tick) => ({ tick, text: formatNumber(tick, chart.xUnit) }))
  const longest = Math.max(...xLabels.map((entry) => entry.text.length))
  const xTicks = thin(xLabels, Math.floor(plotWidth / (longest * CHAR_WIDTH + 20)))
  // Clip the fitted line to the plot so a steep slope never leaves the frame.
  const fitY = (value: number): number => clamp(chart.fit.intercept + chart.fit.slope * value, yAxis.min, yAxis.max)
  return (
    <div className="story-plot" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={label}>
        <text className="story-axis-title" x={left} y={12}>{chart.yLabel}</text>
        {yAxis.ticks.map((tick, index) => (
          <g key={tick}>
            <line className="story-gridline" x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} />
            <text className="story-tick" x={left - 8} y={y(tick)} textAnchor="end" dominantBaseline="central">{yLabels[index]}</text>
          </g>
        ))}
        {xTicks.map(({ tick, text }) => (
          <text key={tick} className="story-tick" x={x(tick)} y={top + plotHeight + 16} textAnchor="middle">{text}</text>
        ))}
        <text className="story-axis-title" x={left + plotWidth} y={height - 6} textAnchor="end">{chart.xLabel}</text>
        {chart.points.map((point, index) => (
          <circle key={index} className="story-dot" cx={x(point.x)} cy={y(point.y)} r={3} />
        ))}
        <line className="story-reference" x1={x(xAxis.min)} x2={x(xAxis.max)} y1={y(fitY(xAxis.min))} y2={y(fitY(xAxis.max))} />
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------

const MAP_HEIGHT = 400
const MAP_PAD = 8

export const MapView = ({ chart, label }: { chart: MapChart; label: string }) => {
  const [ref, width] = useWidth()
  const height = Math.min(MAP_HEIGHT, Math.max(120, (width - MAP_PAD * 2) / chart.aspect + MAP_PAD * 2))
  const mapWidth = Math.min(width, (height - MAP_PAD * 2) * chart.aspect + MAP_PAD * 2)
  const radius = chart.points.length > 1500 ? 2 : chart.points.length > 300 ? 2.6 : 3.4
  return (
    <div className="story-map" data-has-ranking={chart.ranking ? true : undefined}>
      <div className="story-map-plot" ref={ref}>
        <svg width={mapWidth} height={height} role="img" aria-label={label}>
          {chart.points.map((point, index) => (
            <circle
              key={index}
              className="story-dot"
              cx={MAP_PAD + point.x * (mapWidth - MAP_PAD * 2)}
              cy={MAP_PAD + point.y * (height - MAP_PAD * 2)}
              r={radius}
            />
          ))}
        </svg>
      </div>
      {chart.ranking ? (
        <div className="story-map-ranking">
          <p className="story-axis-caption">{chart.ranking.label}</p>
          <BarsView chart={{ type: 'bars', items: chart.ranking.items, max: chart.ranking.max }} label={chart.ranking.label} />
        </div>
      ) : null}
    </div>
  )
}

export const ChartView = ({ chart, label }: { chart: ViewChart; label: string }) => {
  if (chart.type === 'bars') return <BarsView chart={chart} label={label} />
  if (chart.type === 'line') return <LineView chart={chart} label={label} />
  if (chart.type === 'histogram') return <HistogramView chart={chart} label={label} />
  if (chart.type === 'scatter') return <ScatterView chart={chart} label={label} />
  return <MapView chart={chart} label={label} />
}
