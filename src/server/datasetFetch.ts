import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { CSV_MAX_BYTES, DatasetError } from '../dataset/csvTypes.js'
import { assertPublicHttpsCsvUrl, isResolvedAddressSafe } from '../dataset/urlSafety.js'
import { sniffCsvContentType } from '../dataset/validateDataset.js'

const FETCH_TIMEOUT_MS = 12_000
const MAX_REDIRECTS = 3

export interface DatasetFetchOptions {
  fetch?: typeof fetch
  lookup?: (hostname: string) => Promise<string[]>
  /** Injectable Node transport for isolated tests; production uses node:https. */
  httpsRequest?: typeof httpsRequest
  timeoutMs?: number
}

const headerValue = (headers: Headers, name: string): string | undefined => headers.get(name) ?? undefined

const resolveAddresses = async (hostname: string): Promise<string[]> => {
  const literal = hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal)) return [literal]
  // A hostname that looks public can still resolve to loopback, private, or
  // cloud metadata space. Resolve every address and reject the host if any
  // answer is unsafe before making the outbound request.
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true })
  return addresses.map(({ address }) => address)
}

const isAbortError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const record = error as { name?: unknown; code?: unknown }
  return record.name === 'AbortError' || record.code === 20 || record.code === 'ABORT_ERR'
}

const wrapFetchError = (error: unknown): DatasetError => {
  if (error instanceof DatasetError) return error
  if (isAbortError(error)) return new DatasetError('URL_TIMEOUT', 'The CSV URL timed out.', 504)
  return new DatasetError('URL_FETCH_FAILED', 'Could not fetch that CSV URL.')
}

const statusError = (status: number): DatasetError => {
  if (status === 404 || status === 410) return new DatasetError('URL_NOT_FOUND', 'That CSV URL was not found.', 404)
  return new DatasetError('URL_FETCH_FAILED', `The CSV URL returned HTTP ${status}.`)
}

const assertSafeHost = async (url: URL, lookup?: (hostname: string) => Promise<string[]>, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> => {
  assertPublicHttpsCsvUrl(url.toString())
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const addresses = await Promise.race([
      (lookup ?? resolveAddresses)(url.hostname),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DatasetError('URL_TIMEOUT', 'The CSV URL timed out.', 504)), timeoutMs)
      }),
    ])
    if (addresses.length === 0) throw new Error('No DNS records')
    if (addresses.some((address) => !isResolvedAddressSafe(address))) {
      throw new DatasetError('URL_UNSAFE', 'That URL is not a public CSV link.')
    }
    return addresses[0]
  } catch (error) {
    if (error instanceof DatasetError) throw error
    throw new DatasetError('URL_FETCH_FAILED', 'Could not resolve that CSV host.')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Make the validated DNS answer the address used for the TLS connection. */
const fetchPinnedHttps = (url: URL, init: RequestInit, address: string, requestPinned = httpsRequest): Promise<Response> => new Promise((resolve, reject) => {
  const request = requestPinned(url, {
    method: init.method,
    headers: init.headers as Record<string, string> | undefined,
    signal: init.signal ?? undefined,
    servername: isIP(url.hostname.replace(/^\[|\]$/g, '')) ? undefined : url.hostname,
    lookup: (_hostname, lookupOptions, callback) => {
      const family = isIP(address)
      if (typeof lookupOptions === 'object' && lookupOptions !== null && 'all' in lookupOptions && lookupOptions.all) {
        callback(null, [{ address, family }])
      } else {
        callback(null, address, family)
      }
    },
  }, (incoming) => {
    const chunks: Buffer[] = []
    let total = 0
    incoming.on('error', reject)
    incoming.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += bytes.byteLength
      if (total > CSV_MAX_BYTES) {
        request.destroy(new DatasetError('CSV_TOO_LARGE', 'This file is too big. Maximum size is 5 MB.', 413))
        return
      }
      chunks.push(bytes)
    })
    incoming.on('end', () => {
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value)
        else if (Array.isArray(value)) headers.set(name, value.join(', '))
      }
      try {
        const status = incoming.statusCode ?? 502
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }))
      } catch (error) {
        reject(error)
      }
    })
  })
  request.on('error', reject)
  request.end()
})

const readBoundedBody = async (response: Response): Promise<Uint8Array> => {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > CSV_MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new DatasetError('CSV_TOO_LARGE', 'This file is too big. Maximum size is 5 MB.', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export const fetchPublicCsv = async (rawUrl: string, options: DatasetFetchOptions = {}): Promise<{ bytes: Uint8Array; finalUrl: string; contentType?: string }> => {
  const fetcher = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  let current = assertPublicHttpsCsvUrl(rawUrl)
  let resolvedAddress = await assertSafeHost(current, options.lookup, timeoutMs)

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const init: RequestInit = {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'text/csv, text/plain;q=0.9, */*;q=0.1' },
        signal: controller.signal,
      }
      const response = options.fetch
        ? await fetcher(current.toString(), init)
        : await fetchPinnedHttps(current, init, resolvedAddress, options.httpsRequest)
      if (response.status >= 300 && response.status < 400) {
        const location = headerValue(response.headers, 'location')
        if (!location) throw new DatasetError('URL_FETCH_FAILED', 'The CSV URL redirected without a location.')
        if (redirect === MAX_REDIRECTS) throw new DatasetError('URL_FETCH_FAILED', 'The CSV URL redirected too many times.')
        current = assertPublicHttpsCsvUrl(new URL(location, current).toString())
        resolvedAddress = await assertSafeHost(current, options.lookup, timeoutMs)
        continue
      }
      if (!response.ok) throw statusError(response.status)
      const contentLength = Number(headerValue(response.headers, 'content-length') ?? '0')
      if (Number.isFinite(contentLength) && contentLength > CSV_MAX_BYTES) throw new DatasetError('CSV_TOO_LARGE', 'This file is too big. Maximum size is 5 MB.', 413)
      const contentType = headerValue(response.headers, 'content-type')
      const buffer = await readBoundedBody(response)
      sniffCsvContentType(contentType, buffer)
      return { bytes: buffer, finalUrl: current.toString(), contentType }
    } catch (error) {
      throw wrapFetchError(error)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new DatasetError('URL_FETCH_FAILED', 'Could not fetch that CSV URL.')
}
