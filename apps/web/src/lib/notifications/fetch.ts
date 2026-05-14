/**
 * Server-side fetch helper for the Notifications stream. The page (SSR
 * on `/notifications`) and the API endpoint (`GET /api/notifications`,
 * used by the desktop slide-over) both call this so the adapter pipeline
 * has one home.
 *
 * Returns the `StreamMoment[]` view-model directly — callers feed it
 * straight to `<NotificationStream items=…>`. Filtering already removes
 * rows that don't yield a derivable moment type (audit/email channels).
 *
 * Slice B: this helper shrinks dramatically once `notification_log`
 * carries moment_type / headline / editorial / tags natively.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { StreamMoment } from '@/components/notifications/moment-types'
import type { Database } from '@/types/database.types'
import { deriveMomentType } from './derive-moment-type'
import { groupStacks } from './group-stack'
import { toStreamMoment, type RawContactRow, type RawNotificationRow } from './to-stream-moment'

export const PAGE_SIZE = 30

export interface FetchStreamMomentsArgs {
  supabase: SupabaseClient<Database>
  agentId: string
  /** `sent_at` (ISO) of the last row from the previous page, or null. */
  cursor?: string | null
  /** Agent timezone for time-ago + bucket boundaries. */
  tz?: string | null
  /** Stub a clock for tests / fixtures. */
  now?: Date
  limit?: number
}

export interface FetchStreamMomentsResult {
  items: StreamMoment[]
  nextCursor: string | null
}

export async function fetchStreamMoments({
  supabase,
  agentId,
  cursor,
  tz,
  now = new Date(),
  limit = PAGE_SIZE,
}: FetchStreamMomentsArgs): Promise<FetchStreamMomentsResult> {
  let query = supabase
    .from('notification_log')
    .select('id, type, contact_id, title, body, url, sent_at, read_at')
    .eq('agent_id', agentId)
    .not('title', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(limit + 1)

  if (cursor) query = query.lt('sent_at', cursor)

  const { data: rows, error } = await query
  if (error) throw error

  const hasMore = (rows?.length ?? 0) > limit
  const page = hasMore ? rows!.slice(0, limit) : (rows ?? [])
  const nextCursor = hasMore ? page[page.length - 1].sent_at : null

  // Batch-fetch the contacts for this page (only contact-subject rows
  // are stream-eligible in Slice A).
  const contactIds = Array.from(
    new Set(page.map((r) => r.contact_id).filter((v): v is string => !!v)),
  )

  const contactsById = new Map<string, RawContactRow>()
  if (contactIds.length > 0) {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, suburb, last_seen_at, identified_at')
      .in('id', contactIds)
    for (const c of contacts ?? []) contactsById.set(c.id, c as RawContactRow)
  }

  const adapted: StreamMoment[] = []
  const sentAtMs: number[] = []
  for (const row of page) {
    const contact = row.contact_id ? contactsById.get(row.contact_id) ?? null : null
    const momentType = deriveMomentType(row as RawNotificationRow, contact ?? undefined)
    if (!momentType) continue
    adapted.push(
      toStreamMoment({ row: row as RawNotificationRow, contact, momentType, now, tz }),
    )
    sentAtMs.push(Date.parse(row.sent_at))
  }

  const grouped = groupStacks(adapted, { sentAtMs })

  return { items: grouped, nextCursor }
}
