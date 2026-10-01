import { lookup as dnsLookup } from 'node:dns/promises'
import https from 'node:https'
import type { LookupFunction } from 'node:net'
import { CSV_MAX_BYTES, DatasetError } from '../dataset/csvTypes.js'
import { assertPublicHttpsCsvUrl, isResolvedAddressSafe } from '../dataset/urlSafety.js'
import { sniffCsvContentType } from '../dataset/validateDataset.js'

const FETCH_TIMEOUT_MS = 12_000
const MAX_REDIRECTS = 3

export type DatasetResolver = (hostname: string) => Promise<string[]>

export interface DatasetTransportRequest {
  url: URL
  headers: Record<string, string>
  /** DNS lookup that refuses non-public addresses; real transports must hand it to the socket. */
  lookup: LookupFunction
  signal: AbortSignal
}

export interface DatasetTransportResponse {
  statusCode: number
  /** Lower-case header names. */
  headers: Record<string, string | string[] | undefined>
  body: AsyncIterable<Uint8Array>
  destroy: () => void
}

export type DatasetTransport = (request: DatasetTransportRequest) => Promise<DatasetTransportResponse>

export interface DatasetFetchOptions {
  resolve?: DatasetResolver
  request?: DatasetTransport
  timeoutMs?: number
}

const unsafe = (): DatasetError => new DatasetError('URL_UNSAFE', 'The URL is not a public HTTPS CSV link.')
const fetchFailed = (message: string): DatasetError => new DatasetError('URL_FETCH_FAILED', message, 502)
const tooLarge = (): DatasetError => new DatasetError('CSV_TOO_LARGE', 'This file is too big. Maximum size is 4 MB.', 413)

const defaultResolve: DatasetResolver = async (hostname) => (await dnsLookup(hostname, { all: true })).map((entry) => entry.address)

/**
 * Resolves, validates every address, and hands only validated addresses to the socket, so the
 * check applies to the connection actually made (no check-then-connect rebinding window).
 */
export const createPinnedLookup = (resolve: DatasetResolver = defaultResolve): LookupFunction => (
  (hostname, optionsOrCallback, maybeCallback) => {
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as (error: Error | null, address?: unknown, family?: number) => void
    const options = typeof optionsOrCallback === 'object' && optionsOrCallback ? optionsOrCallback : {}
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) return callback(fetchFailed('Could not download that URL.'))
        if (addresses.some((address) => !isResolvedAddressSafe(address))) return callback(unsafe())
        let entries = addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
        const wanted = options.family === 4 || options.family === 6 ? options.family : undefined
        if (wanted) entries = entries.filter((entry) => entry.family === wanted)
        if (entries.length === 0) return callback(fetchFailed('Could not download that URL.'))
        if (options.all) return callback(null, entries)
        return callback(null, entries[0].address, entries[0].family)
      },
      (error: unknown) => callback(error instanceof Error ? error : fetchFailed('Could not download that URL.')),
    )
  }
) as LookupFunction

const httpsTransport: DatasetTransport = ({ url, headers, lookup, signal }) => new Promise((resolvePromise, reject) => {
  const request = https.request({
    protocol: 'https:',
    hostname: url.hostname.replace(/^\[|\]$/g, ''),
    port: 443,
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers,
    lookup,
    agent: false,
    signal,
  }, (response) => {
    resolvePromise({
      statusCode: response.statusCode ?? 0,
      headers: response.headers,
      body: response,
      destroy: () => response.destroy(),
    })
  })
  request.on('error', reject)
  request.end()
})

const headerValue = (headers: DatasetTransportResponse['headers'], name: string): string | undefined => {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

const readBody = async (response: DatasetTransportResponse, aborted: Promise<never>): Promise<Uint8Array> => {
  const iterator = response.body[Symbol.asyncIterator]()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const step = await Promise.race([iterator.next(), aborted])
    if (step.done) break
    total += step.value.byteLength
    if (total > CSV_MAX_BYTES) throw tooLarge()
    chunks.push(step.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const toPublicUrl = (url: URL): string => {
  const clean = new URL(url.toString())
  clean.username = ''
  clean.password = ''
  clean.hash = ''
  return clean.toString()
}

export const fetchPublicCsv = async (rawUrl: string, options: DatasetFetchOptions = {}): Promise<{ bytes: Uint8Array; finalUrl: string; contentType?: string }> => {
  const transport = options.request ?? httpsTransport
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const lookup = createPinnedLookup(options.resolve)
  let current = assertPublicHttpsCsvUrl(rawUrl)

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController()
    let timedOut = false
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(fetchFailed('The download timed out.')), { once: true })
    })
    aborted.catch(() => undefined)
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    let response: DatasetTransportResponse | undefined
    try {
      response = await Promise.race([
        transport({
          url: current,
          headers: { Accept: 'text/csv, text/plain;q=0.9, */*;q=0.1', 'Accept-Encoding': 'identity' },
          lookup,
          signal: controller.signal,
        }),
        aborted,
      ])
      const { statusCode } = response
      if (statusCode >= 300 && statusCode < 400) {
        const location = headerValue(response.headers, 'location')
        if (!location) throw fetchFailed('Could not download that URL (redirect without a location).')
        if (redirect === MAX_REDIRECTS) throw fetchFailed('Could not download that URL (too many redirects).')
        let next: string
        try {
          next = new URL(location, current).toString()
        } catch {
          throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
        }
        current = assertPublicHttpsCsvUrl(next)
        continue
      }
      if (statusCode < 200 || statusCode >= 300) throw fetchFailed(`Could not download that URL (HTTP ${statusCode}).`)
      const encoding = headerValue(response.headers, 'content-encoding')?.trim().toLowerCase()
      if (encoding && encoding !== 'identity') throw fetchFailed('Could not download that URL (unsupported content encoding).')
      const contentLength = Number(headerValue(response.headers, 'content-length') ?? '0')
      if (Number.isFinite(contentLength) && contentLength > CSV_MAX_BYTES) throw tooLarge()
      const contentType = headerValue(response.headers, 'content-type')
      sniffCsvContentType(contentType, new Uint8Array(0))
      const bytes = await readBody(response, aborted)
      return { bytes, finalUrl: toPublicUrl(current), contentType }
    } catch (error) {
      if (error instanceof DatasetError) throw error
      throw fetchFailed(timedOut ? 'The download timed out.' : 'Could not download that URL.')
    } finally {
      clearTimeout(timer)
      response?.destroy()
    }
  }
  throw fetchFailed('Could not download that URL (too many redirects).')
}
