import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

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
