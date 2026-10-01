import { ArrowUpRight } from './ui/arrow'

// A repeatable scatter inside a tilted park outline, drawn like the dot map on the dashboard.
const PARK_DOTS = (() => {
  let seed = 7
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  return Array.from({ length: 220 }, () => ({ x: 78 + next() * 82, y: 8 + next() * 84 }))
    .filter(({ x, y }) => x > 98 - (y - 8) * 0.2 && x < 142 + (y - 8) * 0.2)
})()

const RANK_WIDTHS = [150, 138, 118, 100, 82]

// Thumbnails sketch the shape of each dashboard: a main chart beside a ranking.
const Ranking = ({ x }: { x: number }) => (
  <g className="thumb-bars">
    {RANK_WIDTHS.map((width, index) => <rect key={index} x={x} y={18 + index * 15} width={width * 0.62} height="8" rx="1.5" />)}
  </g>
)

const SquirrelThumb = () => (
  <svg viewBox="0 -6 400 112" role="presentation">
    <path className="thumb-outline" d="M98 8h44l18 84H80Z" />
    {PARK_DOTS.map(({ x, y }, index) => <circle key={index} cx={x.toFixed(1)} cy={y.toFixed(1)} r="1.6" />)}
    <Ranking x={228} />
  </svg>
)

const FootballThumb = () => (
  <svg viewBox="0 -6 400 112" role="presentation">
    <path className="thumb-grid" d="M40 28h200M40 54h200M40 80h200" />
    <path className="thumb-area" d="M40 80h34V70h30V62h24V54h30V42h26V28h22V16h34V80H40Z" />
    <path className="thumb-line" d="M40 80h34V70h30V62h24V54h30V42h26V28h22V16h34" />
    <circle className="thumb-end" cx="240" cy="16" r="3.5" />
    <Ranking x={268} />
  </svg>
)

export const DemoPicker = ({ onOpen }: { onOpen: (id: string) => void }) => (
  <section className="demo-picker" aria-labelledby="demo-heading">
    <div className="column-head">
      <h2 id="demo-heading">Example dashboards</h2>
      <p>See what a CSV turns into: two samples built from real public datasets, the same way yours would be.</p>
    </div>
    <a className="demo-card" href="/demo/squirrels" onClick={(event) => { event.preventDefault(); onOpen('squirrels') }}>
      <span className="demo-art" aria-hidden="true"><SquirrelThumb /></span>
      <span className="demo-card-copy">
        <strong>A city park, mapped.</strong>
        <span>3,023 squirrel sightings: where, when, and what they were doing.</span>
      </span>
      <span className="demo-arrow"><ArrowUpRight /></span>
    </a>
    <a className="demo-card" href="/demo/football" onClick={(event) => { event.preventDefault(); onOpen('football') }}>
      <span className="demo-art" aria-hidden="true"><FootballThumb /></span>
      <span className="demo-card-copy">
        <strong>Seattle’s Super Bowl, play by play.</strong>
        <span>How Seattle built its Super Bowl lead, and who gained the yards.</span>
      </span>
      <span className="demo-arrow"><ArrowUpRight /></span>
    </a>
  </section>
)
