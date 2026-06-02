/**
 * HOR-375 — export grants (Phase 7, Access Control epic).
 *
 * A pure Agent can self-export their own scope ONLY while an Admin grant is
 * active. Admins never need a grant (they hold `export_account` + `export_own_scope`
 * outright). This module answers "is there a live grant for this agent?".
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pure: is a grant active at `now`? A NULL expiry is an open-ended grant; any
 * other value lapses once passed. Extracted so expiry unit-tests without a DB.
 */
export function isGrantActive(grant: { expiresAt: string | null }, now: Date): boolean {
  if (grant.expiresAt == null) return true
  return new Date(grant.expiresAt).getTime() > now.getTime()
}

/** Does `agentId` hold at least one active (non-expired) export grant? */
export async function hasActiveExportGrant(
  admin: SupabaseClient,
  agentId: string,
): Promise<boolean> {
  const { data } = await admin
    // export_grants isn't in the generated types yet (regen deferred).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('export_grants' as any)
    .select('expires_at')
    .eq('granted_to_agent_id', agentId)
  const rows = (data as Array<{ expires_at: string | null }> | null) ?? []
  const now = new Date()
  return rows.some((r) => isGrantActive({ expiresAt: r.expires_at }, now))
}
