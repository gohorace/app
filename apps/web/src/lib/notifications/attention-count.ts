/**
 * Compute the badge count that drives the bell + sidebar indicators.
 *
 * V1 definition (matches `(dashboard)/layout.tsx:49-63`):
 *   high-intent contacts (score ≥ 50) + unread notification_log rows
 *   that have display copy (HOR-77 in-app feed).
 *
 * Slice B reminder: when property-subject moments land (Worth watching,
 * Ownership changed), the unread half here will need to broaden — most
 * likely to `WHERE moment_type IS NOT NULL` once that column exists.
 *
 * Uses the admin client to bypass RLS for a read-only count. Always
 * returns a number ≥ 0 — never null.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export async function fetchAttentionCount(
  admin: SupabaseClient<Database>,
  agentId: string,
): Promise<number> {
  const [{ count: highIntentContacts }, { count: unreadNotifications }] = await Promise.all([
    admin
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .is('deleted_at', null)
      .gte('score', 50),
    admin
      .from('notification_log')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .is('read_at', null)
      .not('title', 'is', null),
  ])
  return (highIntentContacts ?? 0) + (unreadNotifications ?? 0)
}
