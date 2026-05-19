/**
 * HOR-219 — story composition for the signal panel.
 *
 * Per-pin / per-suburb narrative is composed server-side from the structured
 * payload (counts + state + recency). Deterministic templates, not Haiku —
 * per-entity LLM calls would be expensive and the click-to-panel latency
 * would suffer. The map-level `summary` (HOR-217) stays Haiku because it
 * runs once per refetch and is cached.
 *
 * Templates lean on the same Horace voice: confident, brief, slightly
 * poetic, no greeting, never CRM-y (no "schedule a call", no "follow up").
 * If the voice needs to evolve, edit here.
 *
 * MCP-readiness: the resulting story strings are part of the public
 * payload. A tool reading the contract would surface the same lines.
 */

import type {
  PropertySignal,
  PropertyStory,
  PropertyState,
  SuburbSignal,
  SuburbStory,
  TimeWindow,
} from '@/lib/map/rpc-types'

// ─── Window labels ──────────────────────────────────────────────────────────

const WINDOW_LABEL: Record<TimeWindow, string> = {
  '24h': 'today',
  '7d':  'this week',
  '30d': 'this month',
}

const WINDOW_SHORT: Record<TimeWindow, string> = {
  '24h': '24h',
  '7d':  '7d',
  '30d': '30d',
}

// ─── Property story ─────────────────────────────────────────────────────────

/** Public entry. Builds a `PropertyStory` from a `PropertySignal`. */
export function composePropertyStory(
  p: Omit<PropertySignal, 'story'>,
  timeWindow: TimeWindow,
): PropertyStory {
  return {
    lead:     composePropertyLead(p),
    sessions: composeSessionsLine(p.sessionCount, timeWindow),
    pattern:  composePatternLine(p, timeWindow),
  }
}

function composePropertyLead(p: Omit<PropertySignal, 'story'>): string {
  const name = p.knownContact?.name

  if (p.state === 'hot') {
    if (name) return `${name} keeps coming back — pattern building.`
    return 'Sustained attention from anonymous visitors. The kind that often surfaces a name.'
  }
  if (p.state === 'active') {
    if (name) return `${name} circled this one — light touch.`
    return 'Anonymous attention. Worth keeping warm.'
  }
  // quiet
  return 'Quiet right now. Nothing pulling for action.'
}

function composeSessionsLine(n: number, timeWindow: TimeWindow): string {
  const w = WINDOW_LABEL[timeWindow]
  if (n === 0) return `No sessions ${w}`
  if (n === 1) return `One session ${w}`
  return `${n} sessions ${w}`
}

function composePatternLine(
  p: Omit<PropertySignal, 'story'>,
  timeWindow: TimeWindow,
): string {
  if (!p.lastSeen) return 'No recent activity'
  const since = Date.now() - new Date(p.lastSeen).getTime()
  if (Number.isNaN(since)) return 'No recent activity'

  if (since < 60 * 60 * 1000)               return 'Active right now'
  if (since < 24 * 60 * 60 * 1000)          return 'Active in the last 24 hours'
  if (since < 7  * 24 * 60 * 60 * 1000)     return 'Active this week'
  if (since < 30 * 24 * 60 * 60 * 1000)     return 'Active in the last month'
  // Beyond the longest window — shouldn't happen if the payload respected the window,
  // but be defensive.
  return `Last active ${WINDOW_LABEL[timeWindow]}`
}

// ─── Suburb story ───────────────────────────────────────────────────────────

/**
 * Compose a suburb story from the suburb signal + the workspace's property
 * pool (the route passes in only properties belonging to this suburb, in
 * intensity order).
 */
export function composeSuburbStory(
  s: Omit<SuburbSignal, 'story'>,
  propertiesInSuburb: Array<Omit<PropertySignal, 'story'>>,
  timeWindow: TimeWindow,
): SuburbStory {
  const window = WINDOW_LABEL[timeWindow]
  const windowShort = WINDOW_SHORT[timeWindow]

  // ── Stats ──────────────────────────────────────────────────────────────
  const totalSessions = propertiesInSuburb.reduce((sum, p) => sum + p.sessionCount, 0)
  const top = propertiesInSuburb.length > 0
    ? [...propertiesInSuburb].sort((a, b) => b.intensity - a.intensity)[0]
    : null
  const knownContacts = dedupeKnownContacts(propertiesInSuburb)
  const activeProps = propertiesInSuburb.filter((p) => p.state !== 'quiet')

  const stats: SuburbStory['stats'] = [
    { label: `sessions · ${windowShort}`, value: String(totalSessions) },
    { label: 'top viewed',                value: top ? top.address : '—' },
    { label: 'known active',              value: String(knownContacts.length) },
  ]

  // ── Headline + body ────────────────────────────────────────────────────

  let headline: string
  let body: string

  if (s.state === 'hot') {
    headline = `${s.name} is concentrating signal ${window}.`
    body = top
      ? `Strongest interest on ${top.address}. ${activeProps.length} ${activeProps.length === 1 ? 'listing is' : 'listings are'} carrying weight across the suburb.`
      : `${activeProps.length} ${activeProps.length === 1 ? 'listing is' : 'listings are'} carrying weight across the suburb.`
  } else if (s.state === 'stirring') {
    const delta = s.signalDelta != null ? ` Signal up ${Math.round(s.signalDelta)}%.` : ''
    headline = `${s.name} stirring — something's shifting underneath.${delta}`
    body = top
      ? `Activity climbing fastest around ${top.address}. The kind of warmth that precedes a conversation.`
      : 'The kind of warmth that precedes a conversation.'
  } else if (s.state === 'warm') {
    headline = `${s.name} carrying steady warmth ${window}.`
    body = top
      ? `${activeProps.length} ${activeProps.length === 1 ? 'listing' : 'listings'} active across the suburb, ${top.address} leading.`
      : `${activeProps.length} ${activeProps.length === 1 ? 'listing' : 'listings'} active across the suburb.`
  } else {
    // quiet
    headline = `${s.name} is quiet ${window}.`
    body = propertiesInSuburb.length > 0
      ? `${propertiesInSuburb.length} ${propertiesInSuburb.length === 1 ? 'property' : 'properties'} in the patch, nothing pulling for attention right now.`
      : 'No properties in this suburb yet.'
  }

  // ── Active properties (rendered as link list in the panel) ─────────────
  const topProperties: SuburbStory['topProperties'] = activeProps
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 8)
    .map((p) => ({ id: p.id, address: p.address, state: p.state }))

  return { headline, body, stats, contacts: knownContacts, topProperties }
}

/**
 * Dedupe known contacts across all properties in a suburb. We don't have a
 * per-contact session count at the suburb level — the property's `lastSeen`
 * is the proxy for "last active". Returns up to 6 most-recently-active.
 */
function dedupeKnownContacts(
  props: Array<Omit<PropertySignal, 'story'>>,
): SuburbStory['contacts'] {
  const byName = new Map<string, { id: string; name: string; lastActiveAt: string }>()
  for (const p of props) {
    if (!p.knownContact || !p.lastSeen) continue
    const key = p.knownContact.name
    const existing = byName.get(key)
    if (!existing || new Date(p.lastSeen).getTime() > new Date(existing.lastActiveAt).getTime()) {
      byName.set(key, {
        // Use property id as a stable handle until we surface contact_id through
        // the RPC; HOR-220 can swap once the schema reflects contact identity.
        id: `prop:${p.id}`,
        name: p.knownContact.name,
        lastActiveAt: p.lastSeen,
      })
    }
  }
  return Array.from(byName.values())
    .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
    .slice(0, 6)
}

// ─── Route helper: group properties by suburb id ────────────────────────────

/**
 * Bucket the workspace's properties by the suburb id they belong to. The
 * suburb id may be a GNAF locality_pid (when matched) or a lowercased name
 * (fallback). The matching key is whatever the RPC returned as
 * `SuburbSignal.id` — for resolution, we map the property's `suburb` text
 * through the suburb roster's name+id lookup.
 *
 * Note: we match by lower-cased name to handle both GNAF-pid suburbs and
 * fallback rows. The suburb signal RPC already normalises this.
 */
export function bucketPropertiesBySuburb(
  properties: Array<Omit<PropertySignal, 'story'>>,
  suburbs: Array<Omit<SuburbSignal, 'story'>>,
): Map<string, Array<Omit<PropertySignal, 'story'>>> {
  const idByName = new Map<string, string>()
  for (const s of suburbs) {
    idByName.set(s.name.toLowerCase(), s.id)
  }
  const buckets = new Map<string, Array<Omit<PropertySignal, 'story'>>>()
  for (const p of properties) {
    const name = (p.suburb ?? '').toLowerCase()
    const id = idByName.get(name)
    if (!id) continue
    const arr = buckets.get(id) ?? []
    arr.push(p)
    buckets.set(id, arr)
  }
  return buckets
}
