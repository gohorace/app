import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ContactDetailView } from '@/components/contacts/contact-detail-view'
import { deriveIdentity, makeInitials } from '@/lib/contacts/identity'
import { getRoles } from '@/lib/contacts/roles'
import { mergeScrollDepth, collapseEmailOpens, type RawEvent } from '@/lib/contacts/events'
import { getContactEmailSends } from '@/lib/contacts/email-engagement'

export const dynamic = 'force-dynamic'

export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!agent) notFound()

  const [
    { data: contact },
    { data: rawEvents },
    emailSends,
  ] = await Promise.all([
    admin
      .from('contacts')
      .select('id, first_name, last_name, email, phone, score, last_seen_at, identified_at, suburb, source, metadata, residence_property_id, deleted_at')
      .eq('id', params.id)
      .eq('agent_id', agent.id)
      .is('deleted_at', null)
      .maybeSingle(),
    admin.rpc('get_contact_events', { p_contact_id: params.id }),
    // HOR-228: parallel fetch of email_sends for this contact. Used by
    // contact-detail-view to enrich email_* timeline rows with the subject
    // line. Empty list (or fetch error) is handled gracefully.
    getContactEmailSends(admin, agent.id, params.id),
  ])

  if (!contact) notFound()

  // ── Roles + linked properties ───────────────────────────────────────────
  const roles = getRoles(contact.metadata)
  const propertyIds = new Set<string>(roles.map((r) => r.property_id))
  if (contact.residence_property_id) propertyIds.add(contact.residence_property_id)

  type PropertyRow = {
    id: string
    street_number: string | null
    street_name: string | null
    suburb: string | null
  }
  const propertyById = new Map<string, PropertyRow>()
  if (propertyIds.size > 0) {
    const { data: props } = await admin
      .from('properties')
      .select('id, street_number, street_name, suburb')
      .in('id', Array.from(propertyIds))
      .is('deleted_at', null)
    for (const p of props ?? []) propertyById.set(p.id, p)
  }

  const formatAddress = (p: PropertyRow | undefined): string => {
    if (!p) return 'Property no longer in your book'
    return [p.street_number, p.street_name].filter(Boolean).join(' ') || p.suburb || 'Address pending'
  }

  const roleAttached = roles.map((r) => {
    const p = propertyById.get(r.property_id)
    return {
      roleId:     r.id,
      role:       r.type,
      date:       r.date,
      propertyId: r.property_id,
      address:    formatAddress(p),
      suburb:     p?.suburb ?? null,
    }
  })

  // ── Events ──────────────────────────────────────────────────────────────
  // Two passes:
  //   1. mergeScrollDepth — folds scroll_depth rows into their page_view host
  //   2. collapseEmailOpens — folds repeated email_opened events (image-proxy
  //      refetches) per email_send_id into a single row tagged with repeated_count
  const events = collapseEmailOpens(
    mergeScrollDepth(
      (rawEvents ?? []).map((e) => ({
        id:          e.event_id,
        event_type:  e.event_type,
        properties:  (e.properties ?? {}) as Record<string, unknown>,
        score_delta: e.score_delta,
        occurred_at: e.occurred_at,
      } as RawEvent)),
    ),
  )

  // ── Engaging-now: derive from recent property_view events ───────────────
  // Group by property_id (from event.properties.property_id), capture last
  // view + session count. Exclude properties already in role-attached.
  const ENGAGING_LOOKBACK_DAYS = 14
  const since = Date.now() - ENGAGING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  const roleAttachedIds = new Set(roleAttached.map((r) => r.propertyId))

  const engagingByProperty = new Map<string, { lastViewAt: string; sessions: number }>()
  for (const e of events) {
    if (e.event_type !== 'property_view') continue
    const pid = (e.properties.property_id as string | undefined) ?? null
    if (!pid) continue
    if (roleAttachedIds.has(pid)) continue
    const occurred = new Date(e.occurred_at).getTime()
    if (Number.isNaN(occurred) || occurred < since) continue
    const existing = engagingByProperty.get(pid)
    if (!existing) {
      engagingByProperty.set(pid, { lastViewAt: e.occurred_at, sessions: 1 })
    } else {
      existing.sessions += 1
      if (e.occurred_at > existing.lastViewAt) existing.lastViewAt = e.occurred_at
    }
  }

  // Fetch property details for any engaging-now props we don't already have.
  const newEngagingIds = Array.from(engagingByProperty.keys()).filter(
    (id) => !propertyById.has(id),
  )
  if (newEngagingIds.length > 0) {
    const { data: more } = await admin
      .from('properties')
      .select('id, street_number, street_name, suburb')
      .in('id', newEngagingIds)
      .is('deleted_at', null)
    for (const p of more ?? []) propertyById.set(p.id, p)
  }

  const engagingNow = Array.from(engagingByProperty.entries()).map(([propertyId, agg]) => {
    const p = propertyById.get(propertyId)
    return {
      propertyId,
      address:    formatAddress(p),
      suburb:     p?.suburb ?? null,
      lastViewAt: agg.lastViewAt,
      sessions:   agg.sessions,
    }
  })

  // ── Sessions-this-week: distinct days with any event in last 7 days ─────
  const SESSION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
  const sinceWeek = Date.now() - SESSION_WINDOW_MS
  const sessionDays = new Set<string>()
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime()
    if (Number.isNaN(t) || t < sinceWeek) continue
    sessionDays.add(new Date(e.occurred_at).toISOString().slice(0, 10))
  }

  const identity = deriveIdentity(contact)
  const initials = makeInitials(contact)

  return (
    <ContactDetailView
      contact={{
        id:           contact.id,
        firstName:    contact.first_name,
        lastName:     contact.last_name,
        email:        contact.email,
        phone:        contact.phone,
        suburb:       contact.suburb,
        lastSeenAt:   contact.last_seen_at,
        identifiedAt: contact.identified_at,
        score:        contact.score,
        source:       contact.source,
        // Notes persist on contacts.metadata.notes (the types file claims a
        // top-level `notes` column but the migrations never created one;
        // metadata has been on contacts since the original schema so it's
        // the safe home).
        notes:        ((contact.metadata as Record<string, unknown> | null)?.notes as string | undefined) ?? null,
      }}
      identity={identity}
      initials={initials}
      sessionsThisWeek={sessionDays.size}
      roleAttached={roleAttached}
      engagingNow={engagingNow}
      events={events}
      emailSends={emailSends}
    />
  )
}
