import { describe, expect, it } from 'vitest'
import { generate, isWellFormed, INSPECTION_TOKEN_LENGTH } from './tokens'

describe('Doorstep tokens', () => {
  describe('generate()', () => {
    it('produces an 8-character string', () => {
      const t = generate()
      expect(t).toHaveLength(INSPECTION_TOKEN_LENGTH)
      expect(typeof t).toBe('string')
    })

    it('uses only the base62-minus-ambiguous alphabet (no O, no l)', () => {
      // Generate a chunk; with 8 chars × 60 alphabet, a few hundred draws
      // should still hit every valid character class.
      for (let i = 0; i < 500; i++) {
        const t = generate()
        expect(t).toMatch(/^[0-9A-NP-Za-km-z]{8}$/)
        expect(t).not.toContain('O')
        expect(t).not.toContain('l')
      }
    })

    it('does not produce obvious collisions across many draws', () => {
      // 60^8 ≈ 1.68e14 combinations; 1k draws should be unique.
      const seen = new Set<string>()
      for (let i = 0; i < 1000; i++) seen.add(generate())
      expect(seen.size).toBe(1000)
    })
  })

  describe('isWellFormed()', () => {
    it('accepts a freshly-generated token', () => {
      expect(isWellFormed(generate())).toBe(true)
    })

    it('accepts a hand-rolled valid token', () => {
      expect(isWellFormed('Ab12cdEf')).toBe(true)
    })

    it('rejects null and undefined', () => {
      expect(isWellFormed(null)).toBe(false)
      expect(isWellFormed(undefined)).toBe(false)
    })

    it('rejects empty string', () => {
      expect(isWellFormed('')).toBe(false)
    })

    it('rejects wrong length', () => {
      expect(isWellFormed('abc')).toBe(false)
      expect(isWellFormed('Ab12cdEfg')).toBe(false) // 9 chars
    })

    it('rejects tokens containing the forbidden O', () => {
      expect(isWellFormed('AbO2cdEf')).toBe(false)
    })

    it('rejects tokens containing the forbidden l', () => {
      expect(isWellFormed('Ab12cdef')).toBe(true) // baseline — no l
      expect(isWellFormed('Abl2cdEf')).toBe(false)
    })

    it('rejects non-alphanumeric characters', () => {
      expect(isWellFormed('Ab1-cdEf')).toBe(false)
      expect(isWellFormed('Ab1.cdEf')).toBe(false)
      expect(isWellFormed('Ab1 cdEf')).toBe(false)
    })
  })
})
