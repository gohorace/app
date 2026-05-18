import { describe, it, expect } from 'vitest'
import { normaliseUrl, classifyError } from './route'

describe('normaliseUrl', () => {
  it('prepends https:// when scheme is missing', () => {
    const u = normaliseUrl('reidproperty.com.au')
    expect(u?.toString()).toBe('https://reidproperty.com.au/')
  })

  it('preserves an explicit http:// scheme', () => {
    const u = normaliseUrl('http://reidproperty.com.au')
    expect(u?.protocol).toBe('http:')
  })

  it('preserves an explicit https:// scheme', () => {
    const u = normaliseUrl('https://reidproperty.com.au')
    expect(u?.protocol).toBe('https:')
  })

  it('rejects file:// and other non-http schemes', () => {
    expect(normaliseUrl('file:///etc/passwd')).toBeNull()
    expect(normaliseUrl('javascript:alert(1)')).toBeNull()
    expect(normaliseUrl('ftp://example.com')).toBeNull()
  })

  it('rejects localhost', () => {
    expect(normaliseUrl('http://localhost:3000')).toBeNull()
    expect(normaliseUrl('localhost')).toBeNull()
  })

  it('rejects RFC1918 loopback / private ranges', () => {
    expect(normaliseUrl('http://127.0.0.1')).toBeNull()
    expect(normaliseUrl('http://10.0.0.5')).toBeNull()
    expect(normaliseUrl('http://192.168.1.10')).toBeNull()
    expect(normaliseUrl('http://172.16.0.1')).toBeNull()
    expect(normaliseUrl('http://172.31.255.254')).toBeNull()
  })

  it('rejects link-local (169.254/16)', () => {
    expect(normaliseUrl('http://169.254.169.254')).toBeNull()
  })

  it('rejects .local mDNS hosts', () => {
    expect(normaliseUrl('http://hostname.local')).toBeNull()
  })

  it('rejects empty and whitespace-only inputs', () => {
    expect(normaliseUrl('')).toBeNull()
    expect(normaliseUrl('   ')).toBeNull()
  })

  it('rejects malformed URLs', () => {
    // After prepending https:// → "https://not a url" — the space is
    // invalid for a host, so URL() throws.
    expect(normaliseUrl('not a url with spaces')).toBeNull()
  })

  it('public IPs outside reserved ranges are allowed', () => {
    expect(normaliseUrl('http://172.15.0.1')?.toString()).toBe('http://172.15.0.1/')
    expect(normaliseUrl('http://8.8.8.8')?.toString()).toBe('http://8.8.8.8/')
  })
})

describe('classifyError', () => {
  it("'AbortError' → timeout", () => {
    const e = new Error('aborted')
    e.name = 'AbortError'
    expect(classifyError(e)).toBe('timeout')
  })

  it("'BlockedError' (thrown for 4xx/5xx) → blocked", () => {
    const e = new Error('status 403')
    e.name = 'BlockedError'
    expect(classifyError(e)).toBe('blocked')
  })

  it('ENOTFOUND in cause → unreachable', () => {
    const e = new TypeError('fetch failed')
    ;(e as { cause?: { code?: string } }).cause = { code: 'ENOTFOUND' }
    expect(classifyError(e)).toBe('unreachable')
  })

  it('ECONNREFUSED in cause → unreachable', () => {
    const e = new TypeError('fetch failed')
    ;(e as { cause?: { code?: string } }).cause = { code: 'ECONNREFUSED' }
    expect(classifyError(e)).toBe('unreachable')
  })

  it('unknown error → unreachable (default)', () => {
    expect(classifyError(new Error('something else'))).toBe('unreachable')
    expect(classifyError(null)).toBe('unreachable')
    expect(classifyError('string')).toBe('unreachable')
  })
})
