import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { scoreEventsForContact, getOrgScoringOverrides } from '@/lib/scoring/engine'
import type { IncomingEvent } from '@/lib/scoring/types'
import type { Json } from '@/types/database.types'

type AdminClient = SupabaseClient<Database>

/**
 * Fetches all historical events for a contact and scores them.
 * Called after identity resolution to catch pre-identification browsing.
 */
async function scoreBackfilledEvents(
  supabase: AdminClient,
  orgId: string,
  contactId: string,
): Promise<void> {
  const { data: events } = await supabase
    .from('events')
    .select('id, session_id, event_type, properties, occurred_at, score_delta')
    .eq('contact_id', contactId)
    .eq('org_id', orgId)
    .eq('score_delta', 0) // only unscored events
    .order('occurred_at', { ascending: true })

  if (!events || events.length === 0) return

  const incomingEvents: IncomingEvent[] = events.map((e) => ({
    id: e.id,
    session_id: e.session_id,
    event_type: e.event_type as IncomingEvent['event_type'],
    properties: e.properties as Json,
    occurred_at: e.occurred_at,
  }))

  const overrides = await getOrgScoringOverrides(supabase, orgId)
  await scoreEventsForContact(supabase, orgId, contactId, incomingEvents, overrides)
}

/**
 * Links a session to a contact and back-fills events via DB trigger.
 * Returns the contactId if linking succeeded, null otherwise.
 */
export async function linkSessionToContact(
  supabase: AdminClient,
  sessionId: string,
  contactId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('sessions')
    .update({ contact_id: contactId })
    .eq('id', sessionId)
    .is('contact_id', null) // only link if not already linked

  if (error) {
    console.error('linkSessionToContact error:', error)
    return false
  }

  // Mark contact as identified (set identified_at if not already set)
  await supabase
    .from('contacts')
    .update({ identified_at: new Date().toISOString() })
    .eq('id', contactId)
    .is('identified_at', null)

  return true
}

/**
 * Resolves a campaign token to a contact and links the session.
 * Returns the contactId if resolved, null otherwise.
 */
export async function resolveCampaignToken(
  supabase: AdminClient,
  orgId: string,
  token: string,
  sessionId: string,
): Promise<string | null> {
  const { data: contactId } = await supabase.rpc('resolve_campaign_token', {
    p_org_id: orgId,
    p_token: token,
  })

  if (!contactId) return null

  const linked = await linkSessionToContact(supabase, sessionId, contactId)
  if (linked) {
    // Delay backfill so identity route can await form_submit scoring first —
    // backfill then sees the updated scoreBefore for correct threshold detection
    setTimeout(() => {
      scoreBackfilledEvents(supabase, orgId, contactId).catch((err) =>
        console.error('Backfill scoring error:', err),
      )
    }, 500)
  }
  return contactId
}

/**
 * Resolves an email address to a contact (or creates one) and links the session.
 * Returns the contactId.
 */
export async function resolveEmail(
  supabase: AdminClient,
  orgId: string,
  email: string,
  sessionId: string,
): Promise<string> {
  const normalizedEmail = email.toLowerCase().trim()

  // Try to find existing contact
  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('org_id', orgId)
    .eq('email', normalizedEmail)
    .maybeSingle()

  let contactId: string

  if (existing) {
    contactId = existing.id
  } else {
    // Create new contact from form submission
    const { data: created, error } = await supabase
      .from('contacts')
      .insert({
        org_id: orgId,
        email: normalizedEmail,
        crm_source: 'manual',
      })
      .select('id')
      .single()

    if (error || !created) {
      throw new Error(`Failed to create contact: ${error?.message}`)
    }
    contactId = created.id
  }

  const linked = await linkSessionToContact(supabase, sessionId, contactId)
  if (linked) {
    // Delay backfill so identity route can await form_submit scoring first —
    // backfill then sees the updated scoreBefore for correct threshold detection
    setTimeout(() => {
      scoreBackfilledEvents(supabase, orgId, contactId).catch((err) =>
        console.error('Backfill scoring error:', err),
      )
    }, 500)
  }
  return contactId
}
