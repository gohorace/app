import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  PropertyDetailView,
  type PropertyDetailRoleAttached,
  type PropertyDetailEngagingNow,
  type PropertyDetailTimelineRow,
} from '@/components/properties/property-detail-view'
import { deriveIdentity, makeInitials } from '@/lib/contacts/identity'
import { getRoles } from '@/lib/contacts/roles'
import { coercePropertyStatus, type EngagementValue } from '@/lib/design/badges'

export const dynamic = 'force-dynamic'

export default async function PropertyDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!agent?.workspace_id) notFound()

  const { data: property } = await admin
    .from('properties')
    .select('id, street_number, street_name, suburb, status, first_seen_at, last_activity_at')
    .eq('id', params.id)
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!property) notFound()

  const address =
    [property.street_number, property.street_name].filter(Boolean).join(' ') ||
    property.suburb ||
    'Address pending'

  // ── Linked contacts (agent's contacts referencing this property) ────────
  const { data: contacts } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email, phone, score, last_seen_at, residence_property_id, metadata')
    .eq('agent_id', agent.id)
    .is('deleted_at', null)

  type LinkedContact = {
    id:           string
    first_name:   string | null
    last_name:    string | null
    email:        string | null
    phone:        string | null
    score:        number
    last_seen_at: string | null
    role:         'seller' | 'buyer' | null
    roleDate:     string | null
  }

  const linked: LinkedContact[] = []
  for (const c of contacts ?? []) {
    const roles = getRoles(c.metadata)
    const matchingRole = roles.find((r) => r.property_id === property.id)
    const isResidence = c.residence_property_id === property.id
    if (!matchingRole && !isResidence) continue
    linked.push({
      id:           c.id,
      first_name:   c.first_name,
      last_name:    c.last_name,
      email:        c.email,
      phone:        c.phone,
      score:        c.score,
      last_seen_at: c.last_seen_at,
      role:         matchingRole?.type ?? null,
      roleDate:     matchingRole?.date  ?? null,
    })
  }

  // ── Events on this property ─────────────────────────────────────────────
  // Filter the events table by properties->>property_id = property.id.
  // Note: events are tied to session_id, not contact_id. Joining events to
  // contacts requires the identity_map / sessions tables — deferred. For
  // now timeline rows render as anonymous activity unless we can attribute
  // via a future helper.
  const { data: rawEvents } = await admin
    .from('events')
    .select('id, event_type, properties, occurred_at')
    .eq('workspace_id', agent.workspace_id)
    .filter('properties->>property_id', 'eq', property.id)
    .order('occurred_at', { ascending: false })
    .limit(60)

  // Split linked contacts into role-attached and engaging-now.
  // Engaging-now: contacts in `linked` whose last_seen_at is within the
  // engaging window AND who aren't already role-attached. (We can't tie
  // specific events to specific contacts without identity_map joins, so
  // we infer engagement from contact.last_seen_at proximity.)
  const ENGAGING_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000
  const sinceEngaging = Date.now() - ENGAGING_LOOKBACK_MS

  const roleAttached: PropertyDetailRoleAttached[] = linked
    .filter((c) => c.role && c.roleDate)
    .map((c) => ({
      contactId: c.id,
      name:      [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'A contact',
      initials:  makeInitials(c),
      identity:  deriveIdentity(c),
      role:      c.role as 'seller' | 'buyer',
      date:      c.roleDate as string,
    }))

  const roleAttachedIds = new Set(roleAttached.map((r) => r.contactId))
  const engagingNow: PropertyDetailEngagingNow[] = linked
    .filter((c) => {
      if (roleAttachedIds.has(c.id)) return false
      if (!c.last_seen_at) return false
      return new Date(c.last_seen_at).getTime() >= sinceEngaging
    })
    .map((c) => ({
      contactId:  c.id,
      name:       [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'A contact',
      initials:   makeInitials(c),
      identity:   deriveIdentity(c),
      lastSeenAt: c.last_seen_at,
      sessions:   1, // accurate session count needs identity_map join; coarse for V1
    }))

  // Most active known contact for the primary "View most active contact"
  // CTA (HOR-135). Highest score across linked contacts. Phone no longer
  // required — the agent navigates to the contact's detail page and dials
  // from there (CRM-boundary language).
  const topContact = (() => {
    const candidates = [...linked].sort((a, b) => b.score - a.score)
    if (candidates.length === 0) return null
    const c = candidates[0]
    return {
      id:        c.id,
      firstName: c.first_name,
    }
  })()

  // ── Timeline ────────────────────────────────────────────────────────────
  // Events come back without contact attribution (the events table is keyed
  // on session_id, not contact_id). For V1 we render every event as an
  // anonymous timeline row. Attributed rows will come with the identity_map
  // join — deferred.
  const timeline: PropertyDetailTimelineRow[] = (rawEvents ?? []).map((e) => {
    const props = (e.properties as Record<string, unknown> | null) ?? {}
    const label = friendlyEventVerb(e.event_type, props)
    const detail = (props.title as string | undefined) ?? (props.path as string | undefined) ?? null
    return {
      id:          e.id,
      kind:        'anonymous',
      contactId:   null,
      contactName: null,
      label,
      detail,
      occurredAt:  e.occurred_at,
    }
  })

  // ── Aggregates for the Horace summary line ─────────────────────────────
  const knownCount = roleAttached.length + engagingNow.length
  const anonSessions = (rawEvents ?? []).length

  // Engagement bucket: same heuristic as the list page — distinct events
  // in the last 7 days.
  const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000
  const recent7d = (rawEvents ?? []).filter((e) => new Date(e.occurred_at).getTime() >= since7d)
  const engagement: EngagementValue =
    recent7d.length >= 9 ? 3 :
    recent7d.length >= 4 ? 2 :
    recent7d.length >= 1 ? 1 : 0

  // Notes not yet persistable (no metadata column on properties — see
  // /api/properties/[id] route). Wired into the view shape for future use.
  const notes = null

  return (
    <PropertyDetailView
      property={{
        id:             property.id,
        address,
        suburb:         property.suburb,
        // HOR-135: see properties/page.tsx for the rationale.
        status:         coercePropertyStatus(property.status),
        firstSeenAt:    property.first_seen_at,
        lastActivityAt: property.last_activity_at,
        notes,
      }}
      knownCount={knownCount}
      anonSessions={anonSessions}
      engagement={engagement}
      roleAttached={roleAttached}
      engagingNow={engagingNow}
      topContact={topContact}
      timeline={timeline}
    />
  )
}

function friendlyEventVerb(type: string, props: Record<string, unknown>): string {
  switch (type) {
    case 'property_view':
      return 'viewed the listing page'
    case 'page_view': {
      const path = (props.path as string | undefined) ?? ''
      if (path.includes('appraisal')) return 'visited the appraisal page'
      if (path.includes('sold'))      return 'browsed sold results'
      return 'visited a page'
    }
    case 'form_submit':
      return 'submitted a form'
    case 'return_visit':
      return 'returned to the site'
    case 'scroll_depth':
      return 'read the page in depth'
    case 'campaign_click':
      return 'clicked a tracked link'
    default:
      return type.replace(/_/g, ' ')
  }
}
