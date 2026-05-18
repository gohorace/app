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
 * The `summary` line is stubbed in this PR — HOR-217 wires `generateMapSummary`
 * into this route after the data shape lands.
 *
 * MCP-readiness (CLAUDE.md hard rule #3): the JSON returned is the exact shape
 * an MCP tool would emit. No client-shaped fields. The route is a thin adapter
 * over the RPCs; the RPCs are the public contract.
 */

import { NextRequest, NextResponse } from 'next/server'
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

  const payload: MapPayload = {
    timeWindow,
    heat,
    suburbs,
    properties,
    // HOR-217 wires generateMapSummary() here. Empty string until then so the
    // client renders nothing rather than a placeholder it has to special-case.
    summary: '',
    counters,
  }

  return NextResponse.json(payload)
}
