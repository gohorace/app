import { describe, it, expect } from 'vitest'
import { deviceLabelFromUA, deviceKindFromUA } from './device-label'

// A small corpus of real-world UA strings. Not exhaustive — just
// enough to anchor the obvious cases and the fallback behaviour.
const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ipad:
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  macOs:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

describe('deviceLabelFromUA', () => {
  it('detects iPhone', () => {
    expect(deviceLabelFromUA(UA.iphone)).toBe('iPhone')
  })
  it('detects iPad', () => {
    expect(deviceLabelFromUA(UA.ipad)).toBe('iPad')
  })
  it('detects Android phone via "Mobile" token', () => {
    expect(deviceLabelFromUA(UA.androidPhone)).toBe('Android phone')
  })
  it('detects Android tablet (no "Mobile" token)', () => {
    expect(deviceLabelFromUA(UA.androidTablet)).toBe('Android tablet')
  })
  it('falls back to "phone" for desktop UAs', () => {
    expect(deviceLabelFromUA(UA.macOs)).toBe('phone')
    expect(deviceLabelFromUA(UA.windows)).toBe('phone')
  })
  it('falls back to "phone" for empty UA', () => {
    expect(deviceLabelFromUA('')).toBe('phone')
    expect(deviceLabelFromUA(null)).toBe('phone')
    expect(deviceLabelFromUA(undefined)).toBe('phone')
  })
})

describe('deviceKindFromUA', () => {
  it('iPhone → mobile', () => {
    expect(deviceKindFromUA(UA.iphone)).toBe('mobile')
  })
  it('iPad → tablet', () => {
    expect(deviceKindFromUA(UA.ipad)).toBe('tablet')
  })
  it('Android phone → mobile', () => {
    expect(deviceKindFromUA(UA.androidPhone)).toBe('mobile')
  })
  it('Android tablet → tablet', () => {
    expect(deviceKindFromUA(UA.androidTablet)).toBe('tablet')
  })
  it('desktop OSes → other', () => {
    expect(deviceKindFromUA(UA.macOs)).toBe('other')
    expect(deviceKindFromUA(UA.windows)).toBe('other')
  })
  it('empty UA → other', () => {
    expect(deviceKindFromUA('')).toBe('other')
    expect(deviceKindFromUA(null)).toBe('other')
    expect(deviceKindFromUA(undefined)).toBe('other')
  })
})
