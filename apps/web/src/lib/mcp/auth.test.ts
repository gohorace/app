import { describe, it, expect } from 'vitest'
import { mintToken, mintRefreshToken, hashToken } from './auth'

describe('mcp tokens', () => {
  it('mints access tokens with the hor_ prefix', () => {
    expect(mintToken().plaintext.startsWith('hor_')).toBe(true)
  })

  it('mints refresh tokens with the hor_rt_ prefix', () => {
    expect(mintRefreshToken().plaintext.startsWith('hor_rt_')).toBe(true)
  })

  it('stores only the hash — plaintext hashes to it, and they differ', () => {
    const { plaintext, hash } = mintRefreshToken()
    expect(hash).toBe(hashToken(plaintext))
    expect(hash).not.toBe(plaintext)
  })

  it('mints unique refresh tokens', () => {
    expect(mintRefreshToken().plaintext).not.toBe(mintRefreshToken().plaintext)
  })
})
