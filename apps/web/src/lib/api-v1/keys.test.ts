import { describe, it, expect } from 'vitest'
import { mintApiV1Key, maskApiV1Key } from './keys'

describe('mintApiV1Key', () => {
  it('mints an hra_live_ key with a sha256 hash and a last-4 hint', () => {
    const { plaintext, hash, hint } = mintApiV1Key()
    expect(plaintext.startsWith('hra_live_')).toBe(true)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hint).toBe(plaintext.slice(-4))
    expect(hint).toHaveLength(4)
  })

  it('mints unique keys', () => {
    expect(mintApiV1Key().plaintext).not.toBe(mintApiV1Key().plaintext)
  })
})

describe('maskApiV1Key', () => {
  it('formats a masked value from the hint', () => {
    expect(maskApiV1Key('a1b2')).toBe('hra_live_…a1b2')
    expect(maskApiV1Key(null)).toBe('hra_live_…????')
  })
})
