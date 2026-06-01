/**
 * HOR-348 · Property V2 — behavioural derivation.
 *
 * The property detail screen (HOR-351) is organised Signal → Action → Context,
 * where the property's signal is *borrowed from the people circling it*. This
 * module is the single source of that derived signal:
 *
 *   - `circling`     — contacts engaging this property, hottest-first, each with
 *                      a 0..1 pull score, a "+N this week" delta, and a one-line
 *                      read.
 *   - `timeline`     — every property event, attributed to a contact where the
 *                      identity pipeline has stamped `events.contact_id`,
 *                      classified into known / anon / moment rows.
 *   - `changeChips`  — the headline signals as compact chips.
 *   - `anonSessions` — distinct un-attributed sessions this month.
 *   - `engagement`   — the coarse 0..3 bucket for the EngagementIndicator.
 *
 * Everything below `fetchPropertySignal` is **pure** (no DB, no clock beyond an
 * injected `now`) so the scoring, attribution, chip and read logic is unit
 * tested directly. `fetchPropertySignal` is the thin Supabase orchestrator the
 * page server component calls.
 *
 * Attribution model (verified against the schema):
 *   - `events.contact_id` is populated by the identity pipeline (phase-1 backfill
 *     + live scoring). Rows with it set are "known"; rows without are "anon".
 *   - A property's events are matched the same way the engagement rollup does:
 *     `coalesce(events.property_id, properties->>'property_id')`.
 *   - `circling` unions live event-derived engagement with the
 *     `contact_property_engagement` rollup, so inspection-only buyers (which
 *     never produce website events) still surface, while the per-week delta and
 *     read stay fresh from live events.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveIdentity, makeInitials } from '@/lib/contacts/identity'
import type { IdentityState } from '@/lib/design/badges'
import type { EngagementValue } from '@/lib/design/badges'

// ── Tunables ──────────────────────────────────────────────────────────────────
// Pull score blends three normalised 0..1 components. Weights sum to 1.
const PULL_WEIGHTS = { recency: 0.45, volume: 0.3, intent: 0.25 } as const
/** Recency half-life: an engagement this many days old contributes ~0.5. */
const RECENCY_HALFLIFE_DAYS = 5
/** Volume saturates — this many lifetime engagements ≈ 0.71 of the volume cap. */
const VOLUME_SCALE = 4
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const MONTH_MS = 30 * DAY_MS

/** Event types that count as a "visit" for the per-week delta. */
const VISIT_EVENT_TYPES = new Set([
  'property_view',
  'page_view',
  'return_visit',
  'scroll_depth',
])
/** High-saliency events that render as a "Moment" callout (not a plain visit). */
const MOMENT_EVENT_TYPES = new Set(['form_submit', 'portal_enquiry'])
/** Channel events that never belong on a *property* behavioural timeline. */
const TIMELINE_EXCLUDED_TYPES = new Set([
  'email_sent',
  'email_opened',
  'email_clicked',
  'email_bounced',
  'identity_resolve',
])

// ── Types ───────────────────────────────────────────────────────────────────

export type PropertyTier = 'Hot' | 'Warming' | 'Cool'

/** Temperature word + colour from a 0..1 pull score (ported from the prototype). */
export function tierFor(pct: number): { word: PropertyTier; color: string } {
  if (pct >= 0.66) return { word: 'Hot', color: '#C4622D' }
  if (pct >= 0.33) return { word: 'Warming', color: '#B5922A' }
  return { word: 'Cool', color: '#3D5246' }
}

export interface CirclingContact {
  contactId: string
  name: string
  firstName: string
  initials: string
  identity: IdentityState
  /** 0..1 pull score; sort key (hottest first). */
  pct: number
  tier: PropertyTier
  /** Visits in the last 7 days. */
  delta: number
  /** ISO timestamp of last engagement; the view formats it relative. */
  lastSeen: string | null
  /** One-line read, e.g. "Requested an appraisal · 3 visits this week". */
  read: string
}

export type PropertyTimelineRow =
  | {
      id: string
      kind: 'moment'
      label: string
      detail: string
      tie: string
      occurredAt: string
    }
  | {
      id: string
      kind: 'known'
      contactId: string
      contactName: string
      initials: string
      identity: IdentityState
      label: string
      detail: string | null
      occurredAt: string
    }
  | {
      id: string
      kind: 'anon'
      label: string
      detail: string | null
      occurredAt: string
    }

export type ChangeChipIcon = 'flame' | 'repeat' | 'eye-off'

export interface ChangeChip {
  icon: ChangeChipIcon
  label: string
}

export interface PropertySignal {
  circling: CirclingContact[]
  timeline: PropertyTimelineRow[]
  changeChips: ChangeChip[]
  /** Distinct un-attributed sessions in the last 30 days. */
  anonSessions: number
  /** Coarse 0..3 engagement bucket for the EngagementIndicator. */
  engagement: EngagementValue
  /** Count of distinct circling (known) contacts. */
  knownCount: number
}

// Inputs to the pure deriver — already-fetched, DB-shaped rows.

export interface PropertyEventRow {
  id: string
  event_type: string
  properties: Record<string, unknown> | null
  occurred_at: string
  contact_id: string | null
  session_id: string | null
  page_type: string | null
}

export type EngagementType =
  | 'website_engagement'
  | 'doorstep_appraisal_request'
  | 'doorstep_buyer_enquiry'

export interface EngagementRollupRow {
  contact_id: string
  type: EngagementType
  first_engaged_at: string
  last_engaged_at: string
  engagement_count: number
}

export interface ContactLite {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  score: number
  last_seen_at: string | null
}

export interface DerivePropertySignalInput {
  now: number
  propertyAddress: string
  /** Property events, any order (the deriver sorts). */
  events: PropertyEventRow[]
  /** contact_property_engagement rows for this property. */
  engagementRows: EngagementRollupRow[]
  /** Contact basics keyed by id, for every contact referenced above. */
  contacts: Map<string, ContactLite>
}

// ── Pure scoring helpers ──────────────────────────────────────────────────────

/** exp decay → 1.0 just now, ~0.5 at the half-life, →0 as it ages. */
export function recencyScore(ageMs: number, now: number = Date.now()): number {
  void now
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0
  const days = ageMs / DAY_MS
  return Math.exp((-days * Math.LN2) / RECENCY_HALFLIFE_DAYS)
}

/** Saturating 0..1 from a lifetime engagement count. */
export function volumeScore(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0
  return 1 - Math.exp(-count / VOLUME_SCALE)
}

/** Strongest intent signal a contact has shown on this property → 0..1. */
function intentScore(types: Set<EngagementType>, hasMomentEvent: boolean): number {
  if (types.has('doorstep_appraisal_request') || hasMomentEvent) return 1
  if (types.has('doorstep_buyer_enquiry')) return 0.8
  return 0.3 // website engagement only
}

export function pullScore(parts: {
  recency: number
  volume: number
  intent: number
}): number {
  const raw =
    PULL_WEIGHTS.recency * parts.recency +
    PULL_WEIGHTS.volume * parts.volume +
    PULL_WEIGHTS.intent * parts.intent
  return clamp01(raw)
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

// ── Pure event classification ──────────────────────────────────────────────────

function eventPropValue(props: Record<string, unknown> | null, key: string): string | null {
  const v = props?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Is this event an appraisal-flavoured form submission? */
function isAppraisalEvent(e: PropertyEventRow): boolean {
  if (e.page_type === 'appraisal') return true
  const form = (eventPropValue(e.properties, 'form_name') ?? eventPropValue(e.properties, 'form_id') ?? '').toLowerCase()
  const path = (eventPropValue(e.properties, 'path') ?? eventPropValue(e.properties, 'url') ?? '').toLowerCase()
  return form.includes('appraisal') || path.includes('appraisal')
}

/** Property-centric verb for a known/anon visit row. */
export function propertyEventVerb(e: PropertyEventRow): string {
  const props = e.properties
  const path = (eventPropValue(props, 'path') ?? eventPropValue(props, 'url') ?? '').toLowerCase()
  switch (e.event_type) {
    case 'property_view':
      return 'Viewed the listing'
    case 'return_visit':
      return 'Returned to the site'
    case 'scroll_depth':
      return 'Read the page in depth'
    case 'campaign_click':
      return 'Clicked a tracked link'
    case 'page_view': {
      if (e.page_type === 'appraisal' || path.includes('appraisal')) return 'Viewed the appraisal page'
      if (e.page_type === 'sold' || path.includes('sold')) return 'Browsed sold results'
      if (e.page_type === 'suburb_report' || path.includes('suburb')) return 'Read the suburb report'
      return 'Visited a page'
    }
    default:
      return e.event_type.replace(/_/g, ' ')
  }
}

function portalName(props: Record<string, unknown> | null): string {
  const p = eventPropValue(props, 'source_portal')
  if (p === 'rea') return 'realestate.com.au'
  if (p === 'domain') return 'Domain'
  return 'a portal'
}

/** Build the Moment callout (label / detail / tie) for a high-saliency event. */
function buildMoment(
  e: PropertyEventRow,
  contactName: string | null,
  propertyAddress: string,
): { label: string; detail: string; tie: string } {
  const who = contactName ?? 'Someone'
  if (e.event_type === 'portal_enquiry') {
    return {
      label: 'Portal enquiry',
      detail: `${who} enquired via ${portalName(e.properties)} on ${propertyAddress}.`,
      tie: 'A named enquiry — a buyer reaching out directly.',
    }
  }
  // form_submit
  if (isAppraisalEvent(e)) {
    const form = eventPropValue(e.properties, 'form_name') ?? 'Book an appraisal'
    return {
      label: 'Appraisal requested',
      detail: `${who} submitted the “${form}” form on ${propertyAddress}.`,
      tie: 'A direct ask, not just a visit — their strongest signal yet.',
    }
  }
  const form = eventPropValue(e.properties, 'form_name') ?? 'enquiry'
  return {
    label: 'Enquiry submitted',
    detail: `${who} submitted the “${form}” form on ${propertyAddress}.`,
    tie: 'A direct ask, not just a visit.',
  }
}

// ── Per-contact aggregation for the circling list ───────────────────────────────

interface ContactAgg {
  contactId: string
  events: PropertyEventRow[]
  /** lifetime engagement count (max of event count and rollup count). */
  count: number
  lastEngagedMs: number
  types: Set<EngagementType>
  hasMomentEvent: boolean
}

function aggregateCircling(input: DerivePropertySignalInput): Map<string, ContactAgg> {
  const aggs = new Map<string, ContactAgg>()

  const ensure = (id: string): ContactAgg => {
    let a = aggs.get(id)
    if (!a) {
      a = { contactId: id, events: [], count: 0, lastEngagedMs: 0, types: new Set(), hasMomentEvent: false }
      aggs.set(id, a)
    }
    return a
  }

  // Live events grouped by attributed contact.
  for (const e of input.events) {
    if (!e.contact_id) continue
    const a = ensure(e.contact_id)
    a.events.push(e)
    a.count += 1
    const t = Date.parse(e.occurred_at)
    if (Number.isFinite(t)) a.lastEngagedMs = Math.max(a.lastEngagedMs, t)
    if (MOMENT_EVENT_TYPES.has(e.event_type)) {
      a.hasMomentEvent = true
      a.types.add(isAppraisalEvent(e) ? 'doorstep_appraisal_request' : 'website_engagement')
    } else {
      a.types.add('website_engagement')
    }
  }

  // Merge the rollup — adds inspection-only buyers + a lifetime count baseline.
  for (const r of input.engagementRows) {
    const a = ensure(r.contact_id)
    a.types.add(r.type)
    a.count = Math.max(a.count, r.engagement_count)
    const t = Date.parse(r.last_engaged_at)
    if (Number.isFinite(t)) a.lastEngagedMs = Math.max(a.lastEngagedMs, t)
  }

  return aggs
}

/** Visits in the last 7 days from a contact's property events. */
function visitDelta(events: PropertyEventRow[], now: number): number {
  let n = 0
  for (const e of events) {
    if (!VISIT_EVENT_TYPES.has(e.event_type)) continue
    const t = Date.parse(e.occurred_at)
    if (Number.isFinite(t) && now - t <= WEEK_MS) n += 1
  }
  return n
}

/** One-line read for a circling contact. */
function buildRead(agg: ContactAgg, delta: number): string {
  const visitsPhrase = delta > 0 ? `${delta} visit${delta === 1 ? '' : 's'} this week` : null
  // Lead with the strongest signal.
  if (agg.types.has('doorstep_appraisal_request') || agg.hasMomentEvent) {
    const enquiry = agg.events.find((e) => e.event_type === 'portal_enquiry')
    if (enquiry) {
      return ['Enquired via a portal', visitsPhrase].filter(Boolean).join(' · ')
    }
    return ['Requested an appraisal', visitsPhrase].filter(Boolean).join(' · ')
  }
  if (agg.types.has('doorstep_buyer_enquiry')) {
    return ['Enquired at an inspection', visitsPhrase].filter(Boolean).join(' · ')
  }
  // Website-only: describe the dominant recent page.
  const sold = agg.events.find((e) => e.page_type === 'sold' || /sold/i.test(eventPropValue(e.properties, 'path') ?? ''))
  if (sold) return ['Browsing sold results', visitsPhrase].filter(Boolean).join(' · ')
  const appraisalPage = agg.events.find((e) => e.page_type === 'appraisal')
  if (appraisalPage) return ['Viewing the appraisal page', visitsPhrase].filter(Boolean).join(' · ')
  return visitsPhrase ?? 'Browsing this property'
}

// ── The deriver ────────────────────────────────────────────────────────────────

export function derivePropertySignal(input: DerivePropertySignalInput): PropertySignal {
  const { now, contacts, propertyAddress } = input

  // 1. Circling contacts (known only — anon engagement folds into anonSessions).
  const aggs = aggregateCircling(input)
  const circling: CirclingContact[] = []
  for (const agg of aggs.values()) {
    const contact = contacts.get(agg.contactId)
    if (!contact) continue // contact soft-deleted / not in scope
    const delta = visitDelta(agg.events, now)
    const ageMs = agg.lastEngagedMs > 0 ? now - agg.lastEngagedMs : Number.POSITIVE_INFINITY
    const pct = pullScore({
      recency: recencyScore(ageMs),
      volume: volumeScore(agg.count),
      intent: intentScore(agg.types, agg.hasMomentEvent),
    })
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || 'A contact'
    const firstName = contact.first_name ?? name.split(' ')[0]
    circling.push({
      contactId: agg.contactId,
      name,
      firstName,
      initials: makeInitials(contact),
      identity: deriveIdentity(contact),
      pct,
      tier: tierFor(pct).word,
      delta,
      lastSeen: agg.lastEngagedMs > 0 ? new Date(agg.lastEngagedMs).toISOString() : contact.last_seen_at,
      read: buildRead(agg, delta),
    })
  }
  // Hottest first; stable tie-break by name so ordering is deterministic.
  circling.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name))

  // 2. Timeline — newest first, classified.
  const sortedEvents = [...input.events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
  const timeline: PropertyTimelineRow[] = []
  for (const e of sortedEvents) {
    if (TIMELINE_EXCLUDED_TYPES.has(e.event_type)) continue
    const contact = e.contact_id ? contacts.get(e.contact_id) ?? null : null
    const contactName = contact
      ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email
      : null

    if (MOMENT_EVENT_TYPES.has(e.event_type)) {
      const m = buildMoment(e, contactName, propertyAddress)
      timeline.push({ id: e.id, kind: 'moment', label: m.label, detail: m.detail, tie: m.tie, occurredAt: e.occurred_at })
      continue
    }
    if (contact && contactName) {
      timeline.push({
        id: e.id,
        kind: 'known',
        contactId: contact.id,
        contactName,
        initials: makeInitials(contact),
        identity: deriveIdentity(contact),
        label: propertyEventVerb(e),
        detail: eventPropValue(e.properties, 'title'),
        occurredAt: e.occurred_at,
      })
      continue
    }
    timeline.push({
      id: e.id,
      kind: 'anon',
      label: `Anonymous visit · ${propertyEventVerb(e).toLowerCase()}`,
      detail: 'Returns as a name the moment Horace recognises them.',
      occurredAt: e.occurred_at,
    })
  }

  // 3. Anonymous sessions this month (distinct un-attributed sessions).
  const anonSessionIds = new Set<string>()
  let anonEventFallback = 0
  for (const e of input.events) {
    if (e.contact_id) continue
    const t = Date.parse(e.occurred_at)
    if (!Number.isFinite(t) || now - t > MONTH_MS) continue
    if (e.session_id) anonSessionIds.add(e.session_id)
    else anonEventFallback += 1
  }
  const anonSessions = anonSessionIds.size + anonEventFallback

  // 4. Coarse engagement bucket — distinct property events in the last 7 days.
  let recent7d = 0
  for (const e of input.events) {
    const t = Date.parse(e.occurred_at)
    if (Number.isFinite(t) && now - t <= WEEK_MS) recent7d += 1
  }
  const engagement: EngagementValue = recent7d >= 9 ? 3 : recent7d >= 4 ? 2 : recent7d >= 1 ? 1 : 0

  // 5. Change chips — the headline signals, in priority order, capped at 3.
  const changeChips = buildChangeChips({ circling, timeline, anonSessions })

  return {
    circling,
    timeline,
    changeChips,
    anonSessions,
    engagement,
    knownCount: circling.length,
  }
}

export function buildChangeChips(parts: {
  circling: CirclingContact[]
  timeline: PropertyTimelineRow[]
  anonSessions: number
}): ChangeChip[] {
  const chips: ChangeChip[] = []
  // a) The most recent moment (appraisal / enquiry), tied to a name where we can.
  const moment = parts.timeline.find((r): r is Extract<PropertyTimelineRow, { kind: 'moment' }> => r.kind === 'moment')
  if (moment) {
    // Find the hottest contact who owns a moment event for the chip name.
    const named = parts.circling.find((c) => c.read.startsWith('Requested') || c.read.startsWith('Enquired'))
    chips.push({
      icon: 'flame',
      label: named ? `${moment.label} · ${named.firstName}` : moment.label,
    })
  }
  // b) The hottest contact's per-week delta.
  const hottest = parts.circling.find((c) => c.delta > 0)
  if (hottest) {
    chips.push({ icon: 'repeat', label: `${hottest.firstName} · +${hottest.delta} visit${hottest.delta === 1 ? '' : 's'} this week` })
  }
  // c) Anonymous sessions.
  if (parts.anonSessions > 0) {
    chips.push({ icon: 'eye-off', label: `${parts.anonSessions} anonymous session${parts.anonSessions === 1 ? '' : 's'}` })
  }
  return chips.slice(0, 3)
}

// ── DB orchestrator ──────────────────────────────────────────────────────────────

/**
 * Fetch + derive the property signal. `db` should be a service-role / admin
 * client: `contact_property_engagement` isn't in the generated types yet
 * (regen deferred — see memory), so this takes an untyped SupabaseClient and
 * the api-v1 untyped-read pattern applies.
 */
export async function fetchPropertySignal(opts: {
  db: SupabaseClient
  workspaceId: string
  propertyId: string
  propertyAddress: string
  now?: number
  eventLimit?: number
}): Promise<PropertySignal> {
  const { db, workspaceId, propertyId, propertyAddress } = opts
  const now = opts.now ?? Date.now()
  const eventLimit = opts.eventLimit ?? 200

  // Events on this property — match the rollup's coalesce(property_id,
  // properties->>'property_id') so column-backfilled and legacy-jsonb rows
  // both land.
  const { data: rawEvents } = await db
    .from('events')
    .select('id, event_type, properties, occurred_at, contact_id, session_id, page_type')
    .eq('workspace_id', workspaceId)
    .or(`property_id.eq.${propertyId},properties->>property_id.eq.${propertyId}`)
    .order('occurred_at', { ascending: false })
    .limit(eventLimit)

  const events: PropertyEventRow[] = (rawEvents ?? []).map((e: Record<string, unknown>) => ({
    id: String(e.id),
    event_type: String(e.event_type),
    properties: (e.properties as Record<string, unknown> | null) ?? null,
    occurred_at: String(e.occurred_at),
    contact_id: (e.contact_id as string | null) ?? null,
    session_id: (e.session_id as string | null) ?? null,
    page_type: (e.page_type as string | null) ?? null,
  }))

  // Engagement rollup for this property (unions inspection-only buyers).
  const { data: rawEngagement } = await db
    .from('contact_property_engagement')
    .select('contact_id, type, first_engaged_at, last_engaged_at, engagement_count')
    .eq('workspace_id', workspaceId)
    .eq('property_id', propertyId)

  const engagementRows: EngagementRollupRow[] = (rawEngagement ?? []).map((r: Record<string, unknown>) => ({
    contact_id: String(r.contact_id),
    type: r.type as EngagementType,
    first_engaged_at: String(r.first_engaged_at),
    last_engaged_at: String(r.last_engaged_at),
    engagement_count: Number(r.engagement_count ?? 0),
  }))

  // Hydrate every referenced contact (alive only).
  const contactIds = new Set<string>()
  for (const e of events) if (e.contact_id) contactIds.add(e.contact_id)
  for (const r of engagementRows) contactIds.add(r.contact_id)

  const contacts = new Map<string, ContactLite>()
  if (contactIds.size > 0) {
    const { data: rawContacts } = await db
      .from('contacts')
      .select('id, first_name, last_name, email, phone, score, last_seen_at')
      .in('id', [...contactIds])
      .is('deleted_at', null)
    for (const c of (rawContacts ?? []) as Record<string, unknown>[]) {
      contacts.set(String(c.id), {
        id: String(c.id),
        first_name: (c.first_name as string | null) ?? null,
        last_name: (c.last_name as string | null) ?? null,
        email: (c.email as string | null) ?? null,
        phone: (c.phone as string | null) ?? null,
        score: Number(c.score ?? 0),
        last_seen_at: (c.last_seen_at as string | null) ?? null,
      })
    }
  }

  return derivePropertySignal({ now, propertyAddress, events, engagementRows, contacts })
}
