import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  PropertiesView,
  type PropertyGridRow,
} from '@/components/properties/properties-view'
import { getRoles } from '@/lib/contacts/roles'
import { deriveIdentity, makeInitials } from '@/lib/contacts/identity'
import { coercePropertyStatus, type EngagementValue } from '@/lib/design/badges'

export const dynamic = 'force-dynamic'

interface SearchParams {
  q?:   string
  /** ?add=1 mounts the Add Property modal on load. */
  add?: string
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!agent?.workspace_id) {
    return <PropertiesView properties={[]} initialQ={searchParams.q ?? ''} />
  }

  const q = searchParams.q?.trim() ?? ''
  const defaultModalOpen = searchParams.add === '1'

  // ── 1. Workspace properties ─────────────────────────────────────────────
  const { data: rawProperties } = await admin
    .from('properties')
    .select('id, street_number, street_name, suburb, status, last_activity_at')
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .limit(500)

  const properties = rawProperties ?? []
  if (properties.length === 0) {
    return <PropertiesView properties={[]} initialQ={q} defaultModalOpen={defaultModalOpen} />
  }

  const propertyIds = properties.map((p) => p.id)

  // ── 2. Agent's contacts (for linked-contact count + avatars) ────────────
  // We fetch the agent's contacts once and filter client-side because the
  // role link lives in metadata.roles. Could move to a SQL view if this
  // gets slow at scale.
  const { data: contacts } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email, phone, score, residence_property_id, metadata, last_seen_at')
    .eq('agent_id', agent.id)
    .is('deleted_at', null)

  // Index contacts by property id (across both residence + roles).
  type LinkedContact = {
    id: string
    first_name: string | null
    last_name: string | null
    email: string | null
    phone: string | null
    score: number
  }
  const contactsByProperty = new Map<string, LinkedContact[]>()
  for (const c of contacts ?? []) {
    const propIds = new Set<string>()
    if (c.residence_property_id) propIds.add(c.residence_property_id)
    for (const r of getRoles(c.metadata)) propIds.add(r.property_id)
    for (const pid of propIds) {
      if (!contactsByProperty.has(pid)) contactsByProperty.set(pid, [])
      contactsByProperty.get(pid)!.push({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        phone: c.phone,
        score: c.score,
      })
    }
  }

  // ── 3. Engagement: distinct property_view events per property in last 7d ─
  // Single aggregate query — count(*) grouped by property_id from events
  // where occurred_at >= 7 days ago. We can't easily use group-by through
  // the JS client; pull the rows and aggregate in JS.
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentEvents } = await admin
    .from('events')
    .select('properties, occurred_at')
    .eq('workspace_id', agent.workspace_id)
    .eq('event_type', 'property_view')
    .gte('occurred_at', since7d)
    .in('properties->>property_id', propertyIds)

  const eventCountByProperty = new Map<string, number>()
  for (const e of recentEvents ?? []) {
    const pid = (e.properties as Record<string, unknown> | null)?.property_id
    if (typeof pid === 'string') {
      eventCountByProperty.set(pid, (eventCountByProperty.get(pid) ?? 0) + 1)
    }
  }

  function engagementFromCount(n: number): EngagementValue {
    if (n >= 9) return 3
    if (n >= 4) return 2
    if (n >= 1) return 1
    return 0
  }

  // ── 4. Compose grid rows ────────────────────────────────────────────────
  const rows: PropertyGridRow[] = properties.map((p) => {
    const linked = contactsByProperty.get(p.id) ?? []
    // Sort by score desc, take top 3 for the avatar stack.
    const top = [...linked].sort((a, b) => b.score - a.score).slice(0, 3)
    const stackPeople = top.map((c) => {
      const initials = makeInitials(c)
      const identity = deriveIdentity(c)
      return { id: c.id, initials, identity }
    })
    const address =
      [p.street_number, p.street_name].filter(Boolean).join(' ') || p.suburb || 'Address pending'
    return {
      id: p.id,
      address,
      suburb: p.suburb,
      // HOR-135: coerce legacy DB values (off_market, residence_only, etc.)
      // to the new vocabulary at the boundary. Removes the runtime
      // dependency on the migration having already been applied.
      status: coercePropertyStatus(p.status),
      beds: null,   // not in schema
      baths: null,  // not in schema
      land: null,   // not in schema
      engagement: engagementFromCount(eventCountByProperty.get(p.id) ?? 0),
      lastActivityAt: p.last_activity_at,
      linkedContacts: stackPeople,
      totalLinkedCount: linked.length,
    }
  })

  return (
    <PropertiesView
      properties={rows}
      initialQ={q}
      defaultModalOpen={defaultModalOpen}
    />
  )
}
