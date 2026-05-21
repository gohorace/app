import { afterEach, describe, expect, it } from 'vitest'
import { doorstepHost, isDoorstepHost } from './host'

const ORIG = process.env.NEXT_PUBLIC_DOORSTEP_HOST
afterEach(() => {
  if (ORIG === undefined) delete process.env.NEXT_PUBLIC_DOORSTEP_HOST
  else process.env.NEXT_PUBLIC_DOORSTEP_HOST = ORIG
})

describe('doorstepHost()', () => {
  it('returns "" when unconfigured (e.g. local dev)', () => {
    delete process.env.NEXT_PUBLIC_DOORSTEP_HOST
    expect(doorstepHost()).toBe('')
  })

  it('parses a bare host', () => {
    process.env.NEXT_PUBLIC_DOORSTEP_HOST = 'onthedoorstep.app'
    expect(doorstepHost()).toBe('onthedoorstep.app')
  })

  it('parses a full URL down to the host', () => {
    process.env.NEXT_PUBLIC_DOORSTEP_HOST = 'https://onthedoorstep.app/'
    expect(doorstepHost()).toBe('onthedoorstep.app')
  })

  it('trims and lowercases', () => {
    process.env.NEXT_PUBLIC_DOORSTEP_HOST = '  OnTheDoorstep.App  '
    expect(doorstepHost()).toBe('onthedoorstep.app')
  })
})

describe('isDoorstepHost()', () => {
  it('is false when unconfigured', () => {
    delete process.env.NEXT_PUBLIC_DOORSTEP_HOST
    expect(isDoorstepHost('onthedoorstep.app')).toBe(false)
  })

  it('matches case-insensitively and rejects other hosts', () => {
    process.env.NEXT_PUBLIC_DOORSTEP_HOST = 'onthedoorstep.app'
    expect(isDoorstepHost('OnTheDoorstep.app')).toBe(true)
    expect(isDoorstepHost('gohorace.com')).toBe(false)
    expect(isDoorstepHost(null)).toBe(false)
    expect(isDoorstepHost(undefined)).toBe(false)
  })
})
