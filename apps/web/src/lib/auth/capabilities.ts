/**
 * HOR-376 — Canonical permission layer (Phase 1 of the Access Control epic, HOR-373).
 *
 * One front door for "who can do what, over whose data". The handoff spec defines
 * TWO independent axes — do not collapse them:
 *
 *   • Role  = WHAT someone can do.   Source of truth: `agents.role`
 *             ('admin' | 'manager' | 'agent').
 *   • Scope = WHOSE data they touch. Driven by seat + assignment:
 *             - admin   → the whole account (all agents in the workspace)
 *             - manager → account-wide VIEW, but acts only on their OWN assignments
 *             - agent   → their own assignments
 *             - support → the agent(s) they're a delegate of (allowedAgentIds)
 *
 * The four spec "roles" map onto our two columns as:
 *   Admin   = role 'admin'
 *   Manager = role 'manager'
 *   Agent   = role 'agent', seat_type 'agent'
 *   Support = seat_type 'support'   (role stays 'agent'; the seat is the discriminator)
 *
 * Canonical-role decision (Andy, 2026-06-02): `agents.role` is the single source of
 * truth for the Role axis. `workspace_members.role` is demoted to a membership gate.
 * Existing `members.role` 'owner' maps to Admin. This module reads agents.role only.
 *
 * Composed roles (player-manager) fall out for free: a Manager who also holds
 * assignments acts as an Agent on THOSE (own actionable scope), while still getting
 * the account-wide Manager capabilities. A pure oversight Manager has an actionable
 * scope of just their own (empty-of-contacts) agent id — i.e. they cannot impersonate
 * anyone, which is exactly the spec's "Manager is oversight, not impersonation".
 *
 * Phase 1 is the resolver + capability matrix + tests. It does NOT yet tighten any
 * existing route gate (e.g. billing is still owner|admin today; the spec wants it
 * Admin-only — that tightening lands with HOR-377 / HOR-375). Routes migrate onto
 * `getActor()` incrementally.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

export type AgentRole = 'agent' | 'manager' | 'admin'
export type SeatType = 'agent' | 'support'

/** Role seniority for the invite/grant ceiling. Higher = more senior. */
export const ROLE_RANK: Record<AgentRole, number> = { agent: 1, manager: 2, admin: 3 }

/**
 * HOR-377 — may `actorRole` grant/assign `targetRole`? The spec's invite bound:
 * "a user can only grant a role at or below their own". Agents (rank 1) cannot
 * grant at all (no manage_team).
 */
export function canGrantRole(actorRole: AgentRole, targetRole: AgentRole): boolean {
  if (actorRole === 'agent') return false // agents have no team-management power
  return ROLE_RANK[targetRole] <= ROLE_RANK[actorRole]
}

/**
 * HOR-377 — full guard for a role-change action. Encodes the grant ceiling and
 * the no-self-escalation rule. The last-admin invariant is enforced at the DB
 * layer (enforce_last_admin trigger); this only blocks self-escalation + ceiling.
 *
 * Returns a discriminated result so callers can map the reason to an HTTP status.
 */
export function checkRoleChange(input: {
  actorRole: AgentRole
  actorIsSelf: boolean
  currentRole: AgentRole
  nextRole: AgentRole
}): { ok: true } | { ok: false; reason: 'forbidden' | 'self_escalation' | 'ceiling' } {
  const { actorRole, actorIsSelf, currentRole, nextRole } = input

  // Must be able to manage team at all.
  if (actorRole !== 'admin' && actorRole !== 'manager') return { ok: false, reason: 'forbidden' }

  // No self-escalation: you cannot raise your own rank.
  if (actorIsSelf && ROLE_RANK[nextRole] > ROLE_RANK[currentRole]) {
    return { ok: false, reason: 'self_escalation' }
  }

  // Ceiling: cannot grant a role above your own, and cannot act on someone whose
  // current role is above your own (a Manager can't demote an Admin either).
  if (!canGrantRole(actorRole, nextRole) || ROLE_RANK[currentRole] > ROLE_RANK[actorRole]) {
    return { ok: false, reason: 'ceiling' }
  }

  return { ok: true }
}

/**
 * The "what" axis. Each capability is a coarse, role-gated permission. The "whose"
 * axis (scope) is answered separately by `canActOnAgentScope` / `canViewAgentScope`.
 */
export type Capability =
  // Account-level, pure role gates:
  | 'manage_billing' //          Admin only
  | 'manage_team' //             Admin (full) + Manager (at/below self — ceiling enforced in HOR-377)
  | 'assign_properties' //       Admin + Manager (reassign any property)
  | 'manage_site_settings' //    Admin only
  | 'view_site_settings' //      Admin + Manager
  | 'view_all_signals' //        Admin + Manager (account-wide visibility)
  | 'export_account' //          Admin only (whole-account sovereign export)
  | 'export_own_scope' //        Agent (own scope) + Admin
  // Scoped "kind of action" gates — the boolean answers "can act on SOMETHING in
  // their scope"; the per-resource check is canActOnAgentScope(ownerAgentId):
  | 'edit_contacts' //           Admin (all) / Agent (own) / Support (on behalf) / player-Manager (own)
  | 'send_outreach' //           same scope rules as edit_contacts
  | 'import_edit_properties' //  same scope rules; pure Manager = "reassign only" (empty acting scope)

/** Sentinel for "actionable scope is the entire workspace" (Admin). */
export const ALL_AGENTS = Symbol('all-agents')

export interface Actor {
  userId: string
  /** The caller's primary agent row id. Null if they have no resolvable agent. */
  agentId: string | null
  workspaceId: string | null
  role: AgentRole
  seatType: SeatType
  /**
   * Agent ids whose data this actor may READ — own agent id plus, for a support
   * seat, the agents they're a delegate of. (Mirrors RLS `user_agent_ids()`.)
   */
  allowedAgentIds: string[]

  isAdmin: boolean
  isManager: boolean
  isAgent: boolean
  isSupport: boolean

  /** Coarse role-gated capability check (the "what" axis). */
  can(capability: Capability): boolean
  /**
   * May the actor READ data owned by `ownerAgentId`? Admin/Manager see the whole
   * account; everyone else is bounded to allowedAgentIds. With no argument, returns
   * whether the actor has account-wide read.
   */
  canViewAgentScope(ownerAgentId?: string | null): boolean
  /**
   * May the actor WRITE / send-as for data owned by `ownerAgentId`? Admin → any
   * owner in the workspace. Manager/Agent → own assignments only. Support → the
   * agents they're delegated to. This is the spec's "act on behalf, bounded".
   */
  canActOnAgentScope(ownerAgentId: string | null | undefined): boolean
}

/**
 * Read scope: own + delegated agents. Admin/Manager additionally get account-wide
 * read, handled in canViewAgentScope (not by enumerating every agent id here).
 */
function viewableAgentIds(role: AgentRole, allowedAgentIds: string[]): string[] {
  return allowedAgentIds
}

/**
 * Actionable (write/comms) scope. Admin → the whole account (ALL_AGENTS). Everyone
 * else acts only within their own/delegated agent ids. Crucially Manager is NOT
 * widened to the account here — a Manager acts only on their own assignments
 * (player-manager), never as another person (no impersonation).
 */
function actionableAgentIds(
  role: AgentRole,
  agentId: string | null,
  seatType: SeatType,
  allowedAgentIds: string[],
): typeof ALL_AGENTS | string[] {
  if (role === 'admin') return ALL_AGENTS
  if (seatType === 'support') return allowedAgentIds
  // agent + manager: their own assignments only.
  return agentId ? [agentId] : []
}

/** The capability matrix, straight from the handoff spec's permission table. */
const MATRIX: Record<Capability, (a: Actor) => boolean> = {
  manage_billing: (a) => a.role === 'admin',
  manage_team: (a) => a.role === 'admin' || a.role === 'manager',
  assign_properties: (a) => a.role === 'admin' || a.role === 'manager',
  manage_site_settings: (a) => a.role === 'admin',
  view_site_settings: (a) => a.role === 'admin' || a.role === 'manager',
  view_all_signals: (a) => a.role === 'admin' || a.role === 'manager',
  export_account: (a) => a.role === 'admin',
  // Agent may export own scope (gated behind an Admin grant in HOR-375); Admin
  // exports the whole account. Support has NO export power — its role is 'agent'
  // but the support seat discriminates, so gate on the true Agent identity.
  export_own_scope: (a) => a.role === 'admin' || a.isAgent,

  // Scoped actions: "can act on something in scope". Admin always; otherwise the
  // actor must have a non-empty actionable scope. A pure oversight Manager has only
  // their own (assignment-less) agent id → they can technically target it, but own
  // no contacts/properties, so in practice they act on nothing. A player-manager
  // owns assignments and acts on them. This yields the composed-role UNION the spec
  // asked us to confirm, with no extra role plumbing.
  edit_contacts: (a) => hasActionableScope(a),
  send_outreach: (a) => hasActionableScope(a),
  import_edit_properties: (a) => hasActionableScope(a),
}

function hasActionableScope(a: Actor): boolean {
  if (a.role === 'admin') return true
  return a.allowedAgentIds.length > 0
}

/** Build an Actor from already-resolved primitives. Pure — easy to unit-test. */
export function buildActor(input: {
  userId: string
  agentId: string | null
  workspaceId: string | null
  role: AgentRole
  seatType: SeatType
  allowedAgentIds: string[]
}): Actor {
  const { userId, agentId, workspaceId, role, seatType, allowedAgentIds } = input

  const actionable = actionableAgentIds(role, agentId, seatType, allowedAgentIds)
  const viewable = viewableAgentIds(role, allowedAgentIds)

  const actor: Actor = {
    userId,
    agentId,
    workspaceId,
    role,
    seatType,
    allowedAgentIds,
    isAdmin: role === 'admin',
    isManager: role === 'manager',
    isAgent: role === 'agent' && seatType === 'agent',
    isSupport: seatType === 'support',

    can(capability) {
      return MATRIX[capability](actor)
    },

    canViewAgentScope(ownerAgentId) {
      // Admin + Manager have account-wide read.
      if (role === 'admin' || role === 'manager') return true
      if (ownerAgentId == null) return false
      return viewable.includes(ownerAgentId)
    },

    canActOnAgentScope(ownerAgentId) {
      if (actionable === ALL_AGENTS) return true
      if (ownerAgentId == null) return false
      return actionable.includes(ownerAgentId)
    },
  }

  return actor
}

/**
 * Resolve the signed-in user to an {@link Actor}. Single front door for permission
 * decisions. Reuses {@link resolvePrimaryAgent}'s deterministic multi-workspace
 * tiebreak (own seat before support, oldest row) and adds the read/act scope.
 *
 * Pass `admin` (service-role client) so the agent + assignment lookups bypass RLS;
 * the capability layer itself is the authority. Returns null if the user has no
 * resolvable, non-departed agent.
 */
export async function getActor(
  admin: SupabaseClient,
  userId: string,
  opts: { requireWorkspace?: boolean } = {},
): Promise<Actor | null> {
  const agent = await resolvePrimaryAgent(admin, userId, {
    excludeDeparted: true,
    requireWorkspace: opts.requireWorkspace,
  })
  if (!agent) return null

  let allowedAgentIds: string[] = agent.id ? [agent.id] : []

  if (agent.seat_type === 'support' && agent.id) {
    const { data: assignments } = await admin
      // support_seat_assignments isn't in the generated types yet (regen deferred).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('support_seat_assignments' as any)
      .select('assigned_agent_id')
      .eq('support_agent_id', agent.id)

    allowedAgentIds = ((assignments as Array<{ assigned_agent_id: string }> | null) ?? [])
      .map((row) => row.assigned_agent_id)
      .filter(Boolean)
  }

  return buildActor({
    userId,
    agentId: agent.id,
    workspaceId: agent.workspace_id,
    role: agent.role,
    seatType: agent.seat_type,
    allowedAgentIds,
  })
}
