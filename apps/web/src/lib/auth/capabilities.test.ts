import { describe, it, expect } from 'vitest'
import {
  buildActor,
  type AgentRole,
  type SeatType,
  type Capability,
  type Actor,
} from './capabilities'

/**
 * HOR-376 — the handoff permission matrix, as an executable spec.
 *
 * Two axes (do not collapse): Role = what you can do; Scope = whose data. The
 * role-gated "what" capabilities are table-tested here; the scoped acting/viewing
 * capabilities (edit_contacts, send_outreach, import_edit_properties) get dedicated
 * scope tests below, because their boolean only means "can act on something in MY
 * scope" — the per-resource guard is canActOnAgentScope().
 */

function actor(
  role: AgentRole,
  seatType: SeatType,
  opts: { agentId?: string; allowedAgentIds?: string[] } = {},
): Actor {
  const agentId = opts.agentId ?? 'self'
  return buildActor({
    userId: `user-${role}-${seatType}`,
    agentId,
    workspaceId: 'ws-1',
    role,
    seatType,
    allowedAgentIds: opts.allowedAgentIds ?? [agentId],
  })
}

const ADMIN = actor('admin', 'agent', { agentId: 'A' })
const MANAGER = actor('manager', 'agent', { agentId: 'M' })
const AGENT = actor('agent', 'agent', { agentId: 'G' })
// A support seat delegated to two agents (X and Y); its own row id is 'S'.
const SUPPORT = actor('agent', 'support', { agentId: 'S', allowedAgentIds: ['X', 'Y'] })

describe('role-gated capabilities (the "what" axis)', () => {
  // Capability → [admin, manager, agent, support] expected booleans.
  const EXPECTED: Record<Capability, [boolean, boolean, boolean, boolean]> = {
    manage_billing: [true, false, false, false],
    manage_team: [true, true, false, false],
    assign_properties: [true, true, false, false],
    manage_site_settings: [true, false, false, false],
    view_site_settings: [true, true, false, false],
    view_all_signals: [true, true, false, false],
    export_account: [true, false, false, false],
    export_own_scope: [true, false, true, false],
    // Scoped actions — boolean = "has an actionable scope at all". Admin always;
    // manager/agent have their own (non-empty) scope; support has its delegated
    // agents. A pure-oversight manager returns true here but owns nothing to act
    // on (the real gate is canActOnAgentScope, tested separately).
    edit_contacts: [true, true, true, true],
    send_outreach: [true, true, true, true],
    import_edit_properties: [true, true, true, true],
  }

  const SUBJECTS: [string, Actor][] = [
    ['admin', ADMIN],
    ['manager', MANAGER],
    ['agent', AGENT],
    ['support', SUPPORT],
  ]

  for (const cap of Object.keys(EXPECTED) as Capability[]) {
    SUBJECTS.forEach(([name, subject], i) => {
      const want = EXPECTED[cap][i]
      it(`${name} ${want ? 'can' : 'cannot'} ${cap}`, () => {
        expect(subject.can(cap)).toBe(want)
      })
    })
  }
})

describe('billing & account-management are bounded to the right roles', () => {
  it('only Admin manages billing', () => {
    expect(ADMIN.can('manage_billing')).toBe(true)
    expect(MANAGER.can('manage_billing')).toBe(false)
    expect(AGENT.can('manage_billing')).toBe(false)
    expect(SUPPORT.can('manage_billing')).toBe(false)
  })

  it('only Admin manages site & tracking settings; Manager views', () => {
    expect(ADMIN.can('manage_site_settings')).toBe(true)
    expect(MANAGER.can('manage_site_settings')).toBe(false)
    expect(MANAGER.can('view_site_settings')).toBe(true)
    expect(AGENT.can('view_site_settings')).toBe(false)
  })

  it('Support has zero account-level power', () => {
    for (const cap of [
      'manage_billing',
      'manage_team',
      'assign_properties',
      'manage_site_settings',
      'export_account',
    ] as Capability[]) {
      expect(SUPPORT.can(cap)).toBe(false)
    }
  })
})

describe('read scope ("whose data" — view axis)', () => {
  it('Admin and Manager see the whole account', () => {
    expect(ADMIN.canViewAgentScope('any-other-agent')).toBe(true)
    expect(MANAGER.canViewAgentScope('any-other-agent')).toBe(true)
    expect(ADMIN.canViewAgentScope()).toBe(true)
    expect(MANAGER.canViewAgentScope()).toBe(true)
  })

  it('Agent sees only their own', () => {
    expect(AGENT.canViewAgentScope('G')).toBe(true)
    expect(AGENT.canViewAgentScope('someone-else')).toBe(false)
    expect(AGENT.canViewAgentScope()).toBe(false)
  })

  it("Support sees only their linked agents' scope", () => {
    expect(SUPPORT.canViewAgentScope('X')).toBe(true)
    expect(SUPPORT.canViewAgentScope('Y')).toBe(true)
    expect(SUPPORT.canViewAgentScope('Z')).toBe(false)
    // Not even its own (empty) seat grants account-wide view.
    expect(SUPPORT.canViewAgentScope()).toBe(false)
  })
})

describe('acting scope ("whose data" — write/comms axis)', () => {
  it('Admin can act on any agent in the account', () => {
    expect(ADMIN.canActOnAgentScope('A')).toBe(true)
    expect(ADMIN.canActOnAgentScope('any-other-agent')).toBe(true)
  })

  it('Agent acts only on their own scope', () => {
    expect(AGENT.canActOnAgentScope('G')).toBe(true)
    expect(AGENT.canActOnAgentScope('someone-else')).toBe(false)
  })

  it('Manager is oversight, not impersonation — cannot act as another agent', () => {
    // The keystone guarantee: a Manager does NOT get to send/edit as anyone else.
    expect(MANAGER.canActOnAgentScope('M')).toBe(true) // their own (player-manager)
    expect(MANAGER.canActOnAgentScope('some-agent')).toBe(false) // no impersonation
  })

  it('Support acts on behalf of its linked agents, and no further', () => {
    expect(SUPPORT.canActOnAgentScope('X')).toBe(true)
    expect(SUPPORT.canActOnAgentScope('Y')).toBe(true)
    expect(SUPPORT.canActOnAgentScope('Z')).toBe(false)
    expect(SUPPORT.canActOnAgentScope('S')).toBe(false) // not its own empty seat
  })
})

describe('composed role — player-manager is the UNION of both roles', () => {
  // A Manager who is also assigned properties as an Agent. Same single agents row,
  // role='manager', holding their own assignments under agentId 'PM'.
  const playerManager = actor('manager', 'agent', { agentId: 'PM' })

  it('keeps account-wide Manager capabilities', () => {
    expect(playerManager.can('manage_team')).toBe(true)
    expect(playerManager.can('assign_properties')).toBe(true)
    expect(playerManager.can('view_all_signals')).toBe(true)
  })

  it('also acts as an Agent on their own assignments', () => {
    expect(playerManager.can('edit_contacts')).toBe(true)
    expect(playerManager.can('send_outreach')).toBe(true)
    expect(playerManager.canActOnAgentScope('PM')).toBe(true)
  })

  it('still cannot act as a different agent (no conflict, no impersonation)', () => {
    expect(playerManager.canActOnAgentScope('other-agent')).toBe(false)
  })

  it('does not inherit Admin-only powers', () => {
    expect(playerManager.can('manage_billing')).toBe(false)
    expect(playerManager.can('export_account')).toBe(false)
    expect(playerManager.can('manage_site_settings')).toBe(false)
  })
})

describe('support delegation — inherits the linked agent, bounded to its scope', () => {
  it('a contact owned by a linked agent is actionable; one outside is not', () => {
    expect(SUPPORT.canActOnAgentScope('X')).toBe(true)
    expect(SUPPORT.canActOnAgentScope('outside')).toBe(false)
  })

  it('a support seat with no assignments can act on nothing', () => {
    const orphan = actor('agent', 'support', { agentId: 'O', allowedAgentIds: [] })
    expect(orphan.can('edit_contacts')).toBe(false)
    expect(orphan.can('send_outreach')).toBe(false)
    expect(orphan.canActOnAgentScope('anyone')).toBe(false)
    expect(orphan.canViewAgentScope('anyone')).toBe(false)
  })
})

describe('legacy members.role → canonical agents.role parity', () => {
  // The pre-376 effective gate read workspace_members.role ∈ {owner, admin} for
  // "can manage team / invite". Confirm the canonical role mapping reproduces it:
  //   members owner  → agents admin   → Admin
  //   members admin  → agents manager → Manager
  //   members viewer → agents agent   → Agent
  const mapping: [string, AgentRole, boolean][] = [
    ['owner', 'admin', true],
    ['admin', 'manager', true],
    ['viewer', 'agent', false],
  ]

  for (const [membersRole, agentsRole, canManageTeam] of mapping) {
    it(`members '${membersRole}' → role '${agentsRole}' → manage_team ${canManageTeam}`, () => {
      expect(actor(agentsRole, 'agent').can('manage_team')).toBe(canManageTeam)
    })
  }
})
