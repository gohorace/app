import { describe, it, expect } from 'vitest'
import {
  tierFor,
  recencyScore,
  volumeScore,
  pullScore,
  propertyEventVerb,
  buildChangeChips,
  derivePropertySignal,
  type PropertyEventRow,
  type EngagementRollupRow,
  type ContactLite,
  type CirclingContact,
} from './signal'

const NOW = Date.parse('2026-06-01T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString()
}

function contact(id: string, over: Partial<ContactLite> = {}): ContactLite {
  return {
    id,
    first_name: 'First',
    last_name: 'Last',
    email: `${id}@example.com`,
    phone: '0400000000',
    score: 50,
    last_seen_at: iso(2 * HOUR),
    ...over,
  }
}

function ev(over: Partial<PropertyEventRow> & { id: string }): PropertyEventRow {
  return {
    event_type: 'page_view',
    properties: {},
    occurred_at: iso(HOUR),
    contact_id: null,
    session_id: null,
    page_type: null,
    ...over,
  }
}

describe('scoring primitives', () => {
  it('tierFor maps the prototype thresholds', () => {
    expect(tierFor(0.82).word).toBe('Hot')
    expect(tierFor(0.66).word).toBe('Hot')
    expect(tierFor(0.44).word).toBe('Warming')
    expect(tierFor(0.33).word).toBe('Warming')
    expect(tierFor(0.2).word).toBe('Cool')
    expect(tierFor(0).word).toBe('Cool')
  })

  it('recencyScore decays from ~1 to ~0 with a 5-day half-life', () => {
    expect(recencyScore(0)).toBeCloseTo(1, 5)
    expect(recencyScore(5 * DAY)).toBeCloseTo(0.5, 2)
    expect(recencyScore(10 * DAY)).toBeCloseTo(0.25, 2)
    expect(recencyScore(-1)).toBe(0)
    expect(recencyScore(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('volumeScore saturates', () => {
    expect(volumeScore(0)).toBe(0)
    expect(volumeScore(4)).toBeCloseTo(0.632, 2)
    expect(volumeScore(100)).toBeGreaterThan(0.99)
    expect(volumeScore(-3)).toBe(0)
  })

  it('pullScore is a clamped weighted blend', () => {
    expect(pullScore({ recency: 1, volume: 1, intent: 1 })).toBeCloseTo(1, 5)
    expect(pullScore({ recency: 0, volume: 0, intent: 0 })).toBe(0)
    // recency-dominant by weight
    expect(pullScore({ recency: 1, volume: 0, intent: 0 })).toBeCloseTo(0.45, 5)
  })
})

describe('propertyEventVerb', () => {
  it('distinguishes appraisal / sold / suburb pages', () => {
    expect(propertyEventVerb(ev({ id: 'a', event_type: 'page_view', page_type: 'appraisal' }))).toBe('Viewed the appraisal page')
    expect(propertyEventVerb(ev({ id: 'b', event_type: 'page_view', page_type: 'sold' }))).toBe('Browsed sold results')
    expect(propertyEventVerb(ev({ id: 'c', event_type: 'page_view', properties: { path: '/suburb-report' } }))).toBe('Read the suburb report')
    expect(propertyEventVerb(ev({ id: 'd', event_type: 'property_view' }))).toBe('Viewed the listing')
    expect(propertyEventVerb(ev({ id: 'e', event_type: 'return_visit' }))).toBe('Returned to the site')
  })
})

describe('derivePropertySignal — the Sarah/Marcus scenario', () => {
  const events: PropertyEventRow[] = [
    // Sarah — appraisal request (moment) + 3 visits this week, most recent 2h ago.
    ev({ id: 's-form', event_type: 'form_submit', page_type: 'appraisal', properties: { form_name: 'Book an appraisal' }, contact_id: 'sarah', session_id: 'sess-s1', occurred_at: iso(2 * HOUR) }),
    ev({ id: 's-v1', event_type: 'page_view', page_type: 'appraisal', contact_id: 'sarah', session_id: 'sess-s1', occurred_at: iso(4 * HOUR) }),
    ev({ id: 's-v2', event_type: 'property_view', contact_id: 'sarah', session_id: 'sess-s2', occurred_at: iso(1 * DAY) }),
    ev({ id: 's-v3', event_type: 'return_visit', contact_id: 'sarah', session_id: 'sess-s3', occurred_at: iso(2 * DAY) }),
    // Marcus — one sold-results browse 2 days ago.
    ev({ id: 'm-v1', event_type: 'page_view', page_type: 'sold', contact_id: 'marcus', session_id: 'sess-m1', occurred_at: iso(2 * DAY) }),
    // Two anonymous sessions this month.
    ev({ id: 'a1', event_type: 'property_view', contact_id: null, session_id: 'anon-1', occurred_at: iso(4 * DAY) }),
    ev({ id: 'a2', event_type: 'page_view', contact_id: null, session_id: 'anon-2', occurred_at: iso(6 * DAY) }),
    // Extra anon event sharing a session — must NOT inflate the session count.
    ev({ id: 'a3', event_type: 'page_view', contact_id: null, session_id: 'anon-2', occurred_at: iso(6 * DAY) }),
  ]
  const engagementRows: EngagementRollupRow[] = [
    { contact_id: 'sarah', type: 'doorstep_appraisal_request', first_engaged_at: iso(3 * DAY), last_engaged_at: iso(2 * HOUR), engagement_count: 4 },
    { contact_id: 'marcus', type: 'website_engagement', first_engaged_at: iso(2 * DAY), last_engaged_at: iso(2 * DAY), engagement_count: 1 },
  ]
  const contacts = new Map<string, ContactLite>([
    ['sarah', contact('sarah', { first_name: 'Sarah', last_name: 'Thompson', score: 80 })],
    ['marcus', contact('marcus', { first_name: 'Marcus', last_name: 'Bell', score: 40 })],
  ])

  const signal = derivePropertySignal({ now: NOW, propertyAddress: '14 Maple Street', events, engagementRows, contacts })

  it('ranks Sarah hottest and tiers correctly', () => {
    expect(signal.circling.map((c) => c.contactId)).toEqual(['sarah', 'marcus'])
    const sarah = signal.circling[0]
    const marcus = signal.circling[1]
    expect(sarah.pct).toBeGreaterThan(marcus.pct)
    expect(sarah.tier).toBe('Hot')
    expect(marcus.tier).toBe('Warming')
  })

  it('computes the per-week visit delta from live events', () => {
    const sarah = signal.circling[0]
    // 3 visit-type events within 7d (page_view, property_view, return_visit); the
    // form_submit is a moment, not a visit.
    expect(sarah.delta).toBe(3)
    expect(signal.circling[1].delta).toBe(1)
  })

  it('builds a read that leads with the strongest signal', () => {
    expect(signal.circling[0].read).toBe('Requested an appraisal · 3 visits this week')
    expect(signal.circling[1].read).toBe('Browsing sold results · 1 visit this week')
  })

  it('counts distinct anonymous sessions this month', () => {
    expect(signal.anonSessions).toBe(2) // anon-1 + anon-2 (a3 shares anon-2)
  })

  it('attributes known vs anon vs moment timeline rows', () => {
    const moment = signal.timeline.find((r) => r.kind === 'moment')
    expect(moment).toBeDefined()
    expect(moment).toMatchObject({ label: 'Appraisal requested' })
    if (moment?.kind === 'moment') {
      expect(moment.detail).toContain('Sarah Thompson')
      expect(moment.detail).toContain('14 Maple Street')
    }

    const known = signal.timeline.find((r) => r.kind === 'known')
    expect(known).toBeDefined()
    if (known?.kind === 'known') expect(known.contactName).toBe('Sarah Thompson')

    const anon = signal.timeline.find((r) => r.kind === 'anon')
    expect(anon).toBeDefined()
    if (anon?.kind === 'anon') expect(anon.label).toContain('Anonymous visit')
  })

  it('timeline is newest-first and excludes email/identity events', () => {
    const withEmail = [...events, ev({ id: 'mail', event_type: 'email_opened', contact_id: 'sarah', occurred_at: iso(1 * HOUR) })]
    const s = derivePropertySignal({ now: NOW, propertyAddress: '14 Maple Street', events: withEmail, engagementRows, contacts })
    expect(s.timeline.some((r) => r.id === 'mail')).toBe(false)
    const times = s.timeline.map((r) => Date.parse(r.occurredAt))
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('derives the three headline change chips', () => {
    expect(signal.changeChips).toEqual([
      { icon: 'flame', label: 'Appraisal requested · Sarah' },
      { icon: 'repeat', label: 'Sarah · +3 visits this week' },
      { icon: 'eye-off', label: '2 anonymous sessions' },
    ])
  })

  it('buckets coarse engagement from 7-day event volume', () => {
    // 8 events in the last 7d (3 sarah visits + 1 form + 1 marcus + a1 + a2 + a3) → bucket 2.
    expect(signal.engagement).toBe(2)
  })
})

describe('derivePropertySignal — edge cases', () => {
  it('returns an empty-but-valid signal with no events', () => {
    const s = derivePropertySignal({ now: NOW, propertyAddress: '1 Quiet Lane', events: [], engagementRows: [], contacts: new Map() })
    expect(s.circling).toEqual([])
    expect(s.timeline).toEqual([])
    expect(s.changeChips).toEqual([])
    expect(s.anonSessions).toBe(0)
    expect(s.engagement).toBe(0)
    expect(s.knownCount).toBe(0)
  })

  it('surfaces an inspection-only buyer from the rollup with no events', () => {
    const contacts = new Map<string, ContactLite>([['buyer', contact('buyer', { first_name: 'Bea', last_name: 'Buyer' })]])
    const s = derivePropertySignal({
      now: NOW,
      propertyAddress: '5 Inspection Rd',
      events: [],
      engagementRows: [{ contact_id: 'buyer', type: 'doorstep_buyer_enquiry', first_engaged_at: iso(1 * DAY), last_engaged_at: iso(1 * DAY), engagement_count: 1 }],
      contacts,
    })
    expect(s.circling).toHaveLength(1)
    expect(s.circling[0].read).toBe('Enquired at an inspection')
    expect(s.circling[0].delta).toBe(0)
  })

  it('drops circling rows whose contact was soft-deleted (absent from the map)', () => {
    const events = [ev({ id: 'x', event_type: 'property_view', contact_id: 'ghost', occurred_at: iso(HOUR) })]
    const s = derivePropertySignal({ now: NOW, propertyAddress: 'X', events, engagementRows: [], contacts: new Map() })
    expect(s.circling).toEqual([])
    // …but the event still renders as an anonymous timeline row.
    expect(s.timeline).toHaveLength(1)
    expect(s.timeline[0].kind).toBe('anon')
  })

  it('buildChangeChips omits sections that have no signal', () => {
    const circling: CirclingContact[] = [
      { contactId: 'c', name: 'C', firstName: 'C', initials: 'C', identity: 'known', pct: 0.5, tier: 'Warming', delta: 0, lastSeen: iso(DAY), read: 'Browsing this property' },
    ]
    expect(buildChangeChips({ circling, timeline: [], anonSessions: 0 })).toEqual([])
  })
})
