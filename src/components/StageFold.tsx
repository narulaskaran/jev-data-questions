import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { usePrefersReducedMotion } from '../lib/motion'
import { cn } from '../lib/utils'

export const STAGE_FOLD_MS = 300

export const StageFold = ({
  open,
  animate,
  children,
  className,
  labelledBy,
  ...props
}: {
  open: boolean
  animate: boolean
  children: ReactNode
  labelledBy?: string
} & HTMLAttributes<HTMLDivElement>) => {
  const reducedMotion = usePrefersReducedMotion()
  const motion = animate && !reducedMotion
  return (
    <div
      data-stage-fold=""
      data-open={open ? 'true' : 'false'}
      data-fold-ms={STAGE_FOLD_MS}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      aria-hidden={open ? undefined : true}
      aria-labelledby={labelledBy}
      className={cn('stage-fold', open && 'is-open', motion && 'is-animate', className)}
      style={{ '--stage-fold-ms': `${STAGE_FOLD_MS}ms` } as CSSProperties}
      {...(!open ? { inert: true } : {})}
      {...props}
    >
      <div className="stage-fold-clip">
        <div className="stage-fold-body">{children}</div>
      </div>
    </div>
  )
}
