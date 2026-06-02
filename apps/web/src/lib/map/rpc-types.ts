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

/**
 * HOR-219: prebuilt narrative for the signal panel. Deterministic templates
 * (not Haiku per-pin — that'd be expensive and click-latency too high).
 * The overall map `summary` stays Haiku; per-pin stories stay deterministic
 * but composed server-side so the contract stays MCP-callable.
 */
export interface PropertyStory {
  /** Horace-voice one-liner. Never templated client-side. */
  lead:    string
  /** "12 sessions this week" / "One session today" etc. */
  sessions: string
  /** Recency / cadence prose. "Active right now", "Earlier this month", etc. */
  pattern: string
}

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
  story:     PropertyStory
}

// ─── Suburb tier ────────────────────────────────────────────────────────────

export type SuburbState = 'quiet' | 'warm' | 'hot' | 'stirring'

/**
 * HOR-219: per-suburb story for the side panel. Derived in the route
 * from property + contact data already in the payload — no extra RPC.
 */
export interface SuburbStory {
  /** Horace-voice headline. */
  headline: string
  /** A sentence or two of context. */
  body:     string
  /** Stats row across the top of the panel. Mix of counts + canonical names. */
  stats:    Array<{ label: string; value: string }>
  /** Known contacts active in this suburb in the window. Deduped across properties. */
  contacts: Array<{ id: string; name: string; lastActiveAt: string }>
  /** Active properties (state != quiet) in this suburb, address-sorted. */
  topProperties: Array<{ id: string; address: string; state: PropertyState }>
}

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
  story:        SuburbStory
}

// ─── Suburb boundary (HOR-369) ───────────────────────────────────────────────
//
// City-zoom choropleth geometry. Served as a parallel array on MapPayload keyed
// by suburb `id` (same id as SuburbSignal.id) rather than fattening every
// SuburbSignal — keeps geometry out of the summary cache key and lets the FE
// join boundaries to signals only when it renders the city read. Suburbs with
// no matched boundary are simply absent; the FE falls back to radial heat.

/**
 * Minimal GeoJSON geometry — the SAL polygons are always Polygon or
 * MultiPolygon. Coordinates are [lng, lat] (WGS84), GeoJSON axis order.
 * Typed structurally (not `unknown`) so the FE can switch on `type` without a
 * cast; kept tolerant of either geometry kind the ingestion may emit.
 */
export interface GeoJsonPolygon {
  type: 'Polygon'
  coordinates: number[][][]
}
export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon'
  coordinates: number[][][][]
}
export type SuburbBoundaryGeometry = GeoJsonPolygon | GeoJsonMultiPolygon

export interface SuburbBoundary {
  /** Matches SuburbSignal.id (gnaf locality_pid, or lowercase-name fallback). */
  id:       string
  geometry: SuburbBoundaryGeometry
  /** Representative point for label placement / fit. Null only if source lacked one. */
  lat:      number | null
  lng:      number | null
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
  /**
   * HOR-369: city-zoom choropleth polygons, keyed by suburb `id`. Parallel to
   * `suburbs[]` (a suburb may appear in `suburbs` with no boundary here, in
   * which case the FE falls back to radial heat). Empty until the SAL ingestion
   * has populated `suburb_boundaries`.
   */
  boundaries: SuburbBoundary[]
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

export interface GetSuburbBoundariesRow {
  id:               string
  boundary_geojson: SuburbBoundaryGeometry
  centroid_lat:     number | null
  centroid_lng:     number | null
}
