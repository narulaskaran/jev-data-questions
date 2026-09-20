import type { InsightProposal } from '../dataset/insight'
import { Button } from './ui/button'
import { Card, CardContent, CardFooter, CardHeader } from './ui/card'

const visualLabel = (visual: InsightProposal['visual']): string => {
  if (visual === 'series') return 'P(win) line'
  if (visual === 'places') return 'Places'
  return 'Class bars'
}

export const InsightCards = ({
  insights,
  selectedId,
  running,
  onRun,
}: {
  insights: readonly InsightProposal[]
  selectedId?: string
  running?: boolean
  onRun: (insight: InsightProposal) => void
}) => {
  if (insights.length === 0) return null
  return (
    <section className="insight-panel" aria-label="Proposed insights">
      <div className="insight-cards">
        {insights.map((insight) => {
          const selected = insight.id === selectedId
          return (
            <Card
              key={insight.id}
              className={`insight-card${selected ? ' is-selected' : ''}`}
              data-insight-id={insight.id}
              data-visual={insight.visual}
            >
              <CardHeader className="section-heading flex-row items-start justify-between space-y-0">
                <div>
                  <p className="eyebrow">{visualLabel(insight.visual)}</p>
                  <h2>{insight.title}</h2>
                </div>
              </CardHeader>
              <CardContent>
                <p className="insight-reason">{insight.reason}</p>
              </CardContent>
              <CardFooter className="form-footer">
                <Button
                  className="run-button"
                  variant="run"
                  type="button"
                  onClick={() => onRun(insight)}
                  disabled={running}
                >
                  {running && selected ? 'Starting…' : 'Run insight'}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
