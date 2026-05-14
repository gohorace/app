import { describe, it, expect } from 'vitest'
import {
  mintPairingToken,
  hashPairingToken,
  looksLikePairingToken,
  TOKEN_PREFIX,
} from './tokens'

describe('pairing tokens', () => {
  it('mints a token with the pair_ prefix', () => {
    const { plaintext } = mintPairingToken()
    expect(plaintext.startsWith(TOKEN_PREFIX)).toBe(true)
  })

  it('mints unique tokens', () => {
    const a = mintPairingToken()
    const b = mintPairingToken()
    expect(a.plaintext).not.toBe(b.plaintext)
    expect(a.hash).not.toBe(b.hash)
  })

  it('hash roundtrip is deterministic', () => {
    const { plaintext, hash } = mintPairingToken()
    expect(hashPairingToken(plaintext)).toBe(hash)
  })

  it('different plaintexts hash to different digests', () => {
    expect(hashPairingToken('pair_a')).not.toBe(hashPairingToken('pair_b'))
  })

  it('produces a 43-char base64url body (32 bytes encoded)', () => {
    const { plaintext } = mintPairingToken()
    const body = plaintext.slice(TOKEN_PREFIX.length)
    expect(body).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  describe('looksLikePairingToken', () => {
    it('accepts a freshly minted token', () => {
      const { plaintext } = mintPairingToken()
      expect(looksLikePairingToken(plaintext)).toBe(true)
    })

    it('rejects missing prefix', () => {
      const { plaintext } = mintPairingToken()
      expect(looksLikePairingToken(plaintext.slice(TOKEN_PREFIX.length))).toBe(false)
    })

    it('rejects wrong length body', () => {
      expect(looksLikePairingToken('pair_short')).toBe(false)
      expect(looksLikePairingToken('pair_' + 'a'.repeat(44))).toBe(false)
    })

    it('rejects invalid characters', () => {
      expect(looksLikePairingToken('pair_' + 'a'.repeat(42) + '!')).toBe(false)
      expect(looksLikePairingToken('pair_' + 'a'.repeat(42) + ' ')).toBe(false)
    })

    it('rejects empty and obvious junk', () => {
      expect(looksLikePairingToken('')).toBe(false)
      expect(looksLikePairingToken('hello world')).toBe(false)
    })
  })
})
