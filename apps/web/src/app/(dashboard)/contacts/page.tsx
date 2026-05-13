import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ContactsGrid, type ContactGridRow } from '@/components/contacts/contacts-grid'
import { getRoles } from '@/lib/contacts/roles'

export const dynamic = 'force-dynamic'

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const agentId = agent!.id
  const q = searchParams.q?.trim() ?? ''

  // HOR-136: workspace default destination for tracked links. Surfaced in
  // the edit-destination popover as the fallback when no override is set.
  const { data: settings } = await admin
    .from('agent_settings')
    .select('website_url')
    .eq('agent_id', agentId)
    .maybeSingle()
  const defaultLinkUrl = settings?.website_url ?? null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.gohorace.com'

  // HOR-125: three reads in parallel.
  //  1. Rich list rows (get_contacts_list RPC) — same shape used by v0 grid,
  //     fallback if RPC is missing (older deploys).
  //  2. metadata column for the same contacts — RPC doesn't return it.
  //     We parse `roles` out of metadata for role badges + linked properties.
  //  3. Properties referenced by residence_property_id + role property_ids —
  //     resolved in one batch query.
  type BaseRow = {
    id: string
    first_name: string | null
    last_name:  string | null
    email:      string | null
    phone:      string | null
    score:      number
    score_change_7d: number
    last_seen_at: string | null
    suburb:     string | null
    source:     string
    is_stitched: boolean
    residence_property_id: string | null
    tracked_link_token: string | null
    tracked_link_destination_url: string | null
    tracked_link_last_clicked_at: string | null
  }

  // 1 — base list via RPC, fallback to plain contacts select.
  let baseRows: BaseRow[] = []
  const { data: richData, error: richErr } = await admin
    .rpc('get_contacts_list', { p_agent_id: agentId })

  if (!richErr && Array.isArray(richData)) {
    // RPC doesn't include residence_property_id, so we'll merge that in from query (2).
    baseRows = richData.map((r) => ({
      id: r.id,
      first_name: r.first_name,
      last_name:  r.last_name,
      email:      r.email,
      phone:      r.phone,
      score:      r.score,
      score_change_7d: r.score_change_7d,
      last_seen_at: r.last_seen_at,
      suburb:     r.suburb,
      source:     r.source,
      is_stitched: r.is_stitched,
      residence_property_id: null, // filled in by query (2) below
      tracked_link_token:           r.tracked_link_token,
      tracked_link_destination_url: r.tracked_link_destination_url,
      tracked_link_last_clicked_at: r.tracked_link_last_clicked_at,
    }))
  } else {
    const { data: fallback } = await admin
      .from('contacts')
      .select('id, first_name, last_name, email, phone, score, last_seen_at, suburb, source, residence_property_id')
      .eq('agent_id', agentId)
      .is('deleted_at', null)
      .order('score', { ascending: false })
      .limit(500)
    baseRows = (fallback ?? []).map((c) => ({
      id: c.id,
      first_name: c.first_name,
      last_name:  c.last_name,
      email:      c.email,
      phone:      c.phone,
      score:      c.score,
      score_change_7d: 0,
      last_seen_at: c.last_seen_at,
      suburb:     c.suburb,
      source:     c.source,
      is_stitched: false,
      residence_property_id: c.residence_property_id,
      tracked_link_token:           null,
      tracked_link_destination_url: null,
      tracked_link_last_clicked_at: null,
    }))
  }

  if (baseRows.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <ContactsGrid
          contacts={[]}
          initialQ={q}
          agentId={agentId}
          appUrl={appUrl}
          defaultLinkUrl={defaultLinkUrl}
        />
      </div>
    )
  }

  // 2 — metadata + residence_property_id for the same contacts.
  const ids = baseRows.map((r) => r.id)
  const { data: metaRows } = await admin
    .from('contacts')
    .select('id, metadata, residence_property_id')
    .in('id', ids)
  const metaById = new Map<string, { metadata: unknown; residence_property_id: string | null }>(
    (metaRows ?? []).map((m) => [
      m.id,
      { metadata: m.metadata, residence_property_id: m.residence_property_id },
    ]),
  )

  // Parse roles out of metadata + collect all property ids to fetch.
  const rolesByContact = new Map<string, ReturnType<typeof getRoles>>()
  const propertyIdSet = new Set<string>()
  for (const r of baseRows) {
    const meta = metaById.get(r.id)
    if (meta) {
      r.residence_property_id = meta.residence_property_id
      if (meta.residence_property_id) propertyIdSet.add(meta.residence_property_id)
      const roles = getRoles(meta.metadata)
      rolesByContact.set(r.id, roles)
      for (const role of roles) propertyIdSet.add(role.property_id)
    } else {
      rolesByContact.set(r.id, [])
    }
  }

  // 3 — fetch the referenced properties in one batch.
  const propertyById = new Map<
    string,
    { id: string; address: string }
  >()
  if (propertyIdSet.size > 0) {
    const { data: props } = await admin
      .from('properties')
      .select('id, street_number, street_name, suburb')
      .in('id', Array.from(propertyIdSet))
      .is('deleted_at', null)
    for (const p of props ?? []) {
      const address = [p.street_number, p.street_name].filter(Boolean).join(' ') || p.suburb || '—'
      propertyById.set(p.id, { id: p.id, address })
    }
  }

  // Compose final grid rows.
  const contacts: ContactGridRow[] = baseRows.map((r) => {
    const roles = rolesByContact.get(r.id) ?? []
    const linked = new Map<string, { id: string; address: string }>()
    if (r.residence_property_id) {
      const p = propertyById.get(r.residence_property_id)
      if (p) linked.set(p.id, p)
    }
    for (const role of roles) {
      const p = propertyById.get(role.property_id)
      if (p) linked.set(p.id, p)
    }
    return {
      id: r.id,
      first_name: r.first_name,
      last_name:  r.last_name,
      email:      r.email,
      phone:      r.phone,
      score:      r.score,
      score_change_7d: r.score_change_7d,
      last_seen_at: r.last_seen_at,
      suburb:     r.suburb,
      source:     r.source,
      is_stitched: r.is_stitched,
      roles,
      linked_properties: Array.from(linked.values()),
      tracked_link_token:           r.tracked_link_token,
      tracked_link_destination_url: r.tracked_link_destination_url,
      tracked_link_last_clicked_at: r.tracked_link_last_clicked_at,
    }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <ContactsGrid
        contacts={contacts}
        initialQ={q}
        agentId={agentId}
        appUrl={appUrl}
        defaultLinkUrl={defaultLinkUrl}
      />
    </div>
  )
}
