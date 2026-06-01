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
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

export interface AdminContext {
  workspaceId: string
  agentId: string
  isAdmin: boolean
}

export async function resolveAdminContext(
  db: SupabaseClient,
  userId: string,
): Promise<AdminContext | null> {
  const agent = await resolvePrimaryAgent(db, userId, { requireWorkspace: true })
  if (!agent?.workspace_id) return null

  const { data: membership } = await db
    .from('workspace_members')
    .select('role')
    .eq('user_id', userId)
    .eq('workspace_id', agent.workspace_id)
    .maybeSingle()

  const role = membership?.role as string | undefined
  return {
    workspaceId: agent.workspace_id as string,
    agentId: agent.id as string,
    isAdmin: role === 'owner' || role === 'admin',
  }
}
