import { describe, it, expect } from 'vitest'
import { isStillActive } from './verify'

describe('isStillActive', () => {
  it('treats a plain listing page as active', () => {
    expect(isStillActive('<html><body><h1>12 Smith Street, Glebe</h1></body></html>')).toBe(true)
  })

  it('flags a SOLD banner in the heading', () => {
    expect(isStillActive('<html><body><h1>12 Smith Street — SOLD</h1></body></html>')).toBe(false)
  })

  it('flags an Under Offer status element', () => {
    expect(
      isStillActive('<html><body><h1>12 Smith Street</h1><div class="property-status">Under Offer</div></body></html>'),
    ).toBe(false)
  })

  it('flags Under Contract', () => {
    expect(isStillActive('<html><body><h1>Beautiful home — Under Contract</h1></body></html>')).toBe(false)
  })
})
