export const TABLE_ROW_HEIGHT = 36
const OVERSCAN = 8

/** Which slice of a long list to mount for the current scroll position. */
export const visibleWindow = (count: number, scrollTop: number, viewportHeight: number, rowHeight = TABLE_ROW_HEIGHT): { start: number; end: number; padTop: number; padBottom: number } => {
  const start = Math.min(Math.max(0, count - 1), Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - OVERSCAN))
  const end = Math.min(count, start + Math.ceil(Math.max(viewportHeight, rowHeight) / rowHeight) + OVERSCAN * 2)
  return { start: count === 0 ? 0 : start, end, padTop: (count === 0 ? 0 : start) * rowHeight, padBottom: Math.max(0, count - end) * rowHeight }
}
