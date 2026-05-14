import { describe, expect, it } from 'vitest'
import { groupStacks } from './group-stack'
import type { StreamMoment } from '@/components/notifications/moment-types'

function m(id: string, contactId: string): StreamMoment {
  return {
    id,
    type: 'high_intent',
    unread: true,
    bucket: 'today',
    time: '1m',
    headline: `Headline for ${id}`,
    editorial: '',
    tags: [],
    subject: { kind: 'contact', id: contactId, initials: 'XX', name: 'X', context: 'X' },
    primary: 'Add to list',
  }
}

describe('groupStacks', () => {
  it('returns items unchanged when no two share a subject within the window', () => {
    const items = [m('a', 'c1'), m('b', 'c2'), m('c', 'c3')]
    const ts = [1000, 900, 800]
    const out = groupStacks(items, { sentAtMs: ts })
    expect(out).toHaveLength(3)
    expect(out[0].stack).toBeUndefined()
  })

  it('collapses adjacent rows on the same subject inside the window', () => {
    const items = [m('a', 'c1'), m('b', 'c1'), m('c', 'c1')]
    const ts = [1000, 999, 998] // all within ms — clearly under 2h
    const out = groupStacks(items, { sentAtMs: ts })
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
    expect(out[0].stack).toEqual({
      count: 2,
      headlines: ['Headline for b', 'Headline for c'],
    })
  })

  it('does not cross a subject boundary', () => {
    const items = [m('a', 'c1'), m('b', 'c2'), m('c', 'c1')]
    const ts = [3, 2, 1]
    const out = groupStacks(items, { sentAtMs: ts })
    // Each subject appears once — c1's two moments aren't adjacent so they don't merge.
    expect(out).toHaveLength(3)
  })

  it('respects the 2h window', () => {
    const items = [m('a', 'c1'), m('b', 'c1')]
    const threeHoursMs = 3 * 60 * 60 * 1000
    const ts = [threeHoursMs + 1000, 1000]
    const out = groupStacks(items, { sentAtMs: ts })
    expect(out).toHaveLength(2)
    expect(out[0].stack).toBeUndefined()
  })
})
