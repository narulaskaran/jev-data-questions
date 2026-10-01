import { ArrowUpRight } from './ui/arrow'

export const DemoPicker = ({ onOpen }: { onOpen: (id: string) => void }) => (
  <section className="demo-picker" aria-labelledby="demo-heading">
    <div className="demo-picker-heading">
      <h2 id="demo-heading">Example dashboards</h2>
      <p>See what a CSV turns into: two samples built from real public datasets, the same way yours would be.</p>
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
  </section>
)
