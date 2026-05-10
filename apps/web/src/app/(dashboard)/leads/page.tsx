import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ContactsGrid, type ContactRow } from '@/components/contacts/contacts-grid'

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin   = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const agentId = agent!.id
  const q       = searchParams.q?.trim() ?? ''

  // Pull the agent's default link URL so the override modal can show what
  // happens when the per-contact destination is left blank.
  const { data: settings } = await admin
    .from('agent_settings')
    .select('website_url')
    .eq('agent_id', agentId)
    .maybeSingle()

  // Try the rich list function first, fall back to a basic contacts query
  // if the function hasn't been migrated yet.
  let contacts: ContactRow[] = []

  const { data: richData, error: richErr } = await admin
    .rpc('get_contacts_list', { p_agent_id: agentId })

  if (!richErr && Array.isArray(richData) && richData.length >= 0) {
    contacts = richData as ContactRow[]
  } else {
    // Fallback: basic contacts query without session stats
    const { data: fallback } = await admin
      .from('contacts')
      .select('id, first_name, last_name, email, phone, score, last_seen_at, property_address, suburb, crm_source')
      .eq('agent_id', agentId)
      .order('score', { ascending: false })
      .limit(500)

    contacts = (fallback ?? []).map(c => ({
      id:               c.id,
      first_name:       c.first_name ?? null,
      last_name:        c.last_name  ?? null,
      email:            c.email      ?? null,
      phone:            c.phone      ?? null,
      score:            c.score,
      score_change_7d:  0,
      last_seen_at:     c.last_seen_at ?? null,
      property_address: c.property_address ?? null,
      suburb:           c.suburb      ?? null,
      crm_source:       c.crm_source  ?? null,
      session_count:    0,
      last_event_type:  null,
      last_page_title:  null,
      tracked_link_token:           null,
      tracked_link_last_clicked_at: null,
      tracked_link_destination_url: null,
      is_stitched:                  false,
    }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <ContactsGrid
        contacts={contacts}
        initialQ={q}
        agentId={agentId}
        defaultLinkUrl={settings?.website_url ?? null}
      />
    </div>
  )
}
