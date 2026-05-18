import { describe, it, expect } from 'vitest'
import { resumeTurnId } from './resume'

describe('resumeTurnId', () => {
  it('null lands at the intro', () => {
    expect(resumeTurnId(null)).toBe(0)
  })

  it('undefined lands at the intro', () => {
    expect(resumeTurnId(undefined)).toBe(0)
  })

  it("'profile' lands at the intro (signup completed, no turn yet)", () => {
    expect(resumeTurnId('profile')).toBe(0)
  })

  it("'script' resumes at the patch turn", () => {
    expect(resumeTurnId('script')).toBe(3)
  })

  it("'core_markets' resumes at contacts", () => {
    expect(resumeTurnId('core_markets')).toBe(4)
  })

  it("'contacts' resumes at notify", () => {
    expect(resumeTurnId('contacts')).toBe(5)
  })

  it("'notify' resumes at pair", () => {
    expect(resumeTurnId('notify')).toBe(6)
  })

  it("'pair' resumes at live", () => {
    expect(resumeTurnId('pair')).toBe(7)
  })

  it("'done' is a guard — bootstrap redirects, but fall back to live", () => {
    expect(resumeTurnId('done')).toBe(7)
  })
})
