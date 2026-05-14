import { describe, expect, it } from 'vitest'
import { toE164 } from './phone'

describe('toE164 — Doorstep phone normalisation', () => {
  describe('AU defaults (no region argument)', () => {
    it('normalises a local AU mobile (0412...) to E.164', () => {
      const result = toE164('0412 345 678')
      expect(result).toEqual({ e164: '+61412345678', isValid: true })
    })

    it('normalises a local AU mobile with no spaces', () => {
      expect(toE164('0412345678')).toEqual({ e164: '+61412345678', isValid: true })
    })

    it('normalises an already-E.164 AU mobile (+61...)', () => {
      expect(toE164('+61412345678')).toEqual({ e164: '+61412345678', isValid: true })
    })

    it('normalises an AU landline', () => {
      // 02 = Sydney area code
      const result = toE164('02 9876 5432')
      expect(result.isValid).toBe(true)
      expect(result.e164).toBe('+61298765432')
    })

    it('strips surrounding whitespace before parsing', () => {
      expect(toE164('   0412 345 678   ')).toEqual({
        e164: '+61412345678',
        isValid: true,
      })
    })
  })

  describe('rejects unparseable input', () => {
    it('returns null+false for empty string', () => {
      expect(toE164('')).toEqual({ e164: null, isValid: false })
    })

    it('returns null+false for whitespace only', () => {
      expect(toE164('   ')).toEqual({ e164: null, isValid: false })
    })

    it('returns null+false for null', () => {
      expect(toE164(null)).toEqual({ e164: null, isValid: false })
    })

    it('returns null+false for undefined', () => {
      expect(toE164(undefined)).toEqual({ e164: null, isValid: false })
    })

    it('returns null+false for obviously non-phone text', () => {
      expect(toE164('not a phone number')).toEqual({ e164: null, isValid: false })
    })

    it('returns null+false for a too-short digit string', () => {
      expect(toE164('123')).toEqual({ e164: null, isValid: false })
    })
  })

  describe('explicit region override', () => {
    it('parses a US number when region=US', () => {
      const result = toE164('(415) 555-0123', 'US')
      expect(result.isValid).toBe(true)
      expect(result.e164).toBe('+14155550123')
    })

    it('an AU-local number does not parse under US region', () => {
      // 0412 345 678 is ambiguous outside AU and libphonenumber rejects it as
      // not-a-valid-US-number.
      const result = toE164('0412 345 678', 'US')
      expect(result.isValid).toBe(false)
    })
  })
})
