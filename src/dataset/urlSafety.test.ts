import { describe, expect, it } from 'vitest'
import { DatasetError } from './csvTypes'
import { assertPublicHttpsCsvUrl, isPublicIpAddress, isResolvedAddressSafe } from './urlSafety'

const codeOf = (value: string): string | undefined => {
  try {
    assertPublicHttpsCsvUrl(value)
  } catch (error) {
    return error instanceof DatasetError ? error.code : 'OTHER'
  }
  return undefined
}

describe('assertPublicHttpsCsvUrl', () => {
  it('accepts public HTTPS URLs, including an explicit :443', () => {
    expect(assertPublicHttpsCsvUrl('https://example.com/data.csv').hostname).toBe('example.com')
    expect(assertPublicHttpsCsvUrl('https://example.com:443/data.csv').hostname).toBe('example.com')
    expect(assertPublicHttpsCsvUrl('https://8.8.8.8/data.csv').hostname).toBe('8.8.8.8')
    expect(assertPublicHttpsCsvUrl('https://[2606:4700:4700::1111]/data.csv').hostname).toBe('[2606:4700:4700::1111]')
  })

  it('rejects non-https, credentials, and junk', () => {
    expect(codeOf('http://example.com/data.csv')).toBe('URL_NOT_PUBLIC')
    expect(codeOf('https://user:pass@example.com/data.csv')).toBe('URL_NOT_PUBLIC')
    expect(codeOf('not a url at all')).toBe('URL_NOT_PUBLIC')
    expect(codeOf('ftp://example.com/data.csv')).toBe('URL_NOT_PUBLIC')
  })

  it.each([
    'https://localhost/data.csv',
    'https://foo.localhost/x.csv',
    'https://printer.local/x.csv',
    'https://metadata.google.internal/computeMetadata',
    'https://host.internal/x.csv',
    'https://intranet/x.csv',
    'https://127.0.0.1/x.csv',
    'https://10.0.0.8/x.csv',
    'https://100.64.0.1/x.csv',
    'https://172.16.0.1/x.csv',
    'https://192.168.1.9/x.csv',
    'https://169.254.169.254/latest/meta-data',
    'https://192.0.0.8/x.csv',
    'https://192.0.2.1/x.csv',
    'https://198.51.100.1/x.csv',
    'https://203.0.113.1/x.csv',
    'https://240.0.0.1/x.csv',
    'https://255.255.255.255/x.csv',
    'https://0x7f.1/x.csv',
    'https://2130706433/x.csv',
    'https://[::1]/x.csv',
    'https://[::]/x.csv',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:169.254.169.254]/',
    'https://[64:ff9b::7f00:1]/',
  ])('blocks %s as URL_UNSAFE', (url) => {
    expect(codeOf(url)).toBe('URL_UNSAFE')
  })

  it('rejects any explicit non-443 port', () => {
    expect(codeOf('https://example.com:8443/x.csv')).toBe('URL_UNSAFE')
    expect(codeOf('https://example.com:80/x.csv')).toBe('URL_UNSAFE')
    expect(codeOf('https://example.com:444/x.csv')).toBe('URL_UNSAFE')
  })
})

describe('isPublicIpAddress / isResolvedAddressSafe', () => {
  it('allows public IPv4 and IPv6', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '::ffff:8.8.8.8', '::ffff:808:808']) {
      expect(isResolvedAddressSafe(address)).toBe(true)
      expect(isPublicIpAddress(address)).toBe(true)
    }
  })

  it.each([
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '100.127.255.255', '127.0.0.1', '169.254.169.254', '172.16.0.4', '172.31.255.255',
    '192.0.0.1', '192.0.2.5', '192.168.0.1', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:10.0.0.1', '0:0:0:0:0:ffff:192.168.0.1',
    '::127.0.0.1', '::7f00:1',
    '64:ff9b::7f00:1', '64:ff9b::8.8.8.8', '64:ff9b:1::1',
    '2002:7f00:1::1', '2002::', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1',
    'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'fec0::1', 'ff02::1', '100::1', '100::',
  ])('blocks %s', (address) => {
    expect(isResolvedAddressSafe(address)).toBe(false)
  })

  it.each([
    '', 'example.com', 'localhost', '1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', '1..2.3', '1.2.3.4/8', ' 8.8.8.8', '[::1]',
    '1:2:3', '1:2:3:4:5:6:7:8:9', '1::2::3', 'g::1', '::1%eth0', '1:2:3:4:5:6:7::8', '12345::1', '1.2.3.4::1',
  ])('treats %j as not a valid literal (unsafe)', (address) => {
    expect(isResolvedAddressSafe(address)).toBe(false)
  })
})
