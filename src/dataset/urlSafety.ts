import { DatasetError } from './csvTypes.js'

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
])

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.arpa']

const parseIPv4 = (value: string): number | undefined => {
  const parts = value.split('.')
  if (parts.length !== 4) return undefined
  let result = 0
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return undefined
    const num = Number(part)
    if (num > 255) return undefined
    result = result * 256 + num
  }
  return result
}

const ipv4 = (a: number, b: number, c: number, d: number): number => ((a * 256 + b) * 256 + c) * 256 + d

// [network, prefix length]
const BLOCKED_IPV4: ReadonlyArray<readonly [number, number]> = [
  [ipv4(0, 0, 0, 0), 8],
  [ipv4(10, 0, 0, 0), 8],
  [ipv4(100, 64, 0, 0), 10],
  [ipv4(127, 0, 0, 0), 8],
  [ipv4(169, 254, 0, 0), 16],
  [ipv4(172, 16, 0, 0), 12],
  [ipv4(192, 0, 0, 0), 24],
  [ipv4(192, 0, 2, 0), 24],
  [ipv4(192, 168, 0, 0), 16],
  [ipv4(198, 18, 0, 0), 15],
  [ipv4(198, 51, 100, 0), 24],
  [ipv4(203, 0, 113, 0), 24],
  [ipv4(224, 0, 0, 0), 4],
  [ipv4(240, 0, 0, 0), 4],
]

const isBlockedIPv4 = (ip: number): boolean => BLOCKED_IPV4.some(([network, bits]) => {
  const size = 2 ** (32 - bits)
  return Math.floor(ip / size) === Math.floor(network / size)
})

/** Parses an IPv6 literal (no brackets, no zone) into eight 16-bit groups. */
const parseIPv6 = (value: string): number[] | undefined => {
  if (!/^[0-9a-f:.]+$/i.test(value)) return undefined
  const halves = value.split('::')
  if (halves.length > 2) return undefined
  const compressed = halves.length === 2
  const parseGroups = (part: string, allowDotted: boolean): number[] | undefined => {
    if (part === '') return []
    const items = part.split(':')
    const groups: number[] = []
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (item.includes('.')) {
        if (!allowDotted || index !== items.length - 1) return undefined
        const v4 = parseIPv4(item)
        if (v4 === undefined) return undefined
        groups.push(Math.floor(v4 / 65536), v4 % 65536)
      } else if (/^[0-9a-f]{1,4}$/i.test(item)) {
        groups.push(parseInt(item, 16))
      } else {
        return undefined
      }
    }
    return groups
  }
  const head = parseGroups(halves[0], !compressed)
  const tail = compressed ? parseGroups(halves[1], true) : []
  if (!head || !tail) return undefined
  if (!compressed) return head.length === 8 ? head : undefined
  if (head.length + tail.length > 7) return undefined
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail]
}

const embeddedIPv4 = (groups: number[]): number => groups[6] * 65536 + groups[7]

const isBlockedIPv6 = (g: number[]): boolean => {
  const zeroThrough = (end: number): boolean => g.slice(0, end).every((group) => group === 0)
  if (zeroThrough(5)) {
    // ::/96 (IPv4-compatible, includes :: and ::1) and ::ffff:0:0/96 (IPv4-mapped)
    if (g[5] === 0 || g[5] === 0xffff) return isBlockedIPv4(embeddedIPv4(g))
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return true
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true
  if (g[0] === 0x2002) return true
  if (g[0] === 0x2001 && g[1] === 0) return true
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true
  if ((g[0] & 0xfe00) === 0xfc00) return true
  if ((g[0] & 0xffc0) === 0xfe80) return true
  if ((g[0] & 0xffc0) === 0xfec0) return true
  if ((g[0] & 0xff00) === 0xff00) return true
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true
  return false
}

/** True only for a syntactically valid IPv4/IPv6 literal that is not in a non-public range. */
export const isPublicIpAddress = (address: string): boolean => {
  if (typeof address !== 'string') return false
  if (address.includes(':')) {
    const groups = parseIPv6(address)
    return groups !== undefined && !isBlockedIPv6(groups)
  }
  const ip = parseIPv4(address)
  return ip !== undefined && !isBlockedIPv4(ip)
}

const isBlockedHostname = (hostname: string): boolean => {
  const host = hostname.replace(/\.$/, '').toLowerCase()
  if (!host) return true
  if (host.startsWith('[')) return !isPublicIpAddress(host.replace(/^\[|\]$/g, ''))
  if (BLOCKED_HOSTS.has(host)) return true
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true
  if (/^[\d.]+$/.test(host)) return !isPublicIpAddress(host)
  return !host.includes('.')
}

const notPublic = (code: 'URL_NOT_PUBLIC' | 'URL_UNSAFE' = 'URL_NOT_PUBLIC'): DatasetError => new DatasetError(code, 'The URL is not a public HTTPS CSV link.')

export const assertPublicHttpsCsvUrl = (value: string): URL => {
  if (typeof value !== 'string' || value.trim().length < 12 || value.length > 2_048) throw notPublic()
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw notPublic()
  }
  if (parsed.protocol !== 'https:') throw notPublic()
  if (parsed.username || parsed.password) throw notPublic()
  if (!parsed.hostname || isBlockedHostname(parsed.hostname)) throw notPublic('URL_UNSAFE')
  // The parser drops an explicit :443, so any remaining port is a non-default one.
  if (parsed.port) throw notPublic('URL_UNSAFE')
  return parsed
}

export const isResolvedAddressSafe = (address: string): boolean => isPublicIpAddress(address)
