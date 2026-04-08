const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Generates a cryptographically random base62 token.
 * At 12 characters: ~3.2×10²¹ possible values — collision-resistant.
 */
export function generateToken(length = 12): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALPHABET[b % 62]).join('')
}

/**
 * Generates tokens for a list of contacts and inserts them into the DB.
 * Returns an array of { contactId, token, trackedUrl }.
 */
export async function generateCampaignTokens(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  agentId: string,
  campaignId: string,
  contactIds: string[],
  targetUrl: string,
): Promise<Array<{ contactId: string; token: string; trackedUrl: string }>> {
  const rows = contactIds.map((contactId) => ({
    agent_id: agentId,
    campaign_id: campaignId,
    contact_id: contactId,
    token: generateToken(),
  }))

  // Upsert — skip conflicts (token already exists for this campaign+contact)
  const { data, error } = await supabase
    .from('campaign_tokens')
    .upsert(rows, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true })
    .select('contact_id, token')

  if (error) throw new Error(`Failed to generate tokens: ${error.message}`)

  // For contacts that already had tokens, fetch them
  const { data: existing } = await supabase
    .from('campaign_tokens')
    .select('contact_id, token')
    .eq('campaign_id', campaignId)
    .in('contact_id', contactIds)

  return (existing ?? data ?? []).map(({ contact_id, token }) => ({
    contactId: contact_id,
    token,
    trackedUrl: appendToken(targetUrl, token),
  }))
}

function appendToken(url: string, token: string): string {
  const u = new URL(url.startsWith('http') ? url : `https://placeholder.com/${url}`)
  u.searchParams.set('_ri', token)
  return url.startsWith('http') ? u.toString() : `${url}${url.includes('?') ? '&' : '?'}_ri=${token}`
}
