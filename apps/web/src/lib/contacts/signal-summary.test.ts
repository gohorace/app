import { describe, it, expect } from 'vitest'
import { tierForScore, weeklyDelta, whatChanged } from './signal-summary'
import type { MergedEvent } from './events'

// Fixed clock so the 7-day window is deterministic.
const NOW = new Date('2026-05-31T12:00:00.000Z').getTime()
const HOURS = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const DAYS = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

function ev(partial: Partial<MergedEvent> & { event_type: string; occurred_at: string }): MergedEvent {
  return {
    id: Math.random().toString(36).slice(2),
    event_type: partial.event_type,
    properties: partial.properties ?? {},
    score_delta: partial.score_delta ?? 0,
    occurred_at: partial.occurred_at,
  } as MergedEvent
}

describe('tierForScore', () => {
  it('maps high intent to Hot terracotta', () => {
    const t = tierForScore(92)
    expect(t.word).toBe('Hot')
    expect(t.color).toBe('#C4622D')
    expect(t.pct).toBeCloseTo(0.92)
  })

  it('maps mid intent to Warming mustard', () => {
    const t = tierForScore(48)
    expect(t.word).toBe('Warming')
    expect(t.color).toBe('#B5922A')
  })

  it('maps low/none to Cold stone', () => {
    expect(tierForScore(8).word).toBe('Cold')
    expect(tierForScore(0).word).toBe('Cold')
    expect(tierForScore(0).color).toBe('#8C7B6B')
  })

  it('clamps pct into [0,1]', () => {
    expect(tierForScore(140).pct).toBe(1)
    expect(tierForScore(-10).pct).toBe(0)
  })
})

describe('weeklyDelta', () => {
  it('sums positive score deltas inside the trailing week', () => {
    const events = [
      ev({ event_type: 'page_view', score_delta: 5, occurred_at: HOURS(2) }),
      ev({ event_type: 'return_visit', score_delta: 9, occurred_at: DAYS(3) }),
      ev({ event_type: 'page_view', score_delta: 4, occurred_at: DAYS(10) }), // out of window
      ev({ event_type: 'scroll_depth', score_delta: -2, occurred_at: HOURS(1) }), // negative ignored
    ]
    expect(weeklyDelta(events, NOW)).toBe(14)
  })

  it('returns null when there is no positive movement', () => {
    expect(weeklyDelta([ev({ event_type: 'page_view', score_delta: 0, occurred_at: HOURS(1) })], NOW)).toBeNull()
    expect(weeklyDelta([], NOW)).toBeNull()
  })
})

describe('whatChanged', () => {
  it('emits a "back N× this week" chip for repeat sessions', () => {
    const events = [
      ev({ event_type: 'page_view', occurred_at: HOURS(2) }),
      ev({ event_type: 'page_view', occurred_at: DAYS(1) }),
      ev({ event_type: 'page_view', occurred_at: DAYS(2) }),
    ]
    const chips = whatChanged(events, NOW)
    expect(chips[0]).toEqual({ icon: 'repeat', label: 'Back 3× this week' })
  })

  it('reports sold-result reading and form starts honestly', () => {
    const events = [
      ev({ event_type: 'page_view', occurred_at: HOURS(2), properties: { path: '/sold/paddington' } }),
      ev({ event_type: 'page_view', occurred_at: HOURS(3), properties: { path: '/sold/surry-hills' } }),
      ev({ event_type: 'form_start', occurred_at: HOURS(4), properties: { path: '/sell/appraisal' } }),
    ]
    const chips = whatChanged(events, NOW)
    const labels = chips.map((c) => c.label)
    expect(labels).toContain('Read 2 sold results')
    expect(labels).toContain('Started an appraisal form')
  })

  it('invents nothing when events are sparse', () => {
    const chips = whatChanged([ev({ event_type: 'page_view', occurred_at: DAYS(1) })], NOW)
    expect(chips).toEqual([])
  })

  it('caps at three chips', () => {
    const events = [
      ev({ event_type: 'page_view', occurred_at: HOURS(1) }),
      ev({ event_type: 'page_view', occurred_at: DAYS(1) }),
      ev({ event_type: 'page_view', occurred_at: HOURS(2), properties: { path: '/sold/a' } }),
      ev({ event_type: 'form_start', occurred_at: HOURS(3) }),
      ev({ event_type: 'email_opened', occurred_at: HOURS(4) }),
    ]
    expect(whatChanged(events, NOW).length).toBeLessThanOrEqual(3)
  })
})
