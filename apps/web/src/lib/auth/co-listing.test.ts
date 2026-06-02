import { describe, it, expect } from 'vitest'
import { decideCanActOnProperty, CO_LISTING_ENABLED } from './co-listing'

/**
 * HOR-380 — co-listing permission core. The DB-backed helpers (agentsForProperty,
 * coListedPropertyIdsFor) are exercised by rolled-back prod probes; here we pin
 * the pure decision and the launch gate.
 */
describe('decideCanActOnProperty', () => {
  it('admin acts on any property regardless of membership', () => {
    expect(
      decideCanActOnProperty({ isAdmin: true, actorAgentId: 'a1', propertyAgentIds: [] }),
    ).toBe(true)
  })

  it('primary agent (listed) can act', () => {
    expect(
      decideCanActOnProperty({ isAdmin: false, actorAgentId: 'a1', propertyAgentIds: ['a1'] }),
    ).toBe(true)
  })

  it('co-agent (also listed) can act', () => {
    expect(
      decideCanActOnProperty({ isAdmin: false, actorAgentId: 'a2', propertyAgentIds: ['a1', 'a2'] }),
    ).toBe(true)
  })

  it('an agent not on the property cannot act', () => {
    expect(
      decideCanActOnProperty({ isAdmin: false, actorAgentId: 'a3', propertyAgentIds: ['a1', 'a2'] }),
    ).toBe(false)
  })

  it('no resolvable agent cannot act', () => {
    expect(
      decideCanActOnProperty({ isAdmin: false, actorAgentId: null, propertyAgentIds: ['a1'] }),
    ).toBe(false)
  })
})

describe('launch gate', () => {
  it('co-listing stays gated until the Product double-contact nudge ships', () => {
    // Guard: this MUST be false on main. Flipping it without the nudge is the
    // exact failure mode HOR-380 forbids — see the module header.
    expect(CO_LISTING_ENABLED).toBe(false)
  })
})
