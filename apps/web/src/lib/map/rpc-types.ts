/**
 * HOR-216 — MapPayload contract for the Properties Map View (epic HOR-215).
 *
 * Hand-typed because Supabase's `gen types` isn't auto-run yet (see
 * `apps/web/src/types/database.types.ts` header). Keep these in lockstep
 * with `supabase/migrations/20260518000040_property_signal_rpcs.sql`
 * — same column names, same nullability, same enum strings.
 *
 * The shape is intentionally MCP-readiness compliant per CLAUDE.md hard
 * rule #3: every field a tool would need to render the map view is here,
 * with no view-state coupling. An MCP `get_map_payload` tool can return
 * exactly this object.
 */

export type TimeWindow = '24h' | '7d' | '30d'

export const TIME_WINDOWS: readonly TimeWindow[] = ['24h', '7d', '30d'] as const

export function isTimeWindow(v: unknown): v is TimeWindow {
  return v === '24h' || v === '7d' || v === '30d'
}

// ─── Property tier ──────────────────────────────────────────────────────────

export type PropertyState = 'quiet' | 'active' | 'hot'

export interface PropertySignal {
  id:        string
  address:   string
  suburb:    string | null
  lat:       number | null
  lng:       number | null
  state:     PropertyState
  intensity: number              // 0..1
  sessionCount: number
  lastSeen:  string | null       // ISO timestamp
  knownContact?: {
    name:  string
    since: string                // ISO timestamp
  }
}

// ─── Suburb tier ────────────────────────────────────────────────────────────

export type SuburbState = 'quiet' | 'warm' | 'hot' | 'stirring'

export interface SuburbSignal {
  id:           string           // gnaf locality_pid when matched; lowercase name fallback
  name:         string
  stateAbbrev:  string | null    // 'QLD' etc; null when no GNAF match
  lat:          number | null    // centroid; null when no GNAF match
  lng:          number | null
  state:        SuburbState
  intensity:    number           // 0..1
  signalDelta:  number | null    // percent change vs previous window; null when no prior signal
  propertyCount: number
}

// ─── Heat cell ──────────────────────────────────────────────────────────────

export interface HeatCell {
  lat:       number
  lng:       number
  intensity: number              // 0..1, recency-weighted
}

// ─── Counters (drives header chip row) ──────────────────────────────────────
//
// Brief: "7 warm · 12 active · 4 stirring". Mixed units by design — warm and
// stirring are suburb counts, active is a property count.

export interface MapCounters {
  /** Suburbs in 'warm' OR 'hot' OR 'stirring' state. */
  warm:     number
  /** Properties in 'active' OR 'hot' state. */
  active:   number
  /** Suburbs in 'stirring' state. */
  stirring: number
}

// ─── Root payload ───────────────────────────────────────────────────────────

export interface MapPayload {
  timeWindow: TimeWindow
  heat:       HeatCell[]
  suburbs:    SuburbSignal[]
  properties: PropertySignal[]
  /** Horace-voiced summary line composed server-side. Filled by HOR-217; empty until then. */
  summary:    string
  counters:   MapCounters
}

// ─── Raw RPC row shapes (snake_case, matches RPC return columns 1:1) ────────
//
// Kept separate from the camelCase public types so the route's mapping layer
// is the only place that translates the contract. If the RPC return changes
// the only impact is in the route adapter.

export interface GetPropertySignalsRow {
  id:                    string
  address:               string
  suburb:                string | null
  latitude:              number | null
  longitude:             number | null
  state:                 PropertyState
  intensity:             number
  session_count:         number
  last_seen:             string | null
  known_contact_name:    string | null
  known_contact_since:   string | null
}

export interface GetSuburbSignalsRow {
  id:                string
  name:              string
  state_abbrev:      string | null
  latitude:          number | null
  longitude:         number | null
  state:             SuburbState
  intensity:         number
  signal_delta_pct:  number | null
  property_count:    number
}

export interface GetMapHeatCellsRow {
  latitude:  number
  longitude: number
  intensity: number
}
