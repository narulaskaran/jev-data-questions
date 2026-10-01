import { DatasetError } from './csvTypes.js'
import { isIP } from 'node:net'

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.',
  'metadata.google.internal',
  'metadata.google.internal.',
  'metadata',
  'instance-data',
])

const ipv4ToInt = (value: string): number | undefined => {
  const parts = value.split('.')
  if (parts.length !== 4) return undefined
  const nums = parts.map((part) => Number(part))
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return undefined
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0
}

const ipv4InRange = (ip: number, prefix: number, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ip & mask) === (prefix & mask)
}

const isPrivateIPv4 = (hostname: string): boolean => {
  const ip = ipv4ToInt(hostname)
  if (ip === undefined) return false
  return (
    ipv4InRange(ip, ipv4ToInt('0.0.0.0')!, 8)
    || ipv4InRange(ip, ipv4ToInt('10.0.0.0')!, 8)
    || ipv4InRange(ip, ipv4ToInt('100.64.0.0')!, 10)
    || ipv4InRange(ip, ipv4ToInt('127.0.0.0')!, 8)
    || ipv4InRange(ip, ipv4ToInt('169.254.0.0')!, 16)
    || ipv4InRange(ip, ipv4ToInt('172.16.0.0')!, 12)
    || ipv4InRange(ip, 0xc0000000, 24) // special-purpose protocol assignments
    || ipv4InRange(ip, 0xc0000200, 24) // documentation
    || ipv4InRange(ip, ipv4ToInt('192.168.0.0')!, 16)
    || ipv4InRange(ip, ipv4ToInt('198.18.0.0')!, 15)
    || ipv4InRange(ip, 0xc6336400, 24) // documentation
    || ipv4InRange(ip, 0xcb007100, 24) // documentation
    || ipv4InRange(ip, ipv4ToInt('224.0.0.0')!, 4)
    || ipv4InRange(ip, 0xf0000000, 4) // reserved, non-public address space
    || ipv4InRange(ip, ipv4ToInt('255.255.255.255')!, 32)
  )
}

const ipv6ToBigInt = (hostname: string): bigint | undefined => {
  let value = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (isIP(value) !== 6) return undefined
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':')
    const ipv4 = ipv4ToInt(value.slice(lastColon + 1))
    if (ipv4 === undefined) return undefined
    const high = ((ipv4 >>> 16) & 0xffff).toString(16)
    const low = (ipv4 & 0xffff).toString(16)
    value = `${value.slice(0, lastColon)}:${high}:${low}`
  }
  const [left = '', right] = value.split('::')
  const leftWords = left ? left.split(':') : []
  const rightWords = right ? right.split(':') : []
  const missing = 8 - leftWords.length - rightWords.length
  if (missing < 0 || (right === undefined && missing !== 0)) return undefined
  const words = [...leftWords, ...Array(missing).fill('0'), ...rightWords]
  if (words.length !== 8 || words.some((word) => !/^[a-f0-9]{1,4}$/.test(word))) return undefined
  return words.reduce((address, word) => (address << 16n) | BigInt(`0x${word}`), 0n)
}

const ipv6InRange = (address: bigint, base: bigint, prefixBits: number): boolean => {
  const shift = BigInt(128 - prefixBits)
  return (address >> shift) === (base >> shift)
}

/** Accept only global-unicast IPv6, excluding special transition/tunnel ranges. */
const isPublicGlobalUnicastIPv6 = (hostname: string): boolean => {
  const address = ipv6ToBigInt(hostname)
  if (address === undefined || !ipv6InRange(address, 0x2000n << 112n, 3)) return false
  if (
    ipv6InRange(address, 0x20010db8n << 96n, 32) // documentation
    || ipv6InRange(address, 0x3fffn << 112n, 20) // documentation
    || ipv6InRange(address, 0x2001n << 112n, 23) // special-purpose assignments, including Teredo
    || ipv6InRange(address, 0x2002n << 112n, 16) // 6to4 embeds IPv4
  ) return false
  return true
}

const isBlockedHostname = (hostname: string): boolean => {
  const host = hostname.replace(/\.$/, '').toLowerCase()
  if (BLOCKED_HOSTS.has(host)) return true
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.arpa')) return true
  if (isPrivateIPv4(host) || (host.includes(':') && !isPublicGlobalUnicastIPv6(host))) return true
  return false
}

export const assertPublicHttpsCsvUrl = (value: string): URL => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DatasetError('URL_NOT_PUBLIC', 'Enter a public HTTPS CSV URL first.')
  }
  if (value.trim().length < 12 || value.length > 2_048) {
    throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
  }
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
  }
  if (parsed.protocol !== 'https:') throw new DatasetError('URL_NOT_HTTPS', 'Use an HTTPS CSV URL.')
  if (parsed.username || parsed.password) throw new DatasetError('URL_NOT_PUBLIC', 'The URL is not a public HTTPS CSV link.')
  if (!parsed.hostname || isBlockedHostname(parsed.hostname)) throw new DatasetError('URL_UNSAFE', 'That URL is not a public CSV link.')
  if (parsed.port && parsed.port !== '443') {
    const port = Number(parsed.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 80) {
      throw new DatasetError('URL_UNSAFE', 'That URL is not a public CSV link.')
    }
  }
  return parsed
}

export const isResolvedAddressSafe = (address: string): boolean => typeof address === 'string' && isIP(address) !== 0 && !isBlockedHostname(address) && !isPrivateIPv4(address)
