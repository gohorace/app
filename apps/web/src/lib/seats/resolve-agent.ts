/**
 * HOR-203 — Resolve the caller's primary agent row.
 *
 * A single user can hold multiple `agents` rows: their own agent seat plus
 * one or more support seats in OTHER workspaces. The table is
 * `UNIQUE(workspace_id, user_id)`, NOT unique on `user_id` alone, and the RLS
 * layer deliberately treats membership as a set (`user_agent_ids()`).
 *
 * Because of that, a bare `.eq('user_id', x).maybeSingle()` throws PGRST116
 * ("results contain N rows") for any multi-workspace user, which silently
 * breaks billing/OAuth/settings flows once support seats are in play. This
 * helper resolves the user's *own* workspace deterministically: prefer the
 * agent seat (`seat_type='agent'` sorts before `'support'`), then the oldest
 * row, and return the first match.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResolvedAgent {
  id: string
  workspace_id: string | null
  seat_type: 'agent' | 'support'
}

export async function resolvePrimaryAgent(
  admin: SupabaseClient,
  userId: string,
  opts: { requireWorkspace?: boolean; excludeDeparted?: boolean } = {},
): Promise<ResolvedAgent | null> {
  let query = admin
    .from('agents')
    // seat_type / status are added by later migrations and aren't in the
    // generated Database types yet — cast the projection (matches permissions.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('id, workspace_id, seat_type, status' as any)
    .eq('user_id', userId)

  if (opts.requireWorkspace) query = query.not('workspace_id', 'is', null)
  if (opts.excludeDeparted) query = query.neq('status', 'departed')

  // 'agent' < 'support' alphabetically → own seat wins; oldest row as tiebreak.
  const { data, error } = await query
    .order('seat_type', { ascending: true })
    .order('created_at', { ascending: true })

  if (error || !data || data.length === 0) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data[0] as any
  return {
    id: row.id as string,
    workspace_id: (row.workspace_id as string | null) ?? null,
    seat_type: row.seat_type === 'support' ? 'support' : 'agent',
  }
}
