import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ContactRow } from '@/components/reference/types'
import { getRoles } from '@/lib/contacts/roles'
import { deriveContactSignal } from './derive-signal'
import { formatTimestamptz } from './format'

type Admin = ReturnType<typeof createAdminClient>

// Workspace-bounded ceiling. Sort/filter/paginate run in-table over this set;
// at current volumes a single workspace is well under this. Raise (or move to
// true server-side range pagination) if a workspace ever approaches it.
const CAP = 2000

/**
 * Real data for the contacts substrate table.
 *
 * Base columns come straight from `contacts`; `intent` and `signal` are derived
 * from `score` (+ role); `sessions_7d` comes from the
 * `get_reference_contact_sessions_7d` RPC. If that RPC isn't applied yet the
 * count degrades to 0 rather than erroring, so the surface still renders.
 */
export async function loadReferenceContacts(
  admin: Admin,
  opts: { agentId: string; workspaceId: string | null },
): Promise<ContactRow[]> {
  const { agentId, workspaceId } = opts

  const { data: rows } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email, score, last_seen_at, metadata')
    .eq('agent_id', agentId)
    .is('deleted_at', null)
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(CAP)
  const base = rows ?? []

  // sessions_7d — distinct active sessions per contact in the last 7 days.
  const sessions = new Map<string, number>()
  if (workspaceId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await admin.rpc('get_reference_contact_sessions_7d' as any, {
      p_workspace_id: workspaceId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    if (!error && Array.isArray(data)) {
      for (const r of data as Array<{ contact_id: string; sessions_7d: number }>) {
        sessions.set(r.contact_id, r.sessions_7d)
      }
    }
  }

  return base.map((c) => {
    const score = c.score ?? 0
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email || 'Unknown'
    const roleTypes = getRoles(c.metadata).map((r) => r.type)
    return {
      id: c.id,
      name,
      email: c.email ?? null,
      intent: Math.max(0, Math.min(99, score)),
      signal: deriveContactSignal(score, roleTypes),
      sessions_7d: sessions.get(c.id) ?? 0,
      last_seen: formatTimestamptz(c.last_seen_at),
    }
  })
}
