// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CSV_MAX_BYTES, DatasetError } from '../dataset/csvTypes'
import { createPinnedLookup, fetchPublicCsv, type DatasetTransport, type DatasetTransportResponse } from './datasetFetch'

const enc = (text: string) => new TextEncoder().encode(text)

const respond = (
  statusCode: number,
  headers: Record<string, string | string[] | undefined> = {},
  body: AsyncIterable<Uint8Array> | string = '',
  onDestroy?: () => void,
): DatasetTransportResponse => ({
  statusCode,
  headers,
  body: typeof body === 'string' ? (async function* () { if (body) yield enc(body) })() : body,
  destroy: () => onDestroy?.(),
})

const failure = async (promise: Promise<unknown>): Promise<DatasetError> => {
  try {
    await promise
  } catch (error) {
    return error as DatasetError
  }
  throw new Error('expected rejection')
}

const never = (): AsyncIterable<Uint8Array> => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) })

const callLookup = (lookup: ReturnType<typeof createPinnedLookup>, hostname: string, all = true) => new Promise<{ error: Error | null; address?: unknown; family?: number }>((resolve) => {
  ;(lookup as unknown as (h: string, o: object, cb: (e: Error | null, a?: unknown, f?: number) => void) => void)(hostname, { all }, (error, address, family) => resolve({ error, address, family }))
})

describe('createPinnedLookup', () => {
  it('hands validated addresses to the socket in both callback shapes', async () => {
    const lookup = createPinnedLookup(async () => ['93.184.216.34', '2606:4700:4700::1111'])
    const all = await callLookup(lookup, 'example.com', true)
    expect(all.error).toBeNull()
    expect(all.address).toEqual([{ address: '93.184.216.34', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }])
    const single = await callLookup(lookup, 'example.com', false)
    expect(single.address).toBe('93.184.216.34')
    expect(single.family).toBe(4)
  })

  it.each([
    [['127.0.0.1']],
    [['::ffff:127.0.0.1']],
    [['93.184.216.34', '10.0.0.1']],
    [['169.254.169.254', '93.184.216.34']],
    [['not-an-ip']],
  ])('refuses %j', async (addresses) => {
    const result = await callLookup(createPinnedLookup(async () => addresses), 'evil.example')
    expect(result.error).toBeInstanceOf(DatasetError)
    expect((result.error as DatasetError).code).toBe('URL_UNSAFE')
    expect(result.address).toBeUndefined()
  })

  it('reports resolver failures and empty answers as errors', async () => {
    const failed = await callLookup(createPinnedLookup(async () => { throw new Error('ENOTFOUND') }), 'nope.example')
    expect(failed.error?.message).toBe('ENOTFOUND')
    const empty = await callLookup(createPinnedLookup(async () => []), 'nope.example')
    expect((empty.error as DatasetError).code).toBe('URL_FETCH_FAILED')
  })
})

describe('fetchPublicCsv', () => {
  it('returns bytes, content type, and a clean final URL; sends safe headers', async () => {
    let seen: Parameters<DatasetTransport>[0] | undefined
    const result = await fetchPublicCsv('https://example.com/data.csv#frag', {
      request: async (req) => {
        seen = req
        return respond(200, { 'content-type': 'text/csv; charset=utf-8' }, 'a,b\n1,2\n')
      },
    })
    expect(new TextDecoder().decode(result.bytes)).toBe('a,b\n1,2\n')
    expect(result.contentType).toBe('text/csv; charset=utf-8')
    expect(result.finalUrl).toBe('https://example.com/data.csv')
    expect(seen?.headers['Accept-Encoding']).toBe('identity')
    expect(Object.keys(seen?.headers ?? {}).map((key) => key.toLowerCase())).not.toContain('cookie')
    expect(Object.keys(seen?.headers ?? {}).map((key) => key.toLowerCase())).not.toContain('authorization')
  })

  it('exposes the pinned lookup to the transport', async () => {
    const result = await fetchPublicCsv('https://rebind.example/x.csv', {
      resolve: async () => ['10.0.0.5'],
      request: async (req) => {
        const lookedUp = await callLookup(req.lookup as ReturnType<typeof createPinnedLookup>, req.url.hostname)
        if (lookedUp.error) throw lookedUp.error
        return respond(200)
      },
    }).catch((error) => error as DatasetError)
    expect((result as DatasetError).code).toBe('URL_UNSAFE')
  })

  it('never sends a request for an invalid URL', async () => {
    let calls = 0
    const request: DatasetTransport = async () => {
      calls += 1
      return respond(200)
    }
    for (const url of ['http://example.com/x.csv', 'https://127.0.0.1/x.csv', 'https://[::ffff:127.0.0.1]/', 'https://example.com:8443/x.csv', 'https://user:pw@example.com/x.csv']) {
      expect(await failure(fetchPublicCsv(url, { request }))).toBeInstanceOf(DatasetError)
    }
    expect(calls).toBe(0)
    expect((await failure(fetchPublicCsv('https://127.0.0.1.nip.io/x.csv', { resolve: async () => ['127.0.0.1'] }))).code).toBe('URL_UNSAFE')
  })

  it('follows redirects, re-validating every hop', async () => {
    const urls: string[] = []
    const request: DatasetTransport = async ({ url }) => {
      urls.push(url.toString())
      if (url.pathname === '/a') return respond(302, { location: '/b' })
      if (url.pathname === '/b') return respond(301, { location: 'https://cdn.example.org/c.csv#x' })
      return respond(200, {}, 'a\n1\n')
    }
    const result = await fetchPublicCsv('https://example.com/a', { request })
    expect(urls).toEqual(['https://example.com/a', 'https://example.com/b', 'https://cdn.example.org/c.csv#x'])
    expect(result.finalUrl).toBe('https://cdn.example.org/c.csv')

    for (const location of ['https://127.0.0.1/x', 'http://example.com/x', 'https://[::ffff:7f00:1]/x', 'https://example.com:8080/x']) {
      let calls = 0
      const error = await failure(fetchPublicCsv('https://example.com/a', {
        request: async () => (calls += 1) === 1 ? respond(302, { location }) : respond(200, {}, 'a\n1\n'),
      }))
      expect(['URL_NOT_PUBLIC', 'URL_UNSAFE']).toContain(error.code)
      expect(calls).toBe(1)
    }
  })

  it('stops after 3 redirects and rejects a redirect without Location', async () => {
    let calls = 0
    const loop = await failure(fetchPublicCsv('https://example.com/a', {
      request: async () => {
        calls += 1
        return respond(302, { location: `/n${calls}` })
      },
    }))
    expect(loop.code).toBe('URL_FETCH_FAILED')
    expect(calls).toBe(4)
    expect((await failure(fetchPublicCsv('https://example.com/a', { request: async () => respond(302) }))).code).toBe('URL_FETCH_FAILED')
  })

  it('maps non-2xx to URL_FETCH_FAILED without leaking the body', async () => {
    const error = await failure(fetchPublicCsv('https://example.com/x.csv', { request: async () => respond(404, {}, 'secret internal page') }))
    expect(error.code).toBe('URL_FETCH_FAILED')
    expect(error.statusCode).toBe(502)
    expect(error.message).toBe('Could not download that URL (HTTP 404).')
    expect(error.message).not.toContain('secret')
  })

  it('maps network errors to URL_FETCH_FAILED without leaking the cause', async () => {
    const error = await failure(fetchPublicCsv('https://example.com/x.csv', { request: async () => { throw new Error('ECONNRESET 10.1.1.1') } }))
    expect(error.code).toBe('URL_FETCH_FAILED')
    expect(error.statusCode).toBe(502)
    expect(error.message).not.toContain('10.1.1.1')
  })

  it('propagates URL_UNSAFE raised by the socket lookup', async () => {
    const error = await failure(fetchPublicCsv('https://example.com/x.csv', { request: async () => { throw new DatasetError('URL_UNSAFE', 'x') } }))
    expect(error.code).toBe('URL_UNSAFE')
  })

  it('rejects a too-large Content-Length before reading the body', async () => {
    let destroyed = false
    let read = false
    const body: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => { read = true; return { next: async () => ({ done: true, value: undefined }) } } }
    const error = await failure(fetchPublicCsv('https://example.com/x.csv', {
      request: async () => respond(200, { 'content-length': String(CSV_MAX_BYTES + 1) }, body, () => { destroyed = true }),
    }))
    expect(error.code).toBe('CSV_TOO_LARGE')
    expect(error.statusCode).toBe(413)
    expect(error.message).toMatch(/4 MB/)
    expect(read).toBe(false)
    expect(destroyed).toBe(true)
  })

  it('aborts a streamed body as soon as it exceeds the cap, without Content-Length', async () => {
    let produced = 0
    let destroyed = false
    const chunk = new Uint8Array(1024 * 1024)
    const body = (async function* () {
      for (let index = 0; index < 100; index += 1) {
        produced += 1
        yield chunk
      }
    })()
    const error = await failure(fetchPublicCsv('https://example.com/x.csv', { request: async () => respond(200, {}, body, () => { destroyed = true }) }))
    expect(error.code).toBe('CSV_TOO_LARGE')
    expect(produced).toBe(5)
    expect(destroyed).toBe(true)
  })

  it('accepts a body of exactly the cap', async () => {
    const body = (async function* () { yield new Uint8Array(CSV_MAX_BYTES) })()
    const result = await fetchPublicCsv('https://example.com/x.csv', { request: async () => respond(200, {}, body) })
    expect(result.bytes.byteLength).toBe(CSV_MAX_BYTES)
  })

  it('times out a slow body and a hung connection', async () => {
    let destroyed = false
    const slow = await failure(fetchPublicCsv('https://example.com/x.csv', { timeoutMs: 50, request: async () => respond(200, {}, never(), () => { destroyed = true }) }))
    expect(slow.code).toBe('URL_FETCH_FAILED')
    expect(slow.message).toMatch(/timed out/i)
    expect(destroyed).toBe(true)
    const hung = await failure(fetchPublicCsv('https://example.com/x.csv', { timeoutMs: 50, request: () => new Promise(() => undefined) }))
    expect(hung.code).toBe('URL_FETCH_FAILED')
  })

  it('refuses compressed responses and non-CSV content types', async () => {
    const gz = await failure(fetchPublicCsv('https://example.com/x.csv', { request: async () => respond(200, { 'content-encoding': 'gzip' }, 'x') }))
    expect(gz.code).toBe('URL_FETCH_FAILED')
    await expect(fetchPublicCsv('https://example.com/x.csv', { request: async () => respond(200, { 'content-encoding': 'identity' }, 'a\n1\n') })).resolves.toBeDefined()
    const html = await failure(fetchPublicCsv('https://example.com/x.csv', { request: async () => respond(200, { 'content-type': 'text/html' }, '<html>') }))
    expect(html.code).toBe('NOT_CSV')
  })
})
