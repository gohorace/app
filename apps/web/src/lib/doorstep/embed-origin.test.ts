import { describe, expect, it } from 'vitest'
import { isAllowedEmbedOrigin, normalizeHost, requestHost } from './embed-origin'

describe('normalizeHost()', () => {
  it('parses bare hosts, URLs, and origins to a bare host', () => {
    expect(normalizeHost('agent.com.au')).toBe('agent.com.au')
    expect(normalizeHost('https://agent.com.au')).toBe('agent.com.au')
    expect(normalizeHost('https://agent.com.au/listings/123')).toBe('agent.com.au')
  })

  it('strips www and port, lowercases and trims', () => {
    expect(normalizeHost('https://www.Agent.com.au')).toBe('agent.com.au')
    expect(normalizeHost('  WWW.agent.com.au:443  ')).toBe('agent.com.au')
    expect(normalizeHost('http://localhost:3000')).toBe('localhost')
  })

  it('returns "" for empty / nullish', () => {
    expect(normalizeHost('')).toBe('')
    expect(normalizeHost(null)).toBe('')
    expect(normalizeHost(undefined)).toBe('')
  })
})

describe('requestHost()', () => {
  it('prefers Origin, falls back to Referer', () => {
    expect(requestHost('https://agent.com.au', 'https://other.com')).toBe('agent.com.au')
    expect(requestHost(null, 'https://agent.com.au/contact')).toBe('agent.com.au')
    expect(requestHost(null, null)).toBe('')
  })
})

describe('isAllowedEmbedOrigin()', () => {
  const allowed = ['agent.com.au', 'https://www.team-site.com']

  it('allows a registered origin (www / scheme / port insensitive)', () => {
    expect(isAllowedEmbedOrigin('https://agent.com.au', null, allowed)).toBe(true)
    expect(isAllowedEmbedOrigin('https://www.agent.com.au', null, allowed)).toBe(true)
    expect(isAllowedEmbedOrigin('https://team-site.com', null, allowed)).toBe(true)
  })

  it('falls back to the Referer host when Origin is absent', () => {
    expect(isAllowedEmbedOrigin(null, 'https://agent.com.au/appraisal', allowed)).toBe(true)
  })

  it('rejects an unregistered origin', () => {
    expect(isAllowedEmbedOrigin('https://evil.example', null, allowed)).toBe(false)
  })

  it('rejects everything when the allowlist is empty (hard lock by design)', () => {
    expect(isAllowedEmbedOrigin('https://agent.com.au', null, [])).toBe(false)
  })

  it('rejects when neither Origin nor Referer is present', () => {
    expect(isAllowedEmbedOrigin(null, null, allowed)).toBe(false)
  })
})
