import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { generateToken } from '@/lib/campaigns/token'
import { appendCampaignToken } from '@/lib/outreach/links'

type AdminClient = SupabaseClient<Database>

/**
 * Validate that the given contacts all belong to the agent. Returns the
 * agent-owned contact rows; throws if any id is missing or unowned.
 */
export async function loadOwnedContacts(
  admin: AdminClient,
  agentId: string,
  contactIds: string[],
): Promise<Array<{
  id: string
  email: string | null
  phone: string | null
  first_name: string | null
  last_name: string | null
  unsubscribed_at: string | null
}>> {
  if (contactIds.length === 0) return []
  const { data, error } = await admin
    .from('contacts')
    .select('id, email, phone, first_name, last_name, unsubscribed_at')
    .eq('agent_id', agentId)
    .in('id', contactIds)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  if (rows.length !== contactIds.length) {
    const missing = contactIds.filter((id) => !rows.some((r) => r.id === id))
    throw new Error(`Contacts not found: ${missing.join(', ')}`)
  }
  return rows
}

/**
 * Resolve a campaign for outreach: either reuses an existing one owned by
 * the agent, or auto-creates an ad-hoc campaign with the given name.
 */
export async function resolveOrCreateCampaign(
  admin: AdminClient,
  agentId: string,
  opts: { campaignId?: string; campaignName?: string },
): Promise<{ id: string; created: boolean }> {
  if (opts.campaignId) {
    const { data, error } = await admin
      .from('campaigns')
      .select('id')
      .eq('id', opts.campaignId)
      .eq('agent_id', agentId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Campaign not found')
    return { id: data.id, created: false }
  }

  const name =
    opts.campaignName?.trim() ||
    `Ad-hoc ${new Date().toISOString().slice(0, 10)}`

  const { data, error } = await admin
    .from('campaigns')
    .insert({ agent_id: agentId, name })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Failed to create campaign')
  return { id: data.id, created: true }
}

/**
 * Ensure each contact has a campaign_tokens row for the given campaign.
 * Idempotent: existing tokens are reused. Returns a map contact_id → token.
 */
export async function ensureCampaignTokens(
  admin: AdminClient,
  agentId: string,
  campaignId: string,
  contactIds: string[],
): Promise<Map<string, string>> {
  if (contactIds.length === 0) return new Map()

  const rows = contactIds.map((contactId) => ({
    agent_id: agentId,
    campaign_id: campaignId,
    contact_id: contactId,
    token: generateToken(),
  }))

  const { error } = await admin
    .from('campaign_tokens')
    .upsert(rows, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true })
  if (error) throw new Error(error.message)

  const { data, error: fetchErr } = await admin
    .from('campaign_tokens')
    .select('contact_id, token')
    .eq('campaign_id', campaignId)
    .in('contact_id', contactIds)
  if (fetchErr) throw new Error(fetchErr.message)

  return new Map((data ?? []).map((r) => [r.contact_id, r.token]))
}

export { appendCampaignToken }
