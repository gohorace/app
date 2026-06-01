/**
 * Per-contact email "outcome loop" derivation — Sent → Opened → Clicked →
 * Replied, with a Horace-voiced note.
 *
 * ⚠️ PARKED (2026-06-01). Built for the Digest V2 Phase 3 Stream card, but the
 * Stream Card refactor (StreamCardMini) RETIRED the in-card outcome loop — it
 * no longer renders on the Stream. This logic is kept as salvage for the
 * **Contact V2 email-thread timeline**, where a Sent/Opened/Replied history
 * does belong. It is intentionally NOT imported by the digest page. Decoupled
 * from any UI type so it survives the signal-card replacement.
 *
 * Derives from data already recorded by the tracked-email pipeline:
 *   - email_sends  — sent / opened / clicked lifecycle (HOR-228 onward)
 *   - events       — an 'email_replied' event marks a reply (HOR-339 vocab,
 *                    migration 20260601000010; emitted once Gmail-side reply
 *                    ingestion ships, HOR-353)
 *
 * Both loaders are bulk (single query over the whole contact set) — no N+1.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** One step in the Sent → Opened → Replied loop (decoupled from any UI type). */
export type OutcomeStep = 'sent' | 'opened' | 'clicked' | 'replied' | 'quiet' | 'new'

/** Derived outcome: ordered loop steps + a short Horace-voiced note. */
export interface SignalOutcome {
  steps: OutcomeStep[]
  note: string
}

/** A contact's most-recent tracked send, reduced to what the loop needs. */
export interface LatestSend {
  sentAt: string
  firstOpenedAt: string | null
  firstClickedAt: string | null
}

/** After this long with no reply, an opened/sent thread reads as "No reply". */
const QUIET_AFTER_HOURS = 48

/**
 * Newest *sent* email per contact, keyed by contact_id. Only rows that
 * actually went out (`sent_at` set) count toward the loop — queued / failed /
 * bounced sends aren't a thread the agent can read an outcome from.
 */
export async function fetchLatestSendsByContact(
  admin: SupabaseClient,
  agentId: string,
  contactIds: string[],
): Promise<Map<string, LatestSend>> {
  const map = new Map<string, LatestSend>()
  if (contactIds.length === 0) return map

  const { data, error } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('email_sends' as any)
    .select('contact_id, sent_at, first_opened_at, first_clicked_at')
    .eq('agent_id', agentId)
    .in('contact_id', contactIds)
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: false })

  if (error) {
    console.error('[fetchLatestSendsByContact] load failed:', error)
    return map
  }

  // Rows arrive newest-first; keep only the first seen per contact.
  for (const row of (data ?? []) as Array<{
    contact_id: string | null
    sent_at: string | null
    first_opened_at: string | null
    first_clicked_at: string | null
  }>) {
    if (!row.contact_id || !row.sent_at) continue
    if (map.has(row.contact_id)) continue
    map.set(row.contact_id, {
      sentAt: row.sent_at,
      firstOpenedAt: row.first_opened_at,
      firstClickedAt: row.first_clicked_at,
    })
  }
  return map
}

/**
 * Newest 'email_replied' event timestamp per contact, keyed by contact_id.
 * Contact-anchored events (session_id NULL) carry the contact directly.
 */
export async function fetchLatestReplyByContact(
  admin: SupabaseClient,
  contactIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (contactIds.length === 0) return map

  const { data, error } = await admin
    // event_type 'email_replied' isn't in the generated enum union yet — cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('events' as any)
    .select('contact_id, occurred_at')
    .eq('event_type', 'email_replied')
    .in('contact_id', contactIds)
    .order('occurred_at', { ascending: false })

  if (error) {
    console.error('[fetchLatestReplyByContact] load failed:', error)
    return map
  }

  for (const row of (data ?? []) as Array<{ contact_id: string | null; occurred_at: string | null }>) {
    if (!row.contact_id || !row.occurred_at) continue
    if (map.has(row.contact_id)) continue
    map.set(row.contact_id, row.occurred_at)
  }
  return map
}

/**
 * Map a contact's last thread to the signal-card outcome loop.
 *
 * Returns `undefined` when there's no prior send — a contact you've never
 * emailed has no thread to show an outcome for (the card stays clean rather
 * than implying history that doesn't exist).
 *
 * Step order is Sent → Opened → Clicked → (Replied | No reply). A reply that
 * predates the latest send is ignored — it belongs to an older thread.
 */
export function buildOutcome(
  send: LatestSend | null,
  latestReplyAt: string | null,
  firstName: string,
  now: Date,
): SignalOutcome | undefined {
  if (!send) return undefined

  const steps: SignalOutcome['steps'] = ['sent']
  const opened = Boolean(send.firstOpenedAt)
  const clicked = Boolean(send.firstClickedAt)
  if (opened) steps.push('opened')
  if (clicked) steps.push('clicked')

  const repliedToThisThread =
    latestReplyAt != null && new Date(latestReplyAt).getTime() >= new Date(send.sentAt).getTime()

  const who = firstName.trim() || 'They'

  if (repliedToThisThread) {
    steps.push('replied')
    return {
      steps,
      note: `${who} replied to your last note — the thread’s warm. Today’s reach can build on it.`,
    }
  }

  // No reply (yet). Past the quiet window it reads as "No reply"; still fresh,
  // it's simply in flight.
  const hoursSinceSent = (now.getTime() - new Date(send.sentAt).getTime()) / 3_600_000
  const isQuiet = hoursSinceSent >= QUIET_AFTER_HOURS

  if (isQuiet) {
    steps.push('quiet')
    return {
      steps,
      note: opened
        ? 'Opened but no reply yet — so I’ve kept today’s angle gentle.'
        : 'Sent but unopened so far — a fresh angle might land better today.',
    }
  }

  // Recent, still awaiting — show progress without the "No reply" verdict.
  return {
    steps,
    note: opened
      ? 'Opened — I’ll give it a day before nudging again.'
      : 'Sent — I’m watching for the open.',
  }
}
