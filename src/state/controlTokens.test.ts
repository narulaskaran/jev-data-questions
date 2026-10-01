import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { controlTokenFor, rememberControlToken } from './controlTokens'

const KEY = 'jev-playground.runs.v1'

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })

describe('controlTokens', () => {
  it('round-trips a token per run', () => {
    rememberControlToken('run-1', 'token-1')
    rememberControlToken('run-2', 'token-2')
    expect(controlTokenFor('run-1')).toBe('token-1')
    expect(controlTokenFor('run-2')).toBe('token-2')
  })

  it('replaces the token when the same run is remembered again', () => {
    rememberControlToken('run-1', 'old')
    rememberControlToken('run-1', 'new')
    expect(controlTokenFor('run-1')).toBe('new')
  })

  it('returns undefined for an unknown id, including names that exist on Object.prototype', () => {
    rememberControlToken('run-1', 'token-1')
    expect(controlTokenFor('nope')).toBeUndefined()
    expect(controlTokenFor('constructor')).toBeUndefined()
    expect(controlTokenFor('__proto__')).toBeUndefined()
  })

  it('tolerates corrupt JSON and recovers on the next write', () => {
    window.localStorage.setItem(KEY, '{not json')
    expect(controlTokenFor('run-1')).toBeUndefined()
    expect(() => rememberControlToken('run-1', 'token-1')).not.toThrow()
    expect(controlTokenFor('run-1')).toBe('token-1')
  })

  it('tolerates stored values of the wrong shape', () => {
    for (const bad of ['[]', 'null', '"text"', '42', '{"run-1":null}', '{"run-1":{"token":7}}', '{"run-1":"x"}']) {
      window.localStorage.setItem(KEY, bad)
      expect(controlTokenFor('run-1')).toBeUndefined()
    }
    window.localStorage.setItem(KEY, '[]')
    rememberControlToken('run-1', 'ok')
    expect(controlTokenFor('run-1')).toBe('ok')
  })

  it('keeps only the newest 50 runs', () => {
    let clock = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock++)
    for (let index = 0; index < 55; index += 1) rememberControlToken(`run-${index}`, `token-${index}`)
    for (let index = 0; index < 5; index += 1) expect(controlTokenFor(`run-${index}`)).toBeUndefined()
    for (let index = 5; index < 55; index += 1) expect(controlTokenFor(`run-${index}`)).toBe(`token-${index}`)
    expect(Object.keys(JSON.parse(window.localStorage.getItem(KEY) ?? '{}'))).toHaveLength(50)
  })

  it('drops the oldest, not the most recently refreshed, run', () => {
    let clock = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock++)
    for (let index = 0; index < 50; index += 1) rememberControlToken(`run-${index}`, `token-${index}`)
    rememberControlToken('run-0', 'refreshed')
    rememberControlToken('run-new', 'fresh')
    expect(controlTokenFor('run-0')).toBe('refreshed')
    expect(controlTokenFor('run-1')).toBeUndefined()
    expect(controlTokenFor('run-new')).toBe('fresh')
  })

  it('does not throw when localStorage.setItem throws (private mode, quota)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    expect(() => rememberControlToken('run-1', 'token-1')).not.toThrow()
    expect(controlTokenFor('run-1')).toBeUndefined()
  })

  it('does not throw when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
    expect(controlTokenFor('run-1')).toBeUndefined()
    expect(() => rememberControlToken('run-1', 'token-1')).not.toThrow()
  })
})
