import { describe, expect, it } from 'vitest'
import { findCoolingCandidates, type CoolingActivityRow, DEFAULT_COOLING } from './cooling'

const NOW = new Date('2026-06-01T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

const rows = (contactId: string, ...days: number[]): CoolingActivityRow[] =>
  days.map((d) => ({ contactId, occurredAt: daysAgo(d) }))

describe('findCoolingCandidates', () => {
  it('flags a contact active in the prior window but quiet recently', () => {
    const out = findCoolingCandidates(rows('a', 10, 12, 14, 20), NOW)
    expect(out.has('a')).toBe(true)
    expect(out.get('a')?.priorCount).toBe(4)
    expect(out.get('a')?.gapDays).toBe(10) // most-recent prior activity is 10d ago
  })

  it('excludes a contact with any recent activity (still warm)', () => {
    const out = findCoolingCandidates(rows('a', 2, 10, 12, 14), NOW)
    expect(out.has('a')).toBe(false)
  })

  it('excludes a contact below the prior-activity minimum', () => {
    const out = findCoolingCandidates(rows('a', 10, 12), NOW) // only 2 < priorMin 3
    expect(out.has('a')).toBe(false)
  })

  it('ignores activity older than the prior window', () => {
    // All activity 40–50d ago, beyond priorDays=28 → no prior activity counted.
    const out = findCoolingCandidates(rows('a', 40, 45, 50), NOW)
    expect(out.has('a')).toBe(false)
  })

  it('separates contacts independently', () => {
    const out = findCoolingCandidates(
      [...rows('cool', 9, 11, 13), ...rows('warm', 1, 10, 12, 14)],
      NOW,
    )
    expect(out.has('cool')).toBe(true)
    expect(out.has('warm')).toBe(false)
  })

  it('respects custom thresholds', () => {
    // priorMin 5 — the 4-activity contact no longer qualifies.
    const out = findCoolingCandidates(rows('a', 10, 12, 14, 20), NOW, {
      ...DEFAULT_COOLING,
      priorMin: 5,
    })
    expect(out.has('a')).toBe(false)
  })

  it('skips rows with unparseable timestamps', () => {
    const out = findCoolingCandidates(
      [{ contactId: 'a', occurredAt: 'not-a-date' }, ...rows('a', 10, 12, 14)],
      NOW,
    )
    expect(out.get('a')?.priorCount).toBe(3)
  })
})
