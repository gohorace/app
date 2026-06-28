import { describe, it, expect } from 'vitest'
import { selectTextureLine, isTextureFallback, TEXTURE_FALLBACK } from './texture-line'

describe('selectTextureLine', () => {
  it('one familiar, no anonymous → singular familiar', () => {
    expect(selectTextureLine({ familiar: 1, anonymous: 0 })).toBe('A familiar face is back.')
  })

  it('two-or-more familiar, no anonymous → plural familiar', () => {
    expect(selectTextureLine({ familiar: 2, anonymous: 0 })).toBe('A couple of familiar faces are back.')
    expect(selectTextureLine({ familiar: 9, anonymous: 0 })).toBe('A couple of familiar faces are back.')
  })

  it('no familiar, one anonymous → singular anonymous', () => {
    expect(selectTextureLine({ familiar: 0, anonymous: 1 })).toBe('Someone new is circling.')
  })

  it('no familiar, two-or-more anonymous → plural anonymous', () => {
    expect(selectTextureLine({ familiar: 0, anonymous: 2 })).toBe('A few new faces are circling.')
    expect(selectTextureLine({ familiar: 0, anonymous: 7 })).toBe('A few new faces are circling.')
  })

  it('one familiar plus any anonymous → singular familiar + someone new', () => {
    expect(selectTextureLine({ familiar: 1, anonymous: 1 })).toBe('A familiar face, and someone new.')
    expect(selectTextureLine({ familiar: 1, anonymous: 5 })).toBe('A familiar face, and someone new.')
  })

  it('two-or-more familiar plus any anonymous → plural familiar + someone new', () => {
    expect(selectTextureLine({ familiar: 2, anonymous: 1 })).toBe('A couple of familiar faces, and someone new.')
    expect(selectTextureLine({ familiar: 4, anonymous: 6 })).toBe('A couple of familiar faces, and someone new.')
  })

  it('nothing stirring → fallback (never overstates)', () => {
    const line = selectTextureLine({ familiar: 0, anonymous: 0 })
    expect(line).toBe(TEXTURE_FALLBACK)
    expect(isTextureFallback(line)).toBe(true)
  })

  it('normalises noisy inputs (negatives / fractions) without crashing', () => {
    expect(selectTextureLine({ familiar: -3, anonymous: 0 })).toBe(TEXTURE_FALLBACK)
    expect(selectTextureLine({ familiar: 1.9, anonymous: 0 })).toBe('A familiar face is back.')
    expect(selectTextureLine({ familiar: 2.2, anonymous: 0.4 })).toBe('A couple of familiar faces are back.')
  })

  it('only the real fallback string is a fallback', () => {
    expect(isTextureFallback('A familiar face is back.')).toBe(false)
    expect(isTextureFallback(TEXTURE_FALLBACK)).toBe(true)
  })
})
