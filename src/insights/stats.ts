export const quantile = (sorted: readonly number[], q: number): number => {
  if (sorted.length === 0) return NaN
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}

export const pearson = (xs: readonly number[], ys: readonly number[]): number => {
  const n = Math.min(xs.length, ys.length)
  if (n < 3) return 0
  let sumX = 0
  let sumY = 0
  for (let index = 0; index < n; index += 1) { sumX += xs[index]!; sumY += ys[index]! }
  const meanX = sumX / n
  const meanY = sumY / n
  let cov = 0
  let varX = 0
  let varY = 0
  for (let index = 0; index < n; index += 1) {
    const dx = xs[index]! - meanX
    const dy = ys[index]! - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  return varX === 0 || varY === 0 ? 0 : cov / Math.sqrt(varX * varY)
}

/** Correlation of a series with its own previous value: near 1 for a smooth running state. */
export const lagOneCorrelation = (values: readonly number[]): number => (
  values.length < 4 ? 0 : pearson(values.slice(0, -1), values.slice(1))
)

/**
 * Whether a chi-square statistic clears p < 0.01, using the Wilson–Hilferty
 * normal approximation. Accurate enough to separate signal from noise without
 * shipping a distribution table.
 */
export const chiSquareSignificant = (statistic: number, df: number): boolean => {
  if (df < 1 || !Number.isFinite(statistic) || statistic <= 0) return false
  const spread = 2 / (9 * df)
  const z = (Math.cbrt(statistic / df) - (1 - spread)) / Math.sqrt(spread)
  return z > 2.326
}

/** Chi-square test that a yes/no rate differs between groups. */
export const rateDifference = (groups: ReadonlyArray<{ yes: number; total: number }>): { significant: boolean; cramersV: number } => {
  const total = groups.reduce((sum, group) => sum + group.total, 0)
  const yes = groups.reduce((sum, group) => sum + group.yes, 0)
  if (groups.length < 2 || total === 0 || yes === 0 || yes === total) return { significant: false, cramersV: 0 }
  const rate = yes / total
  let statistic = 0
  for (const group of groups) {
    const expectedYes = group.total * rate
    const expectedNo = group.total * (1 - rate)
    if (expectedYes > 0) statistic += (group.yes - expectedYes) ** 2 / expectedYes
    if (expectedNo > 0) statistic += (group.total - group.yes - expectedNo) ** 2 / expectedNo
  }
  return {
    significant: chiSquareSignificant(statistic, groups.length - 1),
    cramersV: Math.sqrt(statistic / total),
  }
}

/** One-way ANOVA: does a group's average differ by more than chance? */
export const meanDifference = (groups: ReadonlyArray<readonly number[]>): { significant: boolean; etaSquared: number } => {
  const filled = groups.filter((group) => group.length > 0)
  const n = filled.reduce((sum, group) => sum + group.length, 0)
  const k = filled.length
  if (k < 2 || n <= k) return { significant: false, etaSquared: 0 }
  const grand = filled.reduce((sum, group) => sum + group.reduce((inner, value) => inner + value, 0), 0) / n
  let between = 0
  let within = 0
  for (const group of filled) {
    const mean = group.reduce((sum, value) => sum + value, 0) / group.length
    between += group.length * (mean - grand) ** 2
    for (const value of group) within += (value - mean) ** 2
  }
  const totalSquares = between + within
  if (totalSquares === 0) return { significant: false, etaSquared: 0 }
  if (within === 0) return { significant: true, etaSquared: 1 }
  const f = (between / (k - 1)) / (within / (n - k))
  // (k − 1)·F approaches chi-square(k − 1) as the within-group sample grows.
  return { significant: chiSquareSignificant((k - 1) * f, k - 1), etaSquared: between / totalSquares }
}
