import { describe, expect, it, vi } from 'vitest'
import { CSV_MAX_BYTES } from '../dataset/csvTypes'
import { fetchPublicCsv } from './datasetFetch'
import { EventEmitter } from 'node:events'

const mockHttpsRequest = vi.hoisted(() => vi.fn())
const publicFixtureAddress = [0x2600, 0, 0, 0, 0, 0, 0, 1].map((word) => word.toString(16)).join(':')
const privateFixtureAddress = [0xfd00, 0, 0, 0, 0, 0, 0, 1].map((word) => word.toString(16)).join(':')

describe('public CSV fetch errors', () => {
  it('maps timeout, 404, HTML, and network failures to distinct codes', async () => {
    const timeout: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
    await expect(fetchPublicCsv('https://example.com/slow.csv', { fetch: timeout, timeoutMs: 5, lookup: async () => ['93.184.216.34'] })).rejects.toMatchObject({
      code: 'URL_TIMEOUT',
      message: 'The CSV URL timed out.',
    })

    const notFound: typeof fetch = vi.fn(async () => new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } }))
    await expect(fetchPublicCsv('https://example.com/missing.csv', { fetch: notFound, lookup: async () => ['93.184.216.34'] })).rejects.toMatchObject({
      code: 'URL_NOT_FOUND',
    })

    const html: typeof fetch = vi.fn(async () => new Response('<html><body>hi</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await expect(fetchPublicCsv('https://example.com/', { fetch: html, lookup: async () => ['93.184.216.34'] })).rejects.toMatchObject({
      code: 'NOT_CSV',
    })

    const boom: typeof fetch = vi.fn(async () => { throw new TypeError('fetch failed') })
    await expect(fetchPublicCsv('https://example.com/data.csv', { fetch: boom, lookup: async () => ['93.184.216.34'] })).rejects.toMatchObject({
      code: 'URL_FETCH_FAILED',
      message: 'Could not fetch that CSV URL.',
    })
  })

  it('still rejects non-HTTPS URLs before fetch', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('should not fetch') })
    await expect(fetchPublicCsv('http://example.com/data.csv', { fetch: fetchMock })).rejects.toMatchObject({ code: 'URL_NOT_HTTPS' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects DNS answers that point at private networks before fetching', async () => {
    const fetchMock = vi.fn(async () => new Response('a,b\n1,2\n', { headers: { 'content-type': 'text/csv' } }))
    await expect(fetchPublicCsv('https://public-looking.example/data.csv', {
      fetch: fetchMock,
      lookup: async () => [publicFixtureAddress, privateFixtureAddress],
    })).rejects.toMatchObject({ code: 'URL_UNSAFE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('bounds DNS resolution with the configured URL timeout', async () => {
    const fetchMock = vi.fn(async () => new Response('a,b\n1,2\n', { headers: { 'content-type': 'text/csv' } }))
    await expect(fetchPublicCsv('https://slow-dns.example/data.csv', {
      fetch: fetchMock,
      lookup: () => new Promise(() => undefined),
      timeoutMs: 5,
    })).rejects.toMatchObject({ code: 'URL_TIMEOUT' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops reading a chunked response as soon as it exceeds the byte limit', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(CSV_MAX_BYTES))
        controller.enqueue(new Uint8Array(1))
        controller.close()
      },
    })
    const fetchMock: typeof fetch = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/csv' },
    }))
    await expect(fetchPublicCsv('https://example.com/large.csv', {
      fetch: fetchMock,
      lookup: async () => [publicFixtureAddress],
    })).rejects.toMatchObject({ code: 'CSV_TOO_LARGE', statusCode: 413 })
  })

  it('rejects resolver outputs that are not IP addresses', async () => {
    const fetchMock = vi.fn(async () => new Response('a,b\n1,2\n', { headers: { 'content-type': 'text/csv' } }))
    await expect(fetchPublicCsv('https://bad-dns.example/data.csv', {
      fetch: fetchMock,
      lookup: async () => ['not-an-ip'],
    })).rejects.toMatchObject({ code: 'URL_UNSAFE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pins the HTTPS socket to the validated DNS address while retaining the URL hostname for TLS', async () => {
    const socketAddresses: string[] = []
    mockHttpsRequest.mockImplementation((url: URL, options: Record<string, unknown>, callback: (incoming: EventEmitter & { statusCode: number; headers: Record<string, string> }) => void) => {
      const request = new EventEmitter() as EventEmitter & { destroy: (error: Error) => void; end: () => void }
      request.destroy = (error) => request.emit('error', error)
      request.end = () => {
        const lookup = options.lookup as (hostname: string, options: unknown, callback: (...args: unknown[]) => void) => void
        lookup('example.com', { all: true }, (error, result) => {
          if (error) throw error
          const address = Array.isArray(result) ? (result[0] as { address: string }).address : result as string
          socketAddresses.push(address)
          const incoming = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
          incoming.statusCode = 200
          incoming.headers = { 'content-type': 'text/csv' }
          callback(incoming)
          incoming.emit('data', Buffer.from('label,count\nready,1\n'))
          incoming.emit('end')
        })
      }
      return request
    })

    await expect(fetchPublicCsv('https://example.com/data.csv', {
      lookup: async () => [publicFixtureAddress],
      httpsRequest: mockHttpsRequest as unknown as typeof import('node:https').request,
    })).resolves.toMatchObject({ finalUrl: 'https://example.com/data.csv' })
    expect(socketAddresses).toEqual([publicFixtureAddress])
    expect(mockHttpsRequest).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ servername: 'example.com' }), expect.any(Function))
  })
  it.each([204, 205])('handles bodyless HTTP %i responses without throwing from the response event', async (status) => {
    const requestMock = vi.fn((_url, _options, callback) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void }
      request.end = () => {
        const incoming = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
        incoming.statusCode = status
        incoming.headers = { 'content-type': 'text/csv' }
        callback(incoming)
        incoming.emit('end')
      }
      return request
    })
    const result = await fetchPublicCsv('https://example.com/empty.csv', {
      lookup: async () => [publicFixtureAddress],
      httpsRequest: requestMock as unknown as typeof import('node:https').request,
    })
    expect(result.bytes).toHaveLength(0)
  })

})
