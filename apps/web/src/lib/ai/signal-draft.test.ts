import { describe, expect, it, vi } from 'vitest'
import {
  derivePretext,
  fetchSoldAlts,
  findBannedPhrase,
  type RecentSoldHit,
  type SoldAlt,
} from './signal-draft'

/**
 * Light unit tests around the deterministic, non-AI pieces of the Phase 2
 * signal-draft module: the banned-phrase firewall and the pretext-source
 * order. The Haiku-fronted `generateSignalDraft` itself is not unit-tested
 * here (live API surface; covered by /digest preview smoke).
 */

// ── Banned-phrase firewall ─────────────────────────────────────────────────

describe('findBannedPhrase', () => {
  it('returns null for a clean local-intro paragraph', () => {
    expect(
      findBannedPhrase(
        "Hi Sarah — a Paddington terrace just sold strongly and there's real momentum locally. Happy to share the result if useful. James",
      ),
    ).toBeNull()
  })

  it('catches "I saw" anywhere in the body', () => {
    expect(findBannedPhrase('Hi — I saw you looking at 47 Maple. James')).toBe('I saw')
  })

  it('catches "I noticed" (case-insensitive)', () => {
    expect(findBannedPhrase('I NOTICED a few visits and thought to reach out.')).toBe('I noticed')
  })

  it('catches "you viewed" and "browsing" — the highest-risk leaks', () => {
    expect(findBannedPhrase('Thought I’d reach out since you viewed our listings.')).toBe('you viewed')
    expect(findBannedPhrase('Saw you’ve been browsing the area.')).toBe('browsing')
  })

  it('catches "your recent visits" and "your activity"', () => {
    expect(findBannedPhrase('Following up on your recent visits to the site.')).toBe('your recent visits')
    expect(findBannedPhrase('Your activity caught my eye.')).toBe('your activity')
  })

  it('catches "you’ve been looking" with curly + straight apostrophes', () => {
    expect(findBannedPhrase('Hi — you’ve been looking at Glebe homes.')).toBe("you've been looking")
    expect(findBannedPhrase("Hi — you've been looking at Glebe homes.")).toBe("you've been looking")
  })

  it('catches "on our site" and "while you were on the website"', () => {
    expect(findBannedPhrase('Caught your visits on our site this week.')).toBe('on our site')
    expect(findBannedPhrase('While you were on the website, I thought to drop a line.')).toBe('on the website')
  })

  it('does NOT flag prose that legitimately mentions a sale or local intro', () => {
    const ok = [
      'A recent Paddington sale gave me good data on what’s moving.',
      'Just sold a terrace nearby — happy to share the read.',
      'I’m the local Paddington agent and wanted to introduce myself.',
    ]
    for (const s of ok) expect(findBannedPhrase(s)).toBeNull()
  })
})

// ── Pretext sourcing — order: recent-sold > prior-relationship > local-intro

interface FakeAdmin {
  // Returned by the bulk soldBySuburb fetch — not used here, passed directly.
  emailSends: Array<{ id: string }>
}

// Builds a minimal supabase client that just answers email_sends queries the
// same shape `getContactEmailSends` expects. We bypass it entirely for the
// recent-sold and local-intro cases because the soldBySuburb Map is passed
// in (no DB call). For the prior-relationship case, we mock the email-engagement
// helper module.
vi.mock('@/lib/contacts/email-engagement', () => ({
  getContactEmailSends: vi.fn(async (_admin: unknown, _agentId: string, contactId: string) => {
    if (contactId === 'has-history') return [{ id: 'es-1' }]
    return []
  }),
}))

const adminStub = {} as never

describe('derivePretext — source priority', () => {
  it('uses a recent-sold hit when one exists for the contact’s suburb', async () => {
    const sold = new Map<string, RecentSoldHit>([
      ['Paddington, NSW', { street_number: '47', street_name: 'Maple St', suburb: 'Paddington, NSW', last_activity_at: '2026-05-22T01:00:00Z' }],
    ])
    const p = await derivePretext(
      adminStub,
      'agent-1',
      { id: 'has-history', suburb: 'Paddington, NSW' },
      sold,
    )
    expect(p.source).toBe('recent-sold')
    expect(p.label).toBe('a recent Paddington, NSW sale')
    expect(p.detail).toContain('47 Maple St')
    expect(p.detail).toContain('Paddington, NSW')
  })

  it('falls back to prior-relationship when no recent sold exists but the contact has sends', async () => {
    const p = await derivePretext(
      adminStub,
      'agent-1',
      { id: 'has-history', suburb: 'Paddington, NSW' },
      new Map(),
    )
    expect(p.source).toBe('prior-relationship')
    expect(p.label).toBe('our recent correspondence')
    expect(p.detail).toBeUndefined()
  })

  it('falls back to a suburb-coloured local-intro when there is neither sold nor history', async () => {
    const p = await derivePretext(
      adminStub,
      'agent-1',
      { id: 'no-history', suburb: 'Noosaville, QLD' },
      new Map(),
    )
    expect(p.source).toBe('local-intro')
    expect(p.label).toContain('Noosaville, QLD')
  })

  it('falls back to a generic local-intro when the contact has no suburb', async () => {
    const p = await derivePretext(adminStub, 'agent-1', { id: 'no-history', suburb: null }, new Map())
    expect(p.source).toBe('local-intro')
    expect(p.label).toBe('a local introduction')
  })

  it('always returns a pretext — local-intro never throws', async () => {
    // Every (suburb × history) combination should resolve.
    for (const suburb of [null, 'Glebe, NSW']) {
      for (const id of ['has-history', 'no-history']) {
        const p = await derivePretext(adminStub, 'agent-1', { id, suburb }, new Map())
        expect(p.label.length).toBeGreaterThan(0)
      }
    }
  })
})

// ── fetchSoldAlts — composer swap-popover backing data ─────────────────────

describe('fetchSoldAlts', () => {
  it('returns [] when suburb is null without touching the DB', async () => {
    const from = vi.fn()
    const admin = { from } as unknown as Parameters<typeof fetchSoldAlts>[0]
    const out = await fetchSoldAlts(admin, 'agent-1', null)
    expect(out).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('queries with the agent + suburb + sold + window and applies the limit', async () => {
    const calls: Array<[string, unknown]> = []
    const rows: SoldAlt[] = [
      { id: 'p1', street_number: '14', street_name: 'Renny St', suburb: 'Paddington', price: 2340000, last_activity_at: '2026-06-01T00:00:00Z' },
      { id: 'p2', street_number: '8', street_name: 'Gurner St', suburb: 'Paddington', price: 1980000, last_activity_at: '2026-05-21T00:00:00Z' },
    ]
    // Chain builder that records the method invocations and returns itself
    // until the .limit() terminator, which resolves with the fake data.
    const builder = {
      select: (...args: unknown[]) => (calls.push(['select', args]), builder),
      eq: (...args: unknown[]) => (calls.push(['eq', args]), builder),
      in: (...args: unknown[]) => (calls.push(['in', args]), builder),
      gte: (...args: unknown[]) => (calls.push(['gte', args]), builder),
      order: (...args: unknown[]) => (calls.push(['order', args]), builder),
      limit: (...args: unknown[]) => {
        calls.push(['limit', args])
        return Promise.resolve({ data: rows, error: null })
      },
    }
    const admin = {
      from: (table: string) => {
        calls.push(['from', [table]])
        return builder
      },
    } as unknown as Parameters<typeof fetchSoldAlts>[0]

    const out = await fetchSoldAlts(admin, 'agent-1', 'Paddington', 5)
    expect(out).toEqual(rows)
    expect(calls.find((c) => c[0] === 'eq' && (c[1] as unknown[])[0] === 'status')?.[1]).toEqual(['status', 'sold'])
    expect(calls.find((c) => c[0] === 'eq' && (c[1] as unknown[])[0] === 'agent_id')?.[1]).toEqual(['agent_id', 'agent-1'])
    expect(calls.find((c) => c[0] === 'eq' && (c[1] as unknown[])[0] === 'suburb')?.[1]).toEqual(['suburb', 'Paddington'])
    expect(calls.find((c) => c[0] === 'limit')?.[1]).toEqual([5])
  })

  it('returns [] when the suburb is the empty string', async () => {
    const from = vi.fn()
    const admin = { from } as unknown as Parameters<typeof fetchSoldAlts>[0]
    const out = await fetchSoldAlts(admin, 'agent-1', '')
    expect(out).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
})
