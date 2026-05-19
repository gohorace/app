/**
 * HOR-216 — MapPayload endpoint for the Properties Map View (epic HOR-215).
 *
 *   GET /api/properties/map-payload?timeWindow=24h|7d|30d
 *
 * Wraps three Postgres RPCs (migration 20260518000040_property_signal_rpcs)
 * and returns the contract `MapPayload` shape the brief specifies. Every map
 * refetch goes through here — no client-side recomputation, no view-state
 * coupling.
 *
 * HOR-217 wires `generateMapSummary` (Claude Haiku via the `briefing.ts`
 * pattern, cached for 1h in `map_summary_cache`) into this route. Empty
 * ANTHROPIC_API_KEY → deterministic fallback pool; no flag, no surprises.
 *
 * MCP-readiness (CLAUDE.md hard rule #3): the JSON returned is the exact shape
 * an MCP tool would emit. No client-shaped fields. The route is a thin adapter
 * over the RPCs; the RPCs are the public contract.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  type GetMapHeatCellsRow,
  type GetPropertySignalsRow,
  type GetSuburbSignalsRow,
  type HeatCell,
  type MapCounters,
  type MapPayload,
  type PropertySignal,
  type SuburbSignal,
  type TimeWindow,
  isTimeWindow,
} from '@/lib/map/rpc-types'
import { generateMapSummary } from '@/lib/ai/map-summary'

async function resolveAgent(userId: string) {
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', userId)
    .maybeSingle()
  return { admin, agent }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { admin, agent } = await resolveAgent(user.id)
  if (!agent?.workspace_id) {
    return NextResponse.json({ error: 'No workspace for user' }, { status: 400 })
  }

  const rawTimeWindow = req.nextUrl.searchParams.get('timeWindow')
  const timeWindow: TimeWindow = isTimeWindow(rawTimeWindow) ? rawTimeWindow : '7d'

  // Three RPCs in parallel. They each scope to workspace + (where relevant)
  // agent internally. Errors bubble up as 500s with the Postgres message —
  // matches the convention in /api/properties/[id]/route.ts.
  const [propsRes, suburbsRes, heatRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    admin.rpc('get_property_signals' as any, {
      p_workspace_id: agent.workspace_id,
      p_agent_id:     agent.id,
      p_time_window:  timeWindow,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    admin.rpc('get_suburb_signals' as any, {
      p_workspace_id: agent.workspace_id,
      p_agent_id:     agent.id,
      p_time_window:  timeWindow,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    admin.rpc('get_map_heat_cells' as any, {
      p_workspace_id: agent.workspace_id,
      p_time_window:  timeWindow,
    }),
  ])

  const anyError = propsRes.error ?? suburbsRes.error ?? heatRes.error
  if (anyError) {
    console.error('[api/properties/map-payload] RPC failure:', anyError)
    return NextResponse.json({ error: anyError.message }, { status: 500 })
  }

  const propRows    = (propsRes.data   as GetPropertySignalsRow[] | null) ?? []
  const suburbRows  = (suburbsRes.data as GetSuburbSignalsRow[]   | null) ?? []
  const heatRows    = (heatRes.data    as GetMapHeatCellsRow[]    | null) ?? []

  // ─── snake_case → camelCase, the route's only translation responsibility ──

  const properties: PropertySignal[] = propRows.map((r) => ({
    id:        r.id,
    address:   r.address,
    suburb:    r.suburb,
    lat:       r.latitude  != null ? Number(r.latitude)  : null,
    lng:       r.longitude != null ? Number(r.longitude) : null,
    state:     r.state,
    intensity: Number(r.intensity),
    sessionCount: r.session_count,
    lastSeen:  r.last_seen,
    knownContact: (r.known_contact_name && r.known_contact_since)
      ? { name: r.known_contact_name, since: r.known_contact_since }
      : undefined,
  }))

  const suburbs: SuburbSignal[] = suburbRows.map((r) => ({
    id:            r.id,
    name:          r.name,
    stateAbbrev:   r.state_abbrev,
    lat:           r.latitude  != null ? Number(r.latitude)  : null,
    lng:           r.longitude != null ? Number(r.longitude) : null,
    state:         r.state,
    intensity:     Number(r.intensity),
    signalDelta:   r.signal_delta_pct != null ? Number(r.signal_delta_pct) : null,
    propertyCount: r.property_count,
  }))

  const heat: HeatCell[] = heatRows.map((r) => ({
    lat:       Number(r.latitude),
    lng:       Number(r.longitude),
    intensity: Number(r.intensity),
  }))

  // ─── Counters — mixed units by design (see rpc-types.ts MapCounters) ──────

  const counters: MapCounters = {
    warm:     suburbs.filter((s) => s.state === 'warm' || s.state === 'hot' || s.state === 'stirring').length,
    active:   properties.filter((p) => p.state === 'active' || p.state === 'hot').length,
    stirring: suburbs.filter((s) => s.state === 'stirring').length,
  }

  // ─── Horace summary line (HOR-217) ─────────────────────────────────────────
  // Cached in Postgres for 1h per (workspace, agent, timeWindow, payload_hash).
  // Same scrubber click within the hour → zero LLM cost. Material change in
  // the suburb signal shape → cache miss → fresh Haiku → write-through.
  //
  // `topSuburbs` and `stirringSuburbs` are derived here (not in the RPC) so
  // the cache key can stabilise on the same shape: changing a suburb's
  // _signalDelta_ but not its tier doesn't bust the cache.

  const apiKey = process.env.ANTHROPIC_API_KEY
  const anthropic = apiKey ? new Anthropic({ apiKey }) : null

  const topSuburbs = suburbs
    .filter((s) => s.state === 'warm' || s.state === 'hot')
    // RPC already ordered by intensity desc — first 3 are the canonical "top".
    .slice(0, 3)
    .map((s) => ({ name: s.name, state: s.state as 'warm' | 'hot' }))

  const stirringSuburbs = suburbs
    .filter((s) => s.state === 'stirring')
    .slice(0, 3)
    .map((s) => s.name)

  const summary = await generateMapSummary(
    anthropic,
    agent.workspace_id,
    agent.id,
    { counters, topSuburbs, stirringSuburbs, timeWindow },
  )

  const payload: MapPayload = {
    timeWindow,
    heat,
    suburbs,
    properties,
    summary,
    counters,
  }

  return NextResponse.json(payload)
}
