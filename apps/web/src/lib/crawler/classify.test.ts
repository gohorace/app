import { describe, it, expect } from 'vitest'
import { classifyUrl, isSameSite } from './classify'

describe('classifyUrl', () => {
  it('tags active-listing detail pages', () => {
    expect(classifyUrl('https://x.au/listings/12-smith-st-glebe')).toBe('listing')
    expect(classifyUrl('https://x.au/property/45-jones-ave')).toBe('listing')
    expect(classifyUrl('https://x.au/properties/45-jones-ave')).toBe('listing')
    expect(classifyUrl('https://x.au/for-sale/9-king-rd')).toBe('listing')
  })

  it('tags sold pages, and sold wins over the broad listing path', () => {
    expect(classifyUrl('https://x.au/sold/12-smith-st')).toBe('sold')
    expect(classifyUrl('https://x.au/recently-sold/12-smith-st')).toBe('sold')
    expect(classifyUrl('https://x.au/sold-properties/9-king-rd')).toBe('sold')
  })

  it('tags suburb reports / area guides', () => {
    expect(classifyUrl('https://x.au/suburb-report/glebe')).toBe('suburb_report')
    expect(classifyUrl('https://x.au/area-guide/newtown')).toBe('suburb_report')
    expect(classifyUrl('https://x.au/market-update/2026-q2')).toBe('suburb_report')
  })

  it('returns null for bare index/landing pages', () => {
    expect(classifyUrl('https://x.au/properties')).toBeNull()
    expect(classifyUrl('https://x.au/properties/')).toBeNull()
    expect(classifyUrl('https://x.au/sold')).toBeNull()
    expect(classifyUrl('https://x.au/for-sale/')).toBeNull()
  })

  it('returns null for out-of-scope pages', () => {
    expect(classifyUrl('https://x.au/')).toBeNull()
    expect(classifyUrl('https://x.au/about')).toBeNull()
    expect(classifyUrl('https://x.au/contact')).toBeNull()
    expect(classifyUrl('https://x.au/blog/why-glebe-is-great')).toBeNull()
    expect(classifyUrl('https://x.au/rent/12-smith-st')).toBeNull()
  })

  it('returns null for unparseable input', () => {
    expect(classifyUrl('not a url')).toBeNull()
  })
})

describe('isSameSite', () => {
  it('treats www and apex as the same site', () => {
    expect(isSameSite('https://www.x.au/a', 'https://x.au')).toBe(true)
    expect(isSameSite('https://x.au/a', 'https://www.x.au')).toBe(true)
  })
  it('rejects third-party hosts', () => {
    expect(isSameSite('https://domain.com.au/listing', 'https://x.au')).toBe(false)
  })
})
