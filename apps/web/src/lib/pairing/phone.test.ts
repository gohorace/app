import { describe, it, expect } from 'vitest'
import { normalizeAuMobile } from './phone'

describe('normalizeAuMobile', () => {
  describe('accepts valid AU mobiles', () => {
    it('national format with spaces', () => {
      expect(normalizeAuMobile('0412 345 678')).toBe('+61412345678')
    })
    it('national format no spaces', () => {
      expect(normalizeAuMobile('0412345678')).toBe('+61412345678')
    })
    it('international format with spaces', () => {
      expect(normalizeAuMobile('+61 412 345 678')).toBe('+61412345678')
    })
    it('international format no spaces', () => {
      expect(normalizeAuMobile('+61412345678')).toBe('+61412345678')
    })
    it('parens and dashes', () => {
      // libphonenumber tolerates common punctuation
      expect(normalizeAuMobile('(0412) 345-678')).toBe('+61412345678')
    })
  })

  describe('rejects invalid input', () => {
    it('too short', () => {
      expect(normalizeAuMobile('041234567')).toBeNull()
    })
    it('empty string', () => {
      expect(normalizeAuMobile('')).toBeNull()
    })
    it('alphabetic junk', () => {
      expect(normalizeAuMobile('not a phone')).toBeNull()
    })
    it('Sydney landline (02)', () => {
      expect(normalizeAuMobile('02 9123 4567')).toBeNull()
    })
    it('Melbourne landline (03)', () => {
      expect(normalizeAuMobile('03 9123 4567')).toBeNull()
    })
  })

  describe('rejects non-AU numbers', () => {
    it('US mobile in international format', () => {
      expect(normalizeAuMobile('+1 555 123 4567')).toBeNull()
    })
    it('UK mobile in international format', () => {
      expect(normalizeAuMobile('+44 7400 123456')).toBeNull()
    })
  })
})
