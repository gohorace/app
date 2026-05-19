/**
 * Per-contact email-sends summary loader (HOR-228 / slice F).
 *
 * The contact detail page already fetches the contact's events via
 * `get_contact_events`. Slice F's migration extends that RPC to include
 * email_* events with `session_id IS NULL`, so the timeline gets the
 * raw event stream for free.
 *
 * But each event carries only the `email_send_id` reference in its
 * properties — the human-readable bits (subject, status, counts) live
 * on `email_sends`. This loader returns a parallel index so the
 * timeline can enrich each email_sent / email_opened / email_clicked
 * row with the right subject line.
 *
 * Cheap query: PK index + per-contact filter. Ordered DESC so the
 * most-recent send is first.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface EmailSendSummary {
  id: string
  subject: string
  to_email: string
  status:
    | 'queued'
    | 'sent'
    | 'soft_bounced'
    | 'hard_bounced'
    | 'failed'
    | 'spam_complaint'
  tracked: boolean
  sent_at: string | null
  first_opened_at: string | null
  first_clicked_at: string | null
  open_count: number
  click_count: number
}

/**
 * Load every email_sends row for this (agent, contact) pair, newest first.
 * Service-role only — callers are always server-side (route handlers,
 * Server Components). Ownership scope is `agent_id` because the contact
 * detail page already enforces agent ownership before calling here.
 */
export async function getContactEmailSends(
  admin: SupabaseClient,
  agentId: string,
  contactId: string,
): Promise<EmailSendSummary[]> {
  const { data, error } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('email_sends' as any)
    .select(
      'id, subject, to_email, status, tracked, sent_at, first_opened_at, first_clicked_at, open_count, click_count',
    )
    .eq('agent_id', agentId)
    .eq('contact_id', contactId)
    .order('sent_at', { ascending: false, nullsFirst: false })

  if (error) {
    // Don't throw — the timeline still renders, just without subject enrichment.
    console.error('[getContactEmailSends] load failed:', error)
    return []
  }
  return (data ?? []) as EmailSendSummary[]
}

/**
 * Build a lookup map by email_send_id for O(1) enrichment in the timeline.
 */
export function buildEmailSendIndex(
  sends: EmailSendSummary[],
): Map<string, EmailSendSummary> {
  return new Map(sends.map((s) => [s.id, s]))
}
