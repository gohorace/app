import { afterEach, describe, expect, it } from 'vitest'
import { doorstepOrigin } from './origin'

// HOR-282: doorstepOrigin must never resolve to gohorace.com — a researching
// vendor must not see the Horace brand in a prospect-facing capture URL.
const KEYS = ['NEXT_PUBLIC_DOORSTEP_HOST', 'VERCEL_ENV', 'VERCEL_URL'] as const
const ORIG: Record<string, string | undefined> = {}
for (const k of KEYS) ORIG[k] = process.env[k]

afterEach(() => {
  for (const k of KEYS) {
    if (ORIG[k] === undefined) delete process.env[k]
    else process.env[k] = ORIG[k]
  }
})

describe('doorstepOrigin()', () => {
  it('prefers the preview deploy URL so QR scans hit the same deploy', () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_URL = 'my-preview.vercel.app'
    process.env.NEXT_PUBLIC_DOORSTEP_HOST = 'onthedoorstep.app'
    expect(doorstepOrigin()).toBe('https://my-preview.vercel.app')
  })

  it('uses NEXT_PUBLIC_DOORSTEP_HOST (bare) when not on preview', () => {
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_URL
    process.env.NEXT_PUBLIC_DOORSTEP_HOST = 'onthedoorstep.app'
    expect(doorstepOrigin()).toBe('https://onthedoorstep.app')
  })

  it('accepts a full URL value', () => {
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_URL
    process.env.NEXT_PUBLIC_DOORSTEP_HOST = 'https://onthedoorstep.app'
    expect(doorstepOrigin()).toBe('https://onthedoorstep.app')
  })

  it('falls back to the request origin in local dev (no env)', () => {
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_URL
    delete process.env.NEXT_PUBLIC_DOORSTEP_HOST
    expect(doorstepOrigin({ url: 'http://localhost:3000/i/abc12345' })).toBe('http://localhost:3000')
  })

  it('last-resort is onthedoorstep.app, never gohorace.com', () => {
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_URL
    delete process.env.NEXT_PUBLIC_DOORSTEP_HOST
    expect(doorstepOrigin()).toBe('https://onthedoorstep.app')
  })
})
