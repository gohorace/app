/**
 * HOR-322 · Admin guard for the agency settings API surfaces (keys, export).
 *
 * Resolves the signed-in user to their workspace + agent and whether they're an
 * agency admin (workspace_members.role ∈ {owner, admin}). v1 keys and the full
 * data export are admin-only. Uses the untyped service client so the new
 * workspace_api_tokens columns (kind/key_hint/last_used_ip) don't fight the
 * not-yet-regenerated generated types.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getActor } from '@/lib/auth/capabilities'

export interface AdminContext {
  workspaceId: string
  agentId: string
  isAdmin: boolean
}

export async function resolveAdminContext(
  db: SupabaseClient,
  userId: string,
): Promise<AdminContext | null> {
  // HOR-376: route through the canonical permission layer. `agents.role` is now the
  // source of truth for the Role axis; it maps 1:1 to the pre-376 members.role gate
  // (owner→admin, admin→manager), so this preserves behaviour exactly.
  const actor = await getActor(db, userId, { requireWorkspace: true })
  if (!actor?.workspaceId || !actor.agentId) return null

  return {
    workspaceId: actor.workspaceId,
    agentId: actor.agentId,
    // Preserves the legacy gate (members.role ∈ {owner, admin} == agents.role ∈
    // {admin, manager}). HOR-377/HOR-375 will tighten the admin-only surfaces that
    // hang off this (v1 keys, whole-account export) to `actor.isAdmin`.
    isAdmin: actor.role === 'admin' || actor.role === 'manager',
  }
}
