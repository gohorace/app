import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type AdminClient = SupabaseClient<Database>

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

  await linkSessionToContact(supabase, sessionId, contactId)
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

  await linkSessionToContact(supabase, sessionId, contactId)
  return contactId
}
