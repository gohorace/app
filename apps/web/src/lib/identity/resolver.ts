import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { scoreEventsForContact, getAgentScoringOverrides } from '@/lib/scoring/engine'
import type { IncomingEvent } from '@/lib/scoring/types'
import type { Json } from '@/types/database.types'

type AdminClient = SupabaseClient<Database>

/**
 * Fetches all historical unscored events for a contact (across all identity_map entries)
 * and scores them. Called after identity resolution to catch pre-identification browsing.
 */
async function scoreBackfilledEvents(
  supabase: AdminClient,
  agentId: string,
  contactId: string,
): Promise<void> {
  // Get all identity_map entries for this contact + agent
  const { data: identityEntries } = await supabase
    .from('identity_map')
    .select('workspace_id, anonymous_id')
    .eq('contact_id', contactId)
    .eq('agent_id', agentId)

  if (!identityEntries || identityEntries.length === 0) return

  // Collect all session IDs across all anonymous_id/workspace combinations
  const allSessionIds: string[] = []
  for (const im of identityEntries) {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('workspace_id', im.workspace_id)
      .eq('anonymous_id', im.anonymous_id)

    if (sessions) {
      allSessionIds.push(...sessions.map((s) => s.id))
    }
  }

  if (allSessionIds.length === 0) return

  // Get unscored events for these sessions
  const { data: events } = await supabase
    .from('events')
    .select('id, session_id, event_type, properties, occurred_at, score_delta')
    .in('session_id', allSessionIds)
    .eq('score_delta', 0)
    .order('occurred_at', { ascending: true })

  if (!events || events.length === 0) return

  const incomingEvents: IncomingEvent[] = events.map((e) => ({
    id: e.id,
    session_id: e.session_id,
    event_type: e.event_type as IncomingEvent['event_type'],
    properties: e.properties as Json,
    occurred_at: e.occurred_at,
  }))

  const overrides = await getAgentScoringOverrides(supabase, agentId)
  await scoreEventsForContact(supabase, agentId, contactId, incomingEvents, overrides)
}

interface ContactMeta {
  first_name?: string
  last_name?: string
  phone?: string
}

/**
 * Resolves an email address to one or more contacts across all agents in the workspace.
 * Creates a contact under the workspace's default_agent_id if no match found.
 * Upserts identity_map entries for each match and updates contact timestamps.
 * Returns an array of { agentId, contactId } matches.
 */
export async function resolveEmail(
  supabase: AdminClient,
  workspaceId: string,
  email: string,
  anonymousId: string,
  meta?: ContactMeta,
): Promise<Array<{ agentId: string; contactId: string }>> {
  const normalizedEmail = email.toLowerCase().trim()

  // Get workspace for default_agent_id
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('default_agent_id')
    .eq('id', workspaceId)
    .single()

  // Find all agents in the workspace
  const { data: agents } = await supabase
    .from('agents')
    .select('id')
    .eq('workspace_id', workspaceId)

  const matches: Array<{ agentId: string; contactId: string }> = []

  if (agents) {
    for (const agent of agents) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('agent_id', agent.id)
        .eq('email', normalizedEmail)
        .maybeSingle()

      if (contact) {
        matches.push({ agentId: agent.id, contactId: contact.id })
      }
    }
  }

  // If no matches found, create a contact under the default agent
  if (matches.length === 0 && workspace?.default_agent_id) {
    const { data: created, error } = await supabase
      .from('contacts')
      .insert({
        agent_id: workspace.default_agent_id,
        email: normalizedEmail,
        crm_source: 'website',
        ...(meta?.first_name && { first_name: meta.first_name }),
        ...(meta?.last_name && { last_name: meta.last_name }),
        ...(meta?.phone && { phone: meta.phone }),
      })
      .select('id')
      .single()

    if (error || !created) {
      throw new Error(`Failed to create contact: ${error?.message}`)
    }
    matches.push({ agentId: workspace.default_agent_id, contactId: created.id })
  }

  const now = new Date().toISOString()

  // For each match, insert identity_map and update contact timestamps
  for (const { agentId, contactId } of matches) {
    // Upsert on (workspace_id, agent_id, anonymous_id) so re-submissions from the
    // same browser (same cookie/anonymous_id) always map to the most recent contact.
    const { error: imError } = await supabase
      .from('identity_map')
      .upsert(
        {
          workspace_id: workspaceId,
          agent_id: agentId,
          anonymous_id: anonymousId,
          contact_id: contactId,
          stitch_method: 'form',
          confidence: 'high',
        },
        { onConflict: 'workspace_id,agent_id,anonymous_id' },
      )

    if (imError) {
      console.error('[resolveEmail] identity_map upsert error:', imError)
    }

    // Set identified_at if not already set
    await supabase
      .from('contacts')
      .update({ identified_at: now })
      .eq('id', contactId)
      .is('identified_at', null)

    // Backfill name/phone from form — only fills fields that are currently null
    if (meta) {
      const fields: Array<[keyof typeof meta, string]> = [
        ['first_name', 'first_name'],
        ['last_name', 'last_name'],
        ['phone', 'phone'],
      ]
      for (const [metaKey, col] of fields) {
        const val = meta[metaKey]
        if (val) {
          await supabase.from('contacts').update({ [col]: val }).eq('id', contactId).is(col, null)
        }
      }
    }

    // Always update last_seen_at
    await supabase
      .from('contacts')
      .update({ last_seen_at: now })
      .eq('id', contactId)
  }

  return matches
}
