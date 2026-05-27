/**
 * Compute the badge count that drives the bell + sidebar indicators.
 *
 * HOR-231: counts unread, stream-eligible notification_log rows only, so
 * the badge equals the unread items in the notification stream. (It used to
 * also add high-intent contacts, which made the badge inaccurate.)
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
  // HOR-231: count only unread, stream-eligible notification_log rows so
  // the bell badge equals the unread items shown in the notification stream.
  // Previously this also added high-intent contacts (score >= 50), which
  // meant the badge could never match the stream. Scope mirrors the stream:
  // unread + has display copy (title) + tied to a contact (deriveMomentType
  // drops contact-less rows).
  const { count: unreadNotifications } = await admin
    .from('notification_log')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .is('read_at', null)
    .not('title', 'is', null)
    .not('contact_id', 'is', null)
  return unreadNotifications ?? 0
}
