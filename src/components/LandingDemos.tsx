import { ArrowUpRight } from './ui/arrow'

export const DemoPicker = ({ onOpen }: { onOpen: (id: string) => void }) => (
  <section className="demo-picker" aria-labelledby="demo-heading">
    <div className="demo-picker-heading">
      <p className="eyebrow">A little inspiration</p>
      <h2 id="demo-heading">Start with a story.</h2>
      <p>Two dashboards built from real public tables, exactly as yours would be.</p>
    </div>
    <a className="demo-card" href="/demo/squirrels" onClick={(event) => { event.preventDefault(); onOpen('squirrels') }}>
      <span className="demo-art map-art" aria-hidden="true">
        <svg viewBox="0 0 120 80"><path d="M38 1 81 11 96 31 75 79 23 67 12 43Z" /><path className="map-path" d="m34 68 13-23-5-19 24-9m-19 28 27 10" />{[[41,34],[61,28],[47,52],[66,49],[33,48],[72,38],[51,19]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r={i%3===0?4:2.5} />)}</svg>
      </span>
      <span className="demo-card-copy"><span className="eyebrow">Map · Trend · Rates</span><strong>A city park, mapped.</strong><span>3,023 squirrel sightings: where, when, and what they were doing.</span></span>
      <span className="demo-arrow"><ArrowUpRight /></span>
    </a>
    <a className="demo-card" href="/demo/football" onClick={(event) => { event.preventDefault(); onOpen('football') }}>
      <span className="demo-art series-art" aria-hidden="true"><svg viewBox="0 0 120 80"><path className="mini-grid" d="M10 20h100M10 40h100M10 60h100"/><path d="m10 61 12-8 10 4 14-20 10 9 12-13 11 4 12-17 10 5 9-15"/></svg></span>
      <span className="demo-card-copy"><span className="eyebrow">Sequence · Rankings · Spread</span><strong>Every play, in perspective.</strong><span>How Seattle built its Super Bowl lead, and who gained the yards.</span></span>
      <span className="demo-arrow"><ArrowUpRight /></span>
    </a>
    <p className="demo-note">Built-in examples · Real public data · No model calls</p>
  </section>
)

export const HeroPreview = () => (
  <div className="hero-preview" aria-label="A preview of a dataset becoming a dashboard">
    <div className="preview-window-head"><span className="preview-window-dots" aria-hidden="true">● ● ●</span><span>From a table to a story</span><ArrowUpRight /></div>
    <div className="preview-window-body">
      <div className="preview-summary"><span className="eyebrow">See the pattern</span><strong>More clarity.<br/>Less guesswork.</strong><span className="preview-pill">Your data, in perspective</span></div>
      <svg className="hero-graph" viewBox="0 0 400 126" role="img" aria-label="Illustration of a rising trend, with individual data points">
        <defs><linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".18"/><stop offset="100%" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
        <g className="hero-grid"><path d="M0 24h400M0 64h400M0 104h400"/></g>
        <path fill="url(#hero-fill)" d="M0 104 30 90 58 95 88 66 116 80 145 56 175 63 205 37 236 45 265 19 295 32 325 13 355 23 400 3V126H0Z"/>
        <path className="hero-line" d="M0 104 30 90 58 95 88 66 116 80 145 56 175 63 205 37 236 45 265 19 295 32 325 13 355 23 400 3"/>
        <circle cx="265" cy="19" r="5" fill="currentColor"/><circle cx="265" cy="19" r="10" fill="currentColor" opacity=".12"/>
      </svg>
      <div className="preview-window-foot"><span>01 / Bring a CSV</span><span>02 / Discover insights</span><span>03 / Share the story</span></div>
    </div>
  </div>
)
