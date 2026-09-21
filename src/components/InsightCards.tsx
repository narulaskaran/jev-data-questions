import type { InsightProposal } from '../dataset/insight'
import { Button } from './ui/button'
import { Card, CardContent, CardFooter, CardHeader } from './ui/card'

const visualLabel = (insight: InsightProposal): string => {
  if (insight.visual === 'series') return insight.id === 'series-win' ? 'P(win) line' : 'Series'
  if (insight.visual === 'places') return 'Places'
  return 'Class bars'
}

const InsightPreview = ({ visual }: { visual: InsightProposal['visual'] }) => {
  if (visual === 'series') {
    return (
      <svg className="insight-preview" viewBox="0 0 64 24" aria-hidden="true" data-preview="series">
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points="1,18 12,14 22,16 32,8 42,11 52,4 63,7"
        />
      </svg>
    )
  }
  if (visual === 'bars') {
    return (
      <svg className="insight-preview" viewBox="0 0 64 24" aria-hidden="true" data-preview="bars">
        <rect x="8" y="10" width="10" height="12" rx="1" />
        <rect x="27" y="4" width="10" height="18" rx="1" />
        <rect x="46" y="8" width="10" height="14" rx="1" />
      </svg>
    )
  }
  return (
    <svg className="insight-preview" viewBox="0 0 64 24" aria-hidden="true" data-preview="places">
      <circle cx="16" cy="14" r="2.5" />
      <circle cx="32" cy="8" r="2.5" />
      <circle cx="48" cy="12" r="2.5" />
    </svg>
  )
}

export const InsightCards = ({
  insights,
  selectedId,
  running,
  onSelect,
  onRun,
}: {
  insights: readonly InsightProposal[]
  selectedId?: string
  running?: boolean
  onSelect?: (insight: InsightProposal) => void
  onRun: (insight: InsightProposal) => void
}) => {
  if (insights.length === 0) return null
  return (
    <section className="insight-panel" aria-label="Proposed insights" data-insight-count={insights.length}>
      <div className="insight-cards">
        {insights.map((insight) => {
          const selected = insight.id === selectedId
          return (
            <Card
              key={insight.id}
              className={`insight-card${selected ? ' is-selected' : ''}`}
              data-insight-id={insight.id}
              data-visual={insight.visual}
              onClick={() => onSelect?.(insight)}
            >
              <CardHeader className="section-heading flex-row items-start justify-between space-y-0">
                <div>
                  <p className="eyebrow">{visualLabel(insight)}</p>
                  <h2>{insight.title}</h2>
                </div>
                <InsightPreview visual={insight.visual} />
              </CardHeader>
              <CardContent>
                <p className="insight-reason">{insight.reason}</p>
              </CardContent>
              <CardFooter className="form-footer">
                <Button
                  className="run-button"
                  variant="run"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelect?.(insight)
                    onRun(insight)
                  }}
                  disabled={running}
                >
                  {running && selected ? 'Starting…' : 'Run'}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
