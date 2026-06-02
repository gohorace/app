import { describe, it, expect } from 'vitest'
import { isGrantActive } from './grants'
import { EXPORT_ENABLED } from './launch'

/**
 * HOR-375 — export grant expiry + launch gate. The route gating (account
 * Admin-only, own-scope needs grant) and DB reads are covered by rolled-back
 * prod probes; here we pin the pure expiry rule and the launch flag.
 */
describe('isGrantActive', () => {
  const now = new Date('2026-06-02T12:00:00Z')

  it('open-ended grant (null expiry) is always active', () => {
    expect(isGrantActive({ expiresAt: null }, now)).toBe(true)
  })

  it('future expiry is active', () => {
    expect(isGrantActive({ expiresAt: '2026-06-03T12:00:00Z' }, now)).toBe(true)
  })

  it('past expiry is inactive', () => {
    expect(isGrantActive({ expiresAt: '2026-06-01T12:00:00Z' }, now)).toBe(false)
  })

  it('expiry exactly at now is inactive (strictly future required)', () => {
    expect(isGrantActive({ expiresAt: '2026-06-02T12:00:00Z' }, now)).toBe(false)
  })
})

describe('export launch gate', () => {
  it('export stays gated until Marketing refocuses the trust-page copy', () => {
    // MUST be false on main — flipping without the copy refocus is the exact
    // failure mode HOR-375 forbids (see lib/export/launch).
    expect(EXPORT_ENABLED).toBe(false)
  })
})
