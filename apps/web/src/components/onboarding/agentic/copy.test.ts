import { describe, it, expect } from 'vitest'
import { BANNED_IN_HORACE, HORACE_SAMPLES, SIGNOFF_KEY, horace } from './copy'

/**
 * Voice rules for the agentic onboarding shell. Mirrors
 * docs/alerts-copy-standards.md applied at compile time so a regression
 * in copy.ts breaks the build, not user trust.
 */

// Emoji codepoint ranges — Misc Symbols, Dingbats, Misc Pictographs,
// Transport & Map, Emoticons, Supplemental Symbols, plus regional
// indicators. Catches every emoji we'd ever realistically ship.
const EMOJI_RE =
  /[☀-➿]|[\u{1F000}-\u{1FAFF}]|[\u{1F300}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA70}-\u{1FAFF}]/u

describe('horace voice', () => {
  for (const { key, value } of HORACE_SAMPLES) {
    describe(key, () => {
      it('no exclamation marks', () => {
        expect(value).not.toContain('!')
      })

      it('no emoji', () => {
        expect(value).not.toMatch(EMOJI_RE)
      })

      it('no banned terms (case-insensitive, whole word)', () => {
        const lower = value.toLowerCase()
        for (const word of BANNED_IN_HORACE) {
          const re = new RegExp(`\\b${word}\\b`, 'i')
          expect(lower.match(re), `"${word}" found in horace.${key}: "${value}"`)
            .toBeNull()
        }
      })

      it('non-empty after trim', () => {
        expect(value.trim().length).toBeGreaterThan(0)
      })
    })
  }

  it('"Seize the moment" appears only in the T7 sign-off', () => {
    for (const { key, value } of HORACE_SAMPLES) {
      const hasPhrase = /seize the moment/i.test(value)
      if (key === SIGNOFF_KEY) {
        expect(hasPhrase, `${key} should contain the sign-off`).toBe(true)
      } else {
        expect(hasPhrase, `${key} must not contain the sign-off`).toBe(false)
      }
    }
  })

  it('t1_greet interpolates first name when present', () => {
    expect(horace.t1_greet('Davey')).toContain('Davey')
  })

  it('t1_greet has a sane fallback when first name is missing', () => {
    const out = horace.t1_greet(null)
    expect(out.length).toBeGreaterThan(0)
    expect(out).not.toContain('null')
    expect(out).not.toContain('undefined')
  })
})
