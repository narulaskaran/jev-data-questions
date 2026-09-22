import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export const Progress = ({
  value = 0,
  indeterminate = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { value?: number; indeterminate?: boolean }) => {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      data-indeterminate={indeterminate || undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clamped}
      role="progressbar"
      {...props}
    >
      <div
        className={cn('progress-fill h-full rounded-full bg-[var(--run)]', indeterminate && 'is-indeterminate')}
        style={indeterminate ? undefined : { width: `${clamped}%` }}
      />
    </div>
  )
}
