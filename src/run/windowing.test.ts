import { describe, expect, it } from 'vitest'
import { TABLE_ROW_HEIGHT, visibleWindow } from './windowing'

const total = (win: ReturnType<typeof visibleWindow>) => win.padTop + (win.end - win.start) * TABLE_ROW_HEIGHT + win.padBottom

describe('visibleWindow', () => {
  it('mounts nothing and pads nothing for an empty list', () => {
    expect(visibleWindow(0, 0, 432)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
    expect(visibleWindow(0, 5_000, 432)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
  })

  it('mounts a short list in full with no padding', () => {
    const win = visibleWindow(5, 0, 432)
    expect(win).toEqual({ start: 0, end: 5, padTop: 0, padBottom: 0 })
  })

  it('mounts a bounded number of rows from the middle of 5,000 and keeps the total height exact', () => {
    const count = 5_000
    const win = visibleWindow(count, 2_500 * TABLE_ROW_HEIGHT, 432)
    const mounted = win.end - win.start
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThanOrEqual(40)
    expect(win.start).toBeLessThanOrEqual(2_500)
    expect(win.end).toBeGreaterThan(2_500)
    expect(total(win)).toBe(count * TABLE_ROW_HEIGHT)
  })

  it('mounts a bounded number of rows at the top of a long list', () => {
    const win = visibleWindow(5_000, 0, 432)
    expect(win.start).toBe(0)
    expect(win.end - win.start).toBeLessThanOrEqual(40)
    expect(win.padTop).toBe(0)
    expect(total(win)).toBe(5_000 * TABLE_ROW_HEIGHT)
  })

  it('clamps when scrolled past the end and still keeps the total height', () => {
    const count = 100
    const win = visibleWindow(count, 10_000_000, 432)
    expect(win.start).toBeLessThanOrEqual(count - 1)
    expect(win.end).toBe(count)
    expect(win.padBottom).toBe(0)
    expect(total(win)).toBe(count * TABLE_ROW_HEIGHT)
  })

  it('never goes negative, even for negative scroll or tiny viewports', () => {
    for (const [count, top, view] of [[10, -500, 432], [1, 0, 0], [1, 99, 10], [5_000, -1, 1], [3, 10_000, -50]] as const) {
      const win = visibleWindow(count, top, view)
      expect(win.start).toBeGreaterThanOrEqual(0)
      expect(win.end).toBeGreaterThanOrEqual(win.start)
      expect(win.padTop).toBeGreaterThanOrEqual(0)
      expect(win.padBottom).toBeGreaterThanOrEqual(0)
      expect(total(win)).toBe(count * TABLE_ROW_HEIGHT)
    }
  })

  it('honours a custom row height', () => {
    const win = visibleWindow(1_000, 5_000, 200, 20)
    expect(win.padTop + (win.end - win.start) * 20 + win.padBottom).toBe(1_000 * 20)
  })
})
