/**
 * Content matching — HOR-387 (P3).
 *
 * Maps a lead's behaviour to ranked content candidates from the agent's own
 * fresh site content (the fresh_agent_site_content view, HOR-386), per the
 * brief's rule table. Pure logic (summarize → choose rule → build slots) is
 * split from IO (event RPC + view query) so the rules are unit-testable.
 *
 * Hard rules (v1): same-suburb only — no adjacency fallback; zero match → no
 * slot (omitted downstream, never stretched). Each slot carries up to 4 swap
 * alternatives (top-5 total). Muted content types never appear.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type SignalEvent = {
  event_type: string
  page_type: string | null
  suburb: string | null
  property_id: string | null
  session_id: string | null
  occurred_at: string
}

export type MatchContentType = 'listing' | 'sold' | 'suburb_report'

export interface ContentCandidate {
  id: string
  content_type: MatchContentType
  property_id: string | null
  source_url: string
  suburb: string | null
  address: string | null
  price_text: string | null
  sold_price_text: string | null
  bed: number | null
  bath: number | null
  car: number | null
  hero_image_url: string | null
  sold_date: string | null
  listed_date: string | null
  title: string | null
  published_date: string | null
  last_crawled_at: string
}

export type MatchRule =
  | 'repeat_listing'
  | 'appraisal'
  | 'viewed_sold'
  | 'report_download'
  | 'mixed'
  | 'none'

export type SlotRole = 'listing' | 'comparable_sold' | 'recent_sold' | 'suburb_report'

export interface MatchSlot {
  role: SlotRole
  chosen: ContentCandidate
  /** Up to 4 swap alternatives (top-5 total with `chosen`). */
  alternatives: ContentCandidate[]
}

export interface ActivitySummary {
  sessionCount: number
  primarySuburb: string | null
  soldSuburb: string | null
  reportSuburb: string | null
  appraisalVisits: number
  repeatListing: { propertyId: string; suburb: string | null; count: number } | null
}

export interface MatchResult {
  rule: MatchRule
  suburb: string | null
  slots: MatchSlot[]
}

export type ContentPools = Partial<Record<MatchContentType, ContentCandidate[]>>

// ─── Pure: summarize ────────────────────────────────────────────────

function topKey(counts: Record<string, number>): string | null {
  let best: string | null = null
  let bestN = 0
  for (const [k, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = k
      bestN = n
    }
  }
  return best
}

export function summarizeActivity(events: SignalEvent[]): ActivitySummary {
  const suburbViews: Record<string, number> = {}
  const soldSuburbs: Record<string, number> = {}
  const reportSuburbs: Record<string, number> = {}
  const listingViews: Record<string, { count: number; suburb: string | null }> = {}
  const sessions = new Set<string>()
  let appraisalVisits = 0

  for (const e of events) {
    if (e.session_id) sessions.add(e.session_id)
    const sub = e.suburb?.trim() || null
    if (sub) suburbViews[sub] = (suburbViews[sub] ?? 0) + 1
    if (e.page_type === 'sold' && sub) soldSuburbs[sub] = (soldSuburbs[sub] ?? 0) + 1
    if (e.page_type === 'suburb_report' && sub) reportSuburbs[sub] = (reportSuburbs[sub] ?? 0) + 1
    if (e.page_type === 'appraisal') appraisalVisits++
    if (e.property_id) {
      const cur = listingViews[e.property_id] ?? { count: 0, suburb: sub }
      cur.count++
      if (!cur.suburb && sub) cur.suburb = sub
      listingViews[e.property_id] = cur
    }
  }

  let repeatListing: ActivitySummary['repeatListing'] = null
  for (const [propertyId, v] of Object.entries(listingViews)) {
    if (v.count >= 2 && (!repeatListing || v.count > repeatListing.count)) {
      repeatListing = { propertyId, suburb: v.suburb, count: v.count }
    }
  }

  return {
    sessionCount: sessions.size,
    primarySuburb: topKey(suburbViews),
    soldSuburb: topKey(soldSuburbs),
    reportSuburb: topKey(reportSuburbs),
    appraisalVisits,
    repeatListing,
  }
}

// ─── Pure: choose rule ──────────────────────────────────────────────
// Priority = specificity / intent: a repeated single-listing view is the
// strongest buyer signal; an appraisal visit is distinct seller intent; then
// comparable (sold) shopping, then lighter report research, then the mixed
// fallback. Same anchor suburb throughout (no adjacency in v1).

export function chooseRule(s: ActivitySummary): MatchRule {
  if (s.repeatListing) return 'repeat_listing'
  if (s.appraisalVisits > 0) return 'appraisal'
  if (s.soldSuburb) return 'viewed_sold'
  if (s.reportSuburb) return 'report_download'
  if (s.primarySuburb) return 'mixed'
  return 'none'
}

export function anchorSuburb(rule: MatchRule, s: ActivitySummary): string | null {
  switch (rule) {
    case 'repeat_listing':
      return s.repeatListing?.suburb ?? null
    case 'appraisal':
    case 'mixed':
      return s.primarySuburb
    case 'viewed_sold':
      return s.soldSuburb
    case 'report_download':
      return s.reportSuburb
    default:
      return null
  }
}

// ─── Pure: rank + build slots ───────────────────────────────────────

export function sortByRecency(type: MatchContentType, rows: ContentCandidate[]): ContentCandidate[] {
  const key = (c: ContentCandidate): number => {
    const v =
      type === 'sold'
        ? c.sold_date
        : type === 'suburb_report'
          ? (c.published_date ?? c.last_crawled_at)
          : (c.listed_date ?? c.last_crawled_at)
    const t = v ? Date.parse(v) : NaN
    return Number.isNaN(t) ? -Infinity : t
  }
  return [...rows].sort((a, b) => key(b) - key(a))
}

function makeSlot(role: SlotRole, list: ContentCandidate[], chosenIdx: number): MatchSlot | null {
  if (chosenIdx < 0 || chosenIdx >= list.length) return null
  const chosen = list[chosenIdx]
  const alternatives = list.filter((_, i) => i !== chosenIdx).slice(0, 4)
  return { role, chosen, alternatives }
}

export function buildSlots(rule: MatchRule, s: ActivitySummary, pools: ContentPools): MatchSlot[] {
  const listings = pools.listing ?? []
  const solds = pools.sold ?? []
  const reports = pools.suburb_report ?? []

  switch (rule) {
    case 'repeat_listing': {
      // The specific listing the lead kept viewing — only if it's still fresh
      // (bias to omission; don't substitute a different listing as "the one").
      const idx = listings.findIndex((c) => c.property_id === s.repeatListing?.propertyId)
      const listingSlot = idx >= 0 ? makeSlot('listing', listings, idx) : null
      const soldSlot = makeSlot('comparable_sold', solds, 0)
      return [listingSlot, soldSlot].filter((x): x is MatchSlot => x !== null)
    }
    case 'appraisal':
    case 'viewed_sold': {
      // 1–2 most recent sold in the anchor suburb.
      return [makeSlot('recent_sold', solds, 0), makeSlot('recent_sold', solds, 1)].filter(
        (x): x is MatchSlot => x !== null,
      )
    }
    case 'report_download':
    case 'mixed': {
      const slot = makeSlot('suburb_report', reports, 0)
      return slot ? [slot] : []
    }
    default:
      return []
  }
}

// ─── IO: load pools + orchestrate ───────────────────────────────────

const POOL_COLUMNS =
  'id, content_type, property_id, source_url, suburb, address, price_text, sold_price_text, bed, bath, car, hero_image_url, sold_date, listed_date, title, published_date, last_crawled_at'

async function fetchMutedTypes(admin: SupabaseClient, agentId: string): Promise<Set<string>> {
  const { data } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('agent_content_mutes' as any)
    .select('content_type')
    .eq('agent_id', agentId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Set((data ?? []).map((r: any) => r.content_type as string))
}

async function loadPool(
  admin: SupabaseClient,
  agentId: string,
  type: MatchContentType,
  suburb: string,
): Promise<ContentCandidate[]> {
  const { data } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('fresh_agent_site_content' as any)
    .select(POOL_COLUMNS)
    .eq('agent_id', agentId)
    .eq('content_type', type)
    .ilike('suburb', suburb)
    .limit(20)
  return sortByRecency(type, (data ?? []) as ContentCandidate[])
}

export async function matchContentForContact(
  admin: SupabaseClient,
  params: { agentId: string; contactId: string },
): Promise<MatchResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawEvents } = await admin.rpc('get_contact_signal_events' as any, {
    p_contact_id: params.contactId,
  })
  const summary = summarizeActivity((rawEvents ?? []) as SignalEvent[])
  const rule = chooseRule(summary)
  const suburb = anchorSuburb(rule, summary)

  if (rule === 'none' || !suburb) {
    return { rule, suburb: null, slots: [] }
  }

  const muted = await fetchMutedTypes(admin, params.agentId)
  const needed: MatchContentType[] = (['listing', 'sold', 'suburb_report'] as const).filter(
    (t) => !muted.has(t),
  )
  const pools: ContentPools = {}
  await Promise.all(
    needed.map(async (t) => {
      pools[t] = await loadPool(admin, params.agentId, t, suburb)
    }),
  )

  return { rule, suburb, slots: buildSlots(rule, summary, pools) }
}
