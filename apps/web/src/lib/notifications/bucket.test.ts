import { describe, expect, it } from 'vitest'
import { bucketFor, formatTimeAgo } from './bucket'

const TZ = 'Australia/Sydney'

describe('bucketFor', () => {
  it('returns "today" for the same local day', () => {
    const now = new Date('2026-05-14T10:00:00+10:00')
    const at = new Date('2026-05-14T01:00:00+10:00')
    expect(bucketFor(at, now, TZ)).toBe('today')
  })

  it('returns "yesterday" for the previous local day', () => {
    const now = new Date('2026-05-14T10:00:00+10:00')
    const at = new Date('2026-05-13T22:00:00+10:00')
    expect(bucketFor(at, now, TZ)).toBe('yesterday')
  })

  it('returns "week" for 2–6 days back', () => {
    const now = new Date('2026-05-14T10:00:00+10:00')
    const fourDaysAgo = new Date('2026-05-10T10:00:00+10:00')
    expect(bucketFor(fourDaysAgo, now, TZ)).toBe('week')
  })

  it('returns "earlier" for >6 days back', () => {
    const now = new Date('2026-05-14T10:00:00+10:00')
    const twoWeeks = new Date('2026-04-30T10:00:00+10:00')
    expect(bucketFor(twoWeeks, now, TZ)).toBe('earlier')
  })
})

describe('formatTimeAgo', () => {
  it('renders short form for minutes', () => {
    const now = new Date('2026-05-14T10:12:00+10:00')
    const at = new Date('2026-05-14T10:00:00+10:00')
    expect(formatTimeAgo(at, now, TZ)).toBe('12m')
  })

  it('renders Nh for same-day hours', () => {
    const now = new Date('2026-05-14T10:00:00+10:00')
    const at = new Date('2026-05-14T08:00:00+10:00')
    expect(formatTimeAgo(at, now, TZ)).toBe('2h')
  })

  it('renders Yesterday for the previous day', () => {
    const now = new Date('2026-05-14T10:00:00+10:00')
    const at = new Date('2026-05-13T22:00:00+10:00')
    expect(formatTimeAgo(at, now, TZ)).toBe('Yesterday')
  })
})
