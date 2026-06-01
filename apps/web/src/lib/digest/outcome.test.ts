import { describe, expect, it } from 'vitest'
import { buildOutcome, type LatestSend } from './outcome'

/**
 * Unit tests for the deterministic outcome-loop builder (HOR-339 Phase 3).
 * The bulk loaders hit Supabase and are covered by /digest preview smoke;
 * buildOutcome is pure and is the piece worth pinning down.
 */

const NOW = new Date('2026-06-01T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const send = (over: Partial<LatestSend> & Pick<LatestSend, 'sentAt'>): LatestSend => ({
  firstOpenedAt: null,
  firstClickedAt: null,
  ...over,
})

describe('buildOutcome', () => {
  it('returns undefined when there is no prior send', () => {
    expect(buildOutcome(null, null, 'Marcus', NOW)).toBeUndefined()
  })

  it('recent send, unopened → sent, in-flight note (not quiet)', () => {
    const out = buildOutcome(send({ sentAt: hoursAgo(2) }), null, 'Marcus', NOW)
    expect(out?.steps).toEqual(['sent'])
    expect(out?.note).toMatch(/watching for the open/i)
  })

  it('recent send, opened, no reply → sent+opened, awaiting note', () => {
    const out = buildOutcome(
      send({ sentAt: hoursAgo(3), firstOpenedAt: hoursAgo(2) }),
      null,
      'Sarah',
      NOW,
    )
    expect(out?.steps).toEqual(['sent', 'opened'])
    expect(out?.note).toMatch(/give it a day/i)
  })

  it('old send, opened, no reply → quiet (No reply) with gentle note', () => {
    const out = buildOutcome(
      send({ sentAt: hoursAgo(72), firstOpenedAt: hoursAgo(70) }),
      null,
      'Sarah',
      NOW,
    )
    expect(out?.steps).toEqual(['sent', 'opened', 'quiet'])
    expect(out?.note).toMatch(/gentle/i)
  })

  it('old send, never opened, no reply → quiet with unopened note', () => {
    const out = buildOutcome(send({ sentAt: hoursAgo(72) }), null, 'Sarah', NOW)
    expect(out?.steps).toEqual(['sent', 'quiet'])
    expect(out?.note).toMatch(/unopened/i)
  })

  it('opened and clicked → sent+opened+clicked in order', () => {
    const out = buildOutcome(
      send({ sentAt: hoursAgo(5), firstOpenedAt: hoursAgo(4), firstClickedAt: hoursAgo(3) }),
      null,
      'Marcus',
      NOW,
    )
    expect(out?.steps).toEqual(['sent', 'opened', 'clicked'])
  })

  it('reply after the send → replied terminal step + warm note', () => {
    const out = buildOutcome(
      send({ sentAt: hoursAgo(48), firstOpenedAt: hoursAgo(47) }),
      hoursAgo(2),
      'Marcus',
      NOW,
    )
    expect(out?.steps).toEqual(['sent', 'opened', 'replied'])
    expect(out?.note).toMatch(/Marcus replied/)
  })

  it('reply that predates the latest send is ignored (belongs to an older thread)', () => {
    const out = buildOutcome(
      send({ sentAt: hoursAgo(2), firstOpenedAt: hoursAgo(1) }),
      hoursAgo(200),
      'Marcus',
      NOW,
    )
    expect(out?.steps).not.toContain('replied')
    expect(out?.steps).toEqual(['sent', 'opened'])
  })

  it('falls back to "They" when the first name is blank', () => {
    const out = buildOutcome(send({ sentAt: hoursAgo(1) }), hoursAgo(0.5), '  ', NOW)
    expect(out?.note).toMatch(/^They replied/)
  })
})
