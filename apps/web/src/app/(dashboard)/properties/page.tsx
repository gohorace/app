import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  PropertiesView,
  type PropertyGridRow,
  type CoreMarketSummary,
} from '@/components/properties/properties-view'
import { getRoles } from '@/lib/contacts/roles'
import { deriveIdentity, makeInitials } from '@/lib/contacts/identity'
import { coercePropertyStatus, type EngagementValue } from '@/lib/design/badges'

export const dynamic = 'force-dynamic'

interface SearchParams {
  q?:   string
  /** ?add=1 mounts the Add Property modal on load. */
  add?: string
  /**
   * HOR-216: time window for engagement bucketing on the List view, and
   * the same value the map view passes to `/api/properties/map-payload`.
   * Mirrors the brief's three positions; defaults to `7d` when absent or
   * invalid.
   */
  timeWindow?: '24h' | '7d' | '30d'
}

const TIME_WINDOW_DAYS: Record<NonNullable<SearchParams['timeWindow']>, number> = {
  '24h': 1,
  '7d':  7,
  '30d': 30,
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
    return <PropertiesView properties={[]} coreMarkets={[]} initialQ={searchParams.q ?? ''} />
  }

  const q = searchParams.q?.trim() ?? ''
  const defaultModalOpen = searchParams.add === '1'
  // HOR-216: validated time window (defaults to 7d). The map view will read
  // the same query param to call `/api/properties/map-payload`; keeping the
  // window in the URL means reload + view-toggle both preserve intent.
  const timeWindow: NonNullable<SearchParams['timeWindow']> =
    searchParams.timeWindow === '24h' || searchParams.timeWindow === '30d'
      ? searchParams.timeWindow
      : '7d'
  const windowDays = TIME_WINDOW_DAYS[timeWindow]

  // ── 1. Agent's active core markets (HOR-195) ────────────────────────────
  // Drives the "no markets set" empty state branch in PropertiesView and
  // seeds the suburb dropdown so a freshly-added market is selectable
  // even before its import has finished.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawMarkets } = await admin
    .from('core_markets' as any)
    .select('id, locality_pid, locality_name, state_abbrev')
    .eq('agent_id', agent.id)
    .is('archived_at', null)
    .order('created_at', { ascending: true })

  type MarketRow = { id: string; locality_pid: string; locality_name: string; state_abbrev: string }
  const marketRows = (rawMarkets as MarketRow[] | null) ?? []

  // Look up locality centroids from gnaf.localities for map fallback.
  // One round-trip with .in(). When the gnaf ingest hasn't populated
  // lat/lng yet, the rows have null and the map falls back to its own
  // default.
  let localityCenters = new Map<string, { lat: number | null; lng: number | null }>()
  if (marketRows.length > 0) {
    const { data: localities } = await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .schema('gnaf' as any)
      .from('localities' as any)
      .select('locality_pid, latitude, longitude')
      .in('locality_pid', marketRows.map((m) => m.locality_pid))
    type LocalityRow = { locality_pid: string; latitude: number | null; longitude: number | null }
    for (const l of (localities as LocalityRow[] | null) ?? []) {
      localityCenters.set(l.locality_pid, { lat: l.latitude, lng: l.longitude })
    }
  }

  const coreMarkets: CoreMarketSummary[] = marketRows.map((m) => {
    const c = localityCenters.get(m.locality_pid)
    return {
      id:            m.id,
      locality_pid:  m.locality_pid,
      locality_name: m.locality_name,
      state_abbrev:  m.state_abbrev,
      latitude:      c?.lat ?? null,
      longitude:     c?.lng ?? null,
    }
  })

  // ── 2. Workspace properties ─────────────────────────────────────────────
  // database.types.ts lags HOR-116 — latitude/longitude (added by
  // 20260513000005_address_v2_schema.sql) aren't in the generated union
  // yet. Cast the from() reference until the next `supabase gen types`,
  // same convention as residence.ts:61.
  const { data: rawProperties } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('properties' as any)
    .select('id, street_number, street_name, suburb, status, last_activity_at, latitude, longitude')
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .limit(500)

  type PropertyRow = {
    id:               string
    street_number:    string | null
    street_name:      string | null
    suburb:           string | null
    status:           string | null
    last_activity_at: string | null
    latitude:         number | null
    longitude:        number | null
  }
  const properties = (rawProperties as PropertyRow[] | null) ?? []
  if (properties.length === 0) {
    return (
      <PropertiesView
        properties={[]}
        coreMarkets={coreMarkets}
        initialQ={q}
        defaultModalOpen={defaultModalOpen}
      />
    )
  }

  const propertyIds = properties.map((p) => p.id)

  // ── 3. Agent's contacts (for linked-contact count + avatars) ────────────
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

  // ── 4. Engagement: distinct property_view events per property in window ──
  // HOR-216: time window is server-controlled via `?timeWindow=` (24h/7d/30d).
  // Bucketing stays count-based for the list view; the map view uses the
  // recency-weighted RPCs in `get_property_signals` (same window, different
  // model — the list is a snapshot, the map is a story).
  const sinceWindow = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentEvents } = await admin
    .from('events')
    .select('properties, occurred_at')
    .eq('workspace_id', agent.workspace_id)
    .eq('event_type', 'property_view')
    .gte('occurred_at', sinceWindow)
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

  // ── 5. Compose grid rows ────────────────────────────────────────────────
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

    // HOR-195: full names for the linked-contact search (also widens the
    // grid search to "find a property by its resident").
    const linkedContactNames = linked
      .map((c) => [c.first_name, c.last_name].filter(Boolean).join(' ').trim())
      .filter(Boolean)

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
      // HOR-195: new fields for the map view and street-prefix filter.
      latitude:           p.latitude as number | null,
      longitude:          p.longitude as number | null,
      linkedContactNames,
      streetName:         p.street_name ?? null,
    }
  })

  return (
    <PropertiesView
      properties={rows}
      coreMarkets={coreMarkets}
      initialQ={q}
      defaultModalOpen={defaultModalOpen}
    />
  )
}
