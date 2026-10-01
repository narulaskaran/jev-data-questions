import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { replayStep, usePlayhead } from './usePlayhead'

const setup = (count: number, runId = 'run-a') => renderHook((props: { count: number; runId: string }) => usePlayhead(props.count, props.runId), { initialProps: { count, runId } })
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('replayStep', () => {
  it('always advances at least one row per tick and never more than the list', () => {
    for (const count of [0, 1, 2, 10, 71, 500, 5_000]) {
      const step = replayStep(count)
      expect(step).toBeGreaterThanOrEqual(1)
      expect(step).toBeLessThanOrEqual(Math.max(1, count))
    }
  })

  it('takes bigger steps for longer runs', () => {
    expect(replayStep(5_000)).toBeGreaterThan(replayStep(100))
  })
})

describe('usePlayhead', () => {
  it('sits at -1 with no rows and follows the newest row as count grows', () => {
    const { result, rerender } = setup(0)
    expect(result.current.index).toBe(-1)
    expect(result.current.following).toBe(true)
    rerender({ count: 3, runId: 'run-a' })
    expect(result.current.index).toBe(2)
    rerender({ count: 7, runId: 'run-a' })
    expect(result.current.index).toBe(6)
    expect(result.current.following).toBe(true)
  })

  it('stops following after seeking back, and later growth does not move it', () => {
    const { result, rerender } = setup(5)
    act(() => result.current.seek(1))
    expect(result.current).toMatchObject({ index: 1, following: false, playing: false })
    rerender({ count: 9, runId: 'run-a' })
    expect(result.current.index).toBe(1)
    expect(result.current.following).toBe(false)
  })

  it('resumes following when seeking to the last row', () => {
    const { result, rerender } = setup(5)
    act(() => result.current.seek(1))
    act(() => result.current.seek(4))
    expect(result.current).toMatchObject({ index: 4, following: true })
    rerender({ count: 8, runId: 'run-a' })
    expect(result.current.index).toBe(7)
  })

  it('clamps seeks to the loaded rows and truncates fractions', () => {
    const { result } = setup(5)
    act(() => result.current.seek(99))
    expect(result.current).toMatchObject({ index: 4, following: true })
    act(() => result.current.seek(-7))
    expect(result.current).toMatchObject({ index: 0, following: false })
    act(() => result.current.seek(2.9))
    expect(result.current.index).toBe(2)
  })

  it('jumps back to live', () => {
    const { result, rerender } = setup(5)
    act(() => result.current.seek(0))
    rerender({ count: 6, runId: 'run-a' })
    act(() => result.current.toLive())
    expect(result.current).toMatchObject({ index: 5, following: true, playing: false })
  })

  it('restarts at 0 when played from the end, advances, then stops at the end and follows again', () => {
    const { result } = setup(10)
    expect(result.current.index).toBe(9)
    act(() => result.current.play())
    expect(result.current).toMatchObject({ index: 0, playing: true, following: false })
    tick(50)
    expect(result.current.index).toBeGreaterThan(0)
    expect(result.current.playing).toBe(true)
    tick(2_000)
    expect(result.current).toMatchObject({ index: 9, playing: false, following: true })
  })

  it('plays on from the current position when not at the end', () => {
    const { result } = setup(10)
    act(() => result.current.seek(4))
    act(() => result.current.play())
    expect(result.current.index).toBe(4)
    expect(result.current.playing).toBe(true)
  })

  it('pauses where it is', () => {
    const { result } = setup(200)
    act(() => result.current.play())
    tick(200)
    act(() => result.current.pause())
    const frozen = result.current.index
    expect(frozen).toBeGreaterThan(0)
    expect(result.current).toMatchObject({ playing: false, following: false })
    tick(5_000)
    expect(result.current.index).toBe(frozen)
  })

  it('does not play with fewer than two rows', () => {
    const { result } = setup(1)
    act(() => result.current.play())
    expect(result.current.playing).toBe(false)
  })

  it('resets when the run changes', () => {
    const { result, rerender } = setup(5, 'run-a')
    act(() => result.current.seek(1))
    rerender({ count: 3, runId: 'run-b' })
    expect(result.current).toMatchObject({ index: 2, following: true, playing: false })
  })

  it('stops a replay when the run changes', () => {
    const { result, rerender } = setup(50, 'run-a')
    act(() => result.current.play())
    rerender({ count: 50, runId: 'run-b' })
    expect(result.current.playing).toBe(false)
    expect(result.current.index).toBe(49)
  })

  it('is safe with zero rows: seek, play, pause and toLive keep the index at -1', () => {
    const { result } = setup(0)
    act(() => result.current.seek(3))
    expect(result.current.index).toBe(-1)
    act(() => result.current.play())
    expect(result.current.playing).toBe(false)
    act(() => result.current.pause())
    act(() => result.current.toLive())
    expect(result.current.index).toBe(-1)
    expect(result.current.following).toBe(true)
  })

  it('keeps a paused position inside the list when rows shrink', () => {
    const { result, rerender } = setup(10)
    act(() => result.current.seek(8))
    rerender({ count: 4, runId: 'run-a' })
    expect(result.current.index).toBe(3)
  })

  it('does not tick after unmount', () => {
    const { result, unmount } = setup(100)
    act(() => result.current.play())
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  describe('replay duration', () => {
    it('finishes a 5,000-row replay within about 12 seconds', () => {
      const { result } = setup(5_000)
      act(() => result.current.play())
      tick(11_000)
      expect(result.current.playing).toBe(true)
      tick(1_500)
      expect(result.current).toMatchObject({ index: 4_999, playing: false, following: true })
    })

    // BUG: the step is floored at 1 row per 50 ms tick, so MIN_REPLAY_MS (4 s) is never honoured: 10 rows replay in ~0.45 s.
    it.fails('takes at least about 4 seconds to replay a 10-row run', () => {
      const { result } = setup(10)
      act(() => result.current.play())
      tick(3_800)
      expect(result.current.playing).toBe(true)
    })

    // BUG: same cause; the sample's 71 rows should take ~6.4 s (90 ms per row) but take ~3.5 s.
    it.fails('does not finish a 71-row replay (the sample) in under about 4 seconds', () => {
      const { result } = setup(71)
      act(() => result.current.play())
      tick(3_800)
      expect(result.current.playing).toBe(true)
    })
  })
})
