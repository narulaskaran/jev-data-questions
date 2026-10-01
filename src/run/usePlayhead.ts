import { useCallback, useEffect, useRef, useState } from 'react'

const TICK_MS = 50
const MIN_REPLAY_MS = 4_000
const MAX_REPLAY_MS = 12_000
const PER_ROW_MS = 90

export const replayStep = (count: number): number => {
  const duration = Math.min(MAX_REPLAY_MS, Math.max(MIN_REPLAY_MS, count * PER_ROW_MS))
  return Math.max(1, Math.ceil(count / (duration / TICK_MS)))
}

export const prefersReducedMotion = (): boolean => (
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
)

export interface Playhead {
  /** Position of the focused row within the loaded rows; -1 before any exist. */
  index: number
  /** The playhead is pinned to the newest row. */
  following: boolean
  playing: boolean
  seek(index: number): void
  play(): void
  pause(): void
  toLive(): void
}

/**
 * One cursor drives the chart, the score and the row detail. It follows the
 * newest row until the viewer scrubs back, and can replay the run from the top.
 */
export const usePlayhead = (count: number, runId: string | undefined): Playhead => {
  const [index, setIndex] = useState(count - 1)
  const [following, setFollowing] = useState(true)
  const [playing, setPlaying] = useState(false)
  const countRef = useRef(count)
  countRef.current = count

  useEffect(() => { setFollowing(true); setPlaying(false); setIndex(countRef.current - 1) }, [runId])

  useEffect(() => {
    setIndex((current) => (following && !playing ? count - 1 : Math.min(current, count - 1)))
  }, [count, following, playing])

  useEffect(() => {
    if (!playing) return undefined
    const timer = window.setInterval(() => {
      setIndex((current) => {
        const last = countRef.current - 1
        const next = Math.min(last, current + replayStep(countRef.current))
        if (next >= last) { setPlaying(false); setFollowing(true) }
        return next
      })
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [playing])

  const seek = useCallback((next: number) => {
    const last = countRef.current - 1
    const clamped = Math.max(Math.min(0, last), Math.min(Math.trunc(next), last))
    setPlaying(false)
    setIndex(clamped)
    setFollowing(clamped >= last)
  }, [])

  const play = useCallback(() => {
    if (countRef.current < 2) return
    setIndex((current) => (current >= countRef.current - 1 ? 0 : current))
    setFollowing(false)
    setPlaying(true)
  }, [])

  const pause = useCallback(() => setPlaying(false), [])
  const toLive = useCallback(() => { setPlaying(false); setFollowing(true); setIndex(countRef.current - 1) }, [])

  return { index, following, playing, seek, play, pause, toLive }
}
