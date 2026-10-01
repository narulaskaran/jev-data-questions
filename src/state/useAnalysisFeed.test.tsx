import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError, type PlaygroundApi } from '../api/client'
import type { AnalysisMeta, AnalysisPage, AnalysisStatus, AnalysisViewRow } from '../shared/analysis'
import { useAnalysisFeed } from './useAnalysisFeed'

const NOW = 1_800_000_000_000

const meta = (status: AnalysisStatus = 'running', patch: Partial<AnalysisMeta> = {}): AnalysisMeta => ({
  analysisId: 'a',
  datasetId: 'ds',
  datasetName: 'plays.csv',
  sourceType: 'upload',
  query: 'q',
  classes: [{ name: 'Run', description: '' }, { name: 'Pass', description: '' }],
  columns: ['x'],
  status,
  mode: 'live',
  createdAt: NOW - 10_000,
  updatedAt: NOW,
  progress: { totalRows: 100, completedRows: 0, failedRows: 0 },
  ...patch,
})

const rowAt = (rowIndex: number): AnalysisViewRow => ({ rowIndex, model: 'm', selectedClass: 'Run', values: [rowIndex] })

interface PageOptions {
  from?: number
  to?: number
  hasMore?: boolean
  status?: AnalysisStatus
  analysis?: Partial<AnalysisMeta>
  serverTime?: number
  nextAfter?: number
}

/** A page holding rows `from..to` inclusive (none when `to < from`). */
const page = ({ from = 0, to = -1, hasMore = false, status = 'running', analysis, serverTime = NOW, nextAfter }: PageOptions = {}): AnalysisPage => {
  const rows = Array.from({ length: Math.max(0, to - from + 1) }, (_, offset) => rowAt(from + offset))
  return { analysis: meta(status, analysis), rows, nextAfter: nextAfter ?? (rows.length ? to : from - 1), hasMore, serverTime }
}

type Step = AnalysisPage | Error | (() => Promise<AnalysisPage>)

/** An api whose `read` plays back a script, then repeats the last step. */
const scripted = (steps: Step[]) => {
  let position = 0
  const read = vi.fn((_id: string, _after: number): Promise<AnalysisPage> => {
    const step = steps[Math.min(position, steps.length - 1)]
    position += 1
    if (typeof step === 'function') return step()
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step)
  })
  return { api: { read } as unknown as PlaygroundApi, read }
}

const afters = (read: ReturnType<typeof scripted>['read']) => read.mock.calls.map((call) => call[1])

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const settle = () => advance(0)
const mount = (api: PlaygroundApi, id: string | null = 'a') => renderHook((props: { id: string | null }) => useAnalysisFeed(api, props.id ?? undefined), { initialProps: { id } })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useAnalysisFeed cursor and rows', () => {
  it('starts with after = -1, then passes the last nextAfter', async () => {
    const { api, read } = scripted([page({ from: 0, to: 2 }), page({ from: 3, to: 4 }), page({ from: 5, to: 5 })])
    const { result } = mount(api)
    expect(result.current.loading).toBe(true)
    await settle()
    expect(afters(read)).toEqual([-1])
    expect(result.current.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2])
    expect(result.current.loading).toBe(false)
    await advance(700)
    expect(afters(read)).toEqual([-1, 2])
    await advance(700)
    expect(afters(read)).toEqual([-1, 2, 4])
    expect(result.current.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('does not duplicate rows when a page overlaps rows already seen', async () => {
    const { api, read } = scripted([page({ from: 0, to: 2 }), page({ from: 1, to: 4 }), page({ from: 4, to: 4 })])
    const { result } = mount(api)
    await settle()
    await advance(700)
    expect(result.current.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2, 3, 4])
    await advance(700)
    expect(afters(read)).toEqual([-1, 2, 4])
    expect(result.current.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps the cursor and rows when a page has no new rows', async () => {
    const { api, read } = scripted([page({ from: 0, to: 1 }), page({ from: 2, to: 1, nextAfter: 1 })])
    const { result } = mount(api)
    await settle()
    await advance(700)
    await advance(700)
    expect(afters(read).slice(0, 3)).toEqual([-1, 1, 1])
    expect(result.current.rows).toHaveLength(2)
  })

  it('fetches hasMore pages back to back, without waiting, until caught up', async () => {
    const { api, read } = scripted([
      page({ from: 0, to: 499, hasMore: true }),
      page({ from: 500, to: 999, hasMore: true }),
      page({ from: 1000, to: 1100, hasMore: false }),
    ])
    const { result } = mount(api)
    await advance(1)
    expect(afters(read)).toEqual([-1, 499, 999])
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
    expect(afters(read).slice(0, 3)).toEqual([-1, 499, 999])
    expect(result.current.rows).toHaveLength(1101)
    expect(result.current.caughtUp).toBe(true)
  })

  it('is not caught up while hasMore is set', async () => {
    const { api } = scripted([page({ from: 0, to: 9, hasMore: true }), () => new Promise<AnalysisPage>(() => undefined)])
    const { result } = mount(api)
    await advance(1)
    await advance(1)
    expect(result.current.caughtUp).toBe(false)
  })

  it('does not read anything without an analysis id', async () => {
    const { api, read } = scripted([page()])
    mount(api, null)
    await advance(10_000)
    expect(read).not.toHaveBeenCalled()
  })
})

describe('useAnalysisFeed polling lifetime', () => {
  it.each(['complete', 'cancelled', 'error'] as const)('stops polling once the status is %s', async (status) => {
    const { api, read } = scripted([page({ from: 0, to: 2, status })])
    const { result } = mount(api)
    await settle()
    await advance(60_000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(result.current.analysis?.status).toBe(status)
    expect(result.current.caughtUp).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['queued', 'running'] as const)('keeps polling while %s', async (status) => {
    const { api, read } = scripted([page({ from: 0, to: 0, status })])
    mount(api)
    await settle()
    await advance(5_000)
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it('slows down after several quiet polls', async () => {
    const { api, read } = scripted([page({ from: 0, to: 0 }), page({ from: 1, to: 0, nextAfter: 0 })])
    mount(api)
    await settle()
    await advance(10_000)
    const calls = read.mock.calls.length
    expect(calls).toBeLessThan(10_000 / 700)
    expect(calls).toBeGreaterThan(3)
  })

  it('finishes with the last page when the run completes mid-poll', async () => {
    const { api, read } = scripted([page({ from: 0, to: 1 }), page({ from: 2, to: 3, status: 'complete' })])
    const { result } = mount(api)
    await settle()
    await advance(700)
    await advance(30_000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(result.current.rows).toHaveLength(4)
    expect(result.current.analysis?.status).toBe('complete')
  })
})

describe('useAnalysisFeed failures', () => {
  it('survives a transient read failure: reconnecting, backoff, then continues from the same cursor', async () => {
    const { api, read } = scripted([
      page({ from: 0, to: 1 }),
      new ApiClientError('NETWORK', 'offline', 0, true),
      page({ from: 2, to: 3 }),
    ])
    const { result } = mount(api)
    await settle()
    expect(result.current.reconnecting).toBe(false)
    await advance(700)
    expect(afters(read)).toEqual([-1, 1])
    expect(result.current.reconnecting).toBe(true)
    expect(result.current.fatal).toBeUndefined()
    expect(result.current.rows).toHaveLength(2)
    expect(result.current.analysis).toBeDefined()

    await advance(999)
    expect(read).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(afters(read)).toEqual([-1, 1, 1])
    expect(result.current.reconnecting).toBe(false)
    expect(result.current.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2, 3])
    await advance(700)
    expect(afters(read)[3]).toBe(3)
  })

  it('retries with growing, capped backoff', async () => {
    const failure = new Error('boom')
    const { api, read } = scripted([failure])
    const { result } = mount(api)
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    // 1 s, 2 s, 4 s, 8 s, 8 s ...
    for (const [delay, total] of [[1_000, 2], [2_000, 3], [4_000, 4], [8_000, 5], [8_000, 6]] as const) {
      await advance(delay - 1)
      expect(read).toHaveBeenCalledTimes(total - 1)
      await advance(1)
      expect(read).toHaveBeenCalledTimes(total)
    }
    expect(result.current.reconnecting).toBe(true)
    expect(result.current.fatal).toBeUndefined()
  })

  it('keeps retrying after a failure on the very first read', async () => {
    const { api, read } = scripted([new Error('boom'), page({ from: 0, to: 0, status: 'complete' })])
    const { result } = mount(api)
    await settle()
    expect(result.current.reconnecting).toBe(true)
    expect(result.current.loading).toBe(true)
    await advance(1_000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(result.current.reconnecting).toBe(false)
    expect(result.current.analysis?.status).toBe('complete')
  })

  it('treats 5xx and 429 as transient', async () => {
    const { api, read } = scripted([
      new ApiClientError('REQUEST_FAILED', 'Too many requests', 429, true),
      new ApiClientError('INTERNAL', 'bad', 500, true),
      page({ from: 0, to: 0, status: 'complete' }),
    ])
    const { result } = mount(api)
    await settle()
    await advance(1_000)
    await advance(2_000)
    expect(read).toHaveBeenCalledTimes(3)
    expect(result.current.fatal).toBeUndefined()
    expect(result.current.analysis).toBeDefined()
  })

  it('a 404 is fatal and stops polling', async () => {
    const { api, read } = scripted([new ApiClientError('ANALYSIS_NOT_FOUND', 'That run does not exist.', 404, false)])
    const { result } = mount(api)
    await settle()
    expect(result.current.fatal).toBe('That run does not exist.')
    expect(result.current.reconnecting).toBe(false)
    expect(result.current.loading).toBe(false)
    await advance(60_000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a missing storage configuration is fatal too', async () => {
    const { api, read } = scripted([new ApiClientError('STORAGE_NOT_CONFIGURED', 'No storage here.', 503, false)])
    const { result } = mount(api)
    await settle()
    await advance(60_000)
    expect(result.current.fatal).toBe('No storage here.')
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('useAnalysisFeed stalled detection', () => {
  const withGap = (gap: number, status: AnalysisStatus) => page({ from: 0, to: 0, status, serverTime: NOW + gap, analysis: { updatedAt: NOW } })

  it('is stalled when a running run has been quiet for more than 90 s of server time', async () => {
    const { api } = scripted([withGap(91_000, 'running')])
    const { result } = mount(api)
    await settle()
    expect(result.current.stalled).toBe(true)
  })

  it('is stalled for a queued run too', async () => {
    const { api } = scripted([withGap(120_000, 'queued')])
    const { result } = mount(api)
    await settle()
    expect(result.current.stalled).toBe(true)
  })

  it('is not stalled at or under the 90 s threshold', async () => {
    const { api } = scripted([withGap(90_000, 'running')])
    const { result } = mount(api)
    await settle()
    expect(result.current.stalled).toBe(false)
  })

  it.each(['complete', 'cancelled', 'error'] as const)('is not stalled when %s, however old', async (status) => {
    const { api } = scripted([withGap(10 * 60_000, status)])
    const { result } = mount(api)
    await settle()
    expect(result.current.stalled).toBe(false)
  })

  it('judges staleness by the server clock, not the browser clock', async () => {
    vi.setSystemTime(NOW + 10 * 60_000)
    const { api } = scripted([withGap(1_000, 'running')])
    const { result } = mount(api)
    await settle()
    expect(result.current.stalled).toBe(false)
  })

  it('clears when the run becomes active again', async () => {
    const { api } = scripted([withGap(120_000, 'running'), withGap(1_000, 'running')])
    const { result } = mount(api)
    await settle()
    expect(result.current.stalled).toBe(true)
    await advance(700)
    expect(result.current.stalled).toBe(false)
  })
})

describe('useAnalysisFeed refresh', () => {
  it('restarts polling after it stopped, keeping the rows and cursor', async () => {
    const { api, read } = scripted([
      page({ from: 0, to: 2, status: 'error' }),
      page({ from: 3, to: 4, status: 'running' }),
      page({ from: 5, to: 5, status: 'running' }),
    ])
    const { result } = mount(api)
    await settle()
    await advance(30_000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(result.current.analysis?.status).toBe('error')

    act(() => result.current.refresh())
    await settle()
    expect(afters(read)).toEqual([-1, 2])
    expect(result.current.analysis?.status).toBe('running')
    expect(result.current.rows.map((row) => row.rowIndex)).toEqual([0, 1, 2, 3, 4])
    await advance(700)
    expect(afters(read)).toEqual([-1, 2, 4])
    expect(result.current.rows).toHaveLength(6)
  })

  it('does not run two poll loops at once', async () => {
    const { api, read } = scripted([page({ from: 0, to: 0 })])
    const { result } = mount(api)
    await settle()
    act(() => result.current.refresh())
    act(() => result.current.refresh())
    await settle()
    const before = read.mock.calls.length
    await advance(700)
    expect(read.mock.calls.length - before).toBeLessThanOrEqual(1)
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
  })

  it('has a stable identity across renders', async () => {
    const { api } = scripted([page({ from: 0, to: 0 })])
    const { result, rerender } = mount(api)
    await settle()
    const first = result.current.refresh
    rerender({ id: 'a' })
    expect(result.current.refresh).toBe(first)
  })
})

describe('useAnalysisFeed identity and teardown', () => {
  it('resets rows and cursor when the analysis id changes', async () => {
    const { api, read } = scripted([page({ from: 0, to: 4 }), page({ from: 0, to: 1 })])
    const { result, rerender } = mount(api, 'a')
    await settle()
    expect(result.current.rows).toHaveLength(5)
    rerender({ id: 'b' })
    expect(result.current.rows).toHaveLength(0)
    expect(result.current.analysis).toBeUndefined()
    await settle()
    expect(read.mock.calls.map((call) => [call[0], call[1]])).toEqual([['a', -1], ['b', -1]])
    expect(result.current.rows).toHaveLength(2)
  })

  it('ignores a read for the old id that resolves after switching', async () => {
    let resolveOld: (value: AnalysisPage) => void = () => undefined
    const { api } = scripted([() => new Promise<AnalysisPage>((resolve) => { resolveOld = resolve }), page({ from: 0, to: 0, status: 'complete' })])
    const { result, rerender } = mount(api, 'a')
    await settle()
    rerender({ id: 'b' })
    await settle()
    await act(async () => { resolveOld(page({ from: 0, to: 9, status: 'complete', analysis: { datasetName: 'OLD RUN' } })) })
    expect(result.current.rows).toHaveLength(1)
    expect(result.current.analysis?.datasetName).toBe('plays.csv')
  })

  it('cancels timers on unmount and never reads again', async () => {
    const { api, read } = scripted([page({ from: 0, to: 0 })])
    const { unmount } = mount(api)
    await settle()
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    const calls = read.mock.calls.length
    await advance(60_000)
    expect(read).toHaveBeenCalledTimes(calls)
  })

  it('ignores an in-flight read that resolves after unmount', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let resolve: (value: AnalysisPage) => void = () => undefined
    const { api, read } = scripted([() => new Promise<AnalysisPage>((done) => { resolve = done })])
    const { unmount } = mount(api)
    await settle()
    unmount()
    await act(async () => { resolve(page({ from: 0, to: 3 })) })
    await advance(60_000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('ignores a rejected in-flight read after unmount (no retry is scheduled)', async () => {
    let reject: (error: Error) => void = () => undefined
    const { api, read } = scripted([() => new Promise<AnalysisPage>((_, fail) => { reject = fail })])
    const { unmount } = mount(api)
    await settle()
    unmount()
    await act(async () => { reject(new Error('late')) })
    await advance(60_000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
