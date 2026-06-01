import { describe, it, expect } from 'vitest'
import {
  propertyReadProvenance,
  propertyReadUpdatedAt,
  signalReadHash,
  fallbackPropertyRead,
} from './property-read'
import type { PropertySignal, CirclingContact, PropertyTimelineRow } from '@/lib/properties/signal'

function circler(over: Partial<CirclingContact> = {}): CirclingContact {
  return {
    contactId: 'c-sarah',
    name: 'Sarah Thompson',
    firstName: 'Sarah',
    initials: 'ST',
    identity: 'known',
    pct: 0.8,
    tier: 'Hot',
    delta: 3,
    lastSeen: '2026-05-30T10:00:00.000Z',
    read: 'Requested an appraisal · 3 visits this week',
    ...over,
  }
}

function moment(over: Partial<Extract<PropertyTimelineRow, { kind: 'moment' }>> = {}): PropertyTimelineRow {
  return {
    id: 'm1',
    kind: 'moment',
    label: 'Appraisal request',
    detail: 'Sarah requested an appraisal',
    tie: 'via the appraisal form',
    occurredAt: '2026-05-31T09:00:00.000Z',
    ...over,
  }
}

function signal(over: Partial<PropertySignal> = {}): PropertySignal {
  return {
    circling: [circler()],
    timeline: [moment()],
    changeChips: [],
    anonSessions: 0,
    engagement: 3,
    knownCount: 1,
    ...over,
  }
}

describe('propertyReadProvenance', () => {
  it('leads with weekly visits and folds in the standout moment', () => {
    expect(propertyReadProvenance(signal({ circling: [circler({ delta: 3 })] }))).toBe(
      'Built from 3 visits this week + an appraisal request',
    )
  })

  it('singularises a one-visit week', () => {
    expect(propertyReadProvenance(signal({ circling: [circler({ delta: 1 })], timeline: [] }))).toBe(
      'Built from 1 visit this week',
    )
  })

  it('falls back to anonymous sessions when no attributed visits', () => {
    const s = signal({ circling: [circler({ delta: 0 })], timeline: [], anonSessions: 4 })
    expect(propertyReadProvenance(s)).toBe('Built from 4 anonymous sessions this month')
  })

  it('is quiet when there is nothing to build from', () => {
    const s = signal({ circling: [], timeline: [], anonSessions: 0 })
    expect(propertyReadProvenance(s)).toBe('Quiet so far — nothing to build a read from yet')
  })
})

describe('propertyReadUpdatedAt', () => {
  it('takes the most recent of newest timeline row and hottest lastSeen', () => {
    const s = signal({
      timeline: [moment({ occurredAt: '2026-05-31T09:00:00.000Z' })],
      circling: [circler({ lastSeen: '2026-05-29T00:00:00.000Z' })],
    })
    expect(propertyReadUpdatedAt(s)).toBe('2026-05-31T09:00:00.000Z')
  })

  it('falls back to lastSeen when the timeline is empty', () => {
    const s = signal({ timeline: [], circling: [circler({ lastSeen: '2026-05-20T00:00:00.000Z' })] })
    expect(propertyReadUpdatedAt(s)).toBe('2026-05-20T00:00:00.000Z')
  })

  it('is null when there is no activity at all', () => {
    expect(propertyReadUpdatedAt(signal({ timeline: [], circling: [] }))).toBeNull()
  })
})

describe('signalReadHash', () => {
  it('changes when the hottest contact’s delta changes', () => {
    const a = signalReadHash(signal({ circling: [circler({ delta: 3 })] }))
    const b = signalReadHash(signal({ circling: [circler({ delta: 5 })] }))
    expect(a).not.toBe(b)
  })

  it('is stable for an unchanged signal', () => {
    expect(signalReadHash(signal())).toBe(signalReadHash(signal()))
  })
})

describe('fallbackPropertyRead', () => {
  const ADDR = '14 Cascade St, Paddington NSW'

  it('leads with the hottest contact + their moment', () => {
    const r = fallbackPropertyRead(signal(), ADDR)
    expect(r).toContain('Sarah Thompson')
    expect(r).toContain('14 Cascade St')
    expect(r).toContain('requested an appraisal')
  })

  it('reports anonymous-only interest when no one is named', () => {
    const r = fallbackPropertyRead(signal({ circling: [], timeline: [], anonSessions: 5 }), ADDR)
    expect(r).toContain('5 anonymous sessions')
  })

  it('is quiet when the property is cold', () => {
    const r = fallbackPropertyRead(signal({ circling: [], timeline: [], anonSessions: 0 }), ADDR)
    expect(r.toLowerCase()).toContain('quiet')
  })
})
