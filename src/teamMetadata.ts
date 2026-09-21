export const teamCode = (teamName: string): string => {
  const words = teamName.trim().split(/\s+/).filter(Boolean)
  if (words.length > 1) return words.map((word) => word[0]).join('').slice(0, 3).toUpperCase()
  return (words[0] ?? 'TEAM').slice(0, 3).toUpperCase()
}

/** Compact team code for series chrome (SEA, NE). Pass-through for 2–4 letter codes. */
export const asPerspectiveLabel = (value: unknown): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const trimmed = String(value).trim()
  if (!trimmed) return undefined
  if (/^[A-Za-z]{2,4}$/.test(trimmed)) return trimmed.toUpperCase()
  return teamCode(trimmed)
}

export const perspectiveMetricTitle = (metric: string, perspective?: string): string => {
  const base = metric.trim()
  if (!base) return perspective ?? ''
  if (!perspective) return `${base.charAt(0).toUpperCase()}${base.slice(1)}`
  return `${perspective} ${base.charAt(0).toLowerCase()}${base.slice(1)}`
}

export const perspectivePercentLabel = (percentLabel: string, perspective?: string): string => (
  perspective ? `${perspective} ${percentLabel}` : percentLabel
)
