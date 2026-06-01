/**
 * POST /api/core-markets   — add a market and enqueue its import.
 * GET  /api/core-markets   — list the current agent's active markets
 *                            with the latest import status for each.
 *
 * The DELETE handler lives at [id]/route.ts and calls the
 * `archive_core_market` RPC.
 *
 * Auth pattern: anon-client getUser → admin-client agent lookup →
 * admin-client mutations. RLS on core_markets is SELECT-only for
 * workspace members; writes go through this route under service-role.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

const MAX_ACTIVE_MARKETS = 3

interface CoreMarketResponse {
  id:            string
  locality_pid:  string
  locality_name: string
  state_abbrev:  string
  postcode:      string | null
  created_at:    string
  archived_at:   string | null
  import_status: 'pending' | 'running' | 'complete' | 'error' | null
}

// ─── GET ────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id)
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Active markets first, newest first. We pull import status via a
  // separate query rather than LEFT JOIN LATERAL (the supabase-js
  // builder doesn't support lateral joins; the second round-trip is
  // cheap on a ≤3-row set).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: markets, error } = await admin
    .from('core_markets' as any)
    .select('id, locality_pid, locality_name, state_abbrev, postcode, created_at, archived_at')
    .eq('agent_id', agent.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (markets ?? []) as Array<Omit<CoreMarketResponse, 'import_status'>>
  if (rows.length === 0) {
    return NextResponse.json({ markets: [] })
  }

  // Latest import status per core_market_id.
  const { data: imports } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('core_market_imports' as any)
    .select('core_market_id, status, enqueued_at')
    .in('core_market_id', rows.map((m) => m.id))
    .order('enqueued_at', { ascending: false })

  const statusByMarket = new Map<string, CoreMarketResponse['import_status']>()
  for (const i of (imports as Array<{ core_market_id: string; status: CoreMarketResponse['import_status'] }> | null) ?? []) {
    // First entry wins because the query is ordered desc — `Map.set`
    // overwrites, so we'd take the LAST. Skip if already set.
    if (!statusByMarket.has(i.core_market_id)) {
      statusByMarket.set(i.core_market_id, i.status)
    }
  }

  const response: CoreMarketResponse[] = rows.map((m) => ({
    ...m,
    import_status: statusByMarket.get(m.id) ?? null,
  }))

  return NextResponse.json({ markets: response })
}

// ─── POST ───────────────────────────────────────────────────────────

interface PostBody {
  locality_pid?: string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id)
  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'Agent or workspace not found' }, { status: 404 })
  }

  // Parse + validate body
  let body: PostBody
  try {
    body = (await request.json()) as PostBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const localityPid = typeof body.locality_pid === 'string' ? body.locality_pid.trim() : ''
  if (!localityPid) {
    return NextResponse.json({ error: 'locality_pid is required' }, { status: 400 })
  }

  // Enforce the 1–3 active markets cap.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: activeCount } = await admin
    .from('core_markets' as any)
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agent.id)
    .is('archived_at', null)

  if ((activeCount ?? 0) >= MAX_ACTIVE_MARKETS) {
    return NextResponse.json({
      error: `Maximum ${MAX_ACTIVE_MARKETS} core markets allowed. Archive one before adding another.`,
    }, { status: 400 })
  }

  // Validate locality_pid exists in gnaf.localities; denorm name/state/postcode
  // onto the core_markets row so the UI doesn't need to join gnaf.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: locality } = await admin
    .schema('gnaf' as any)
    .from('localities' as any)
    .select('locality_pid, locality_name, state_abbrev, postcode')
    .eq('locality_pid', localityPid)
    .maybeSingle()

  if (!locality) {
    return NextResponse.json({ error: 'Unknown locality_pid' }, { status: 404 })
  }
  const localityRow = locality as { locality_pid: string; locality_name: string; state_abbrev: string; postcode: string | null }

  // Insert core_markets row. ON CONFLICT ... DO NOTHING via the partial
  // unique index (agent_id, locality_pid) WHERE archived_at IS NULL —
  // if the agent already has this market active, return the existing row.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertResult = await admin
    .from('core_markets' as any)
    .insert({
      workspace_id:  agent.workspace_id,
      agent_id:      agent.id,
      locality_pid:  localityRow.locality_pid,
      locality_name: localityRow.locality_name,
      state_abbrev:  localityRow.state_abbrev,
      postcode:      localityRow.postcode,
    })
    .select('id, locality_pid, locality_name, state_abbrev, postcode, created_at')
    .maybeSingle()

  let coreMarket = insertResult.data as Omit<CoreMarketResponse, 'archived_at' | 'import_status'> | null
  const insertError = insertResult.error

  if (insertError) {
    // PostgreSQL error 23505 = unique_violation. Race-conditioned re-add
    // (two concurrent POSTs from the same agent for the same locality).
    // Look up the existing live row and return it.
    if ((insertError as { code?: string }).code === '23505') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await admin
        .from('core_markets' as any)
        .select('id, locality_pid, locality_name, state_abbrev, postcode, created_at')
        .eq('agent_id', agent.id)
        .eq('locality_pid', localityPid)
        .is('archived_at', null)
        .maybeSingle()
      coreMarket = existing as Omit<CoreMarketResponse, 'archived_at' | 'import_status'> | null
    } else {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  if (!coreMarket) {
    return NextResponse.json({ error: 'Failed to insert core_market' }, { status: 500 })
  }

  // Enqueue import. The pg_cron-driven worker picks this up on the
  // next tick (≤1 min) — no synchronous wait here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: importJob, error: importError } = await admin
    .from('core_market_imports' as any)
    .insert({
      core_market_id: coreMarket.id,
      workspace_id:   agent.workspace_id,
      agent_id:       agent.id,
      locality_pid:   coreMarket.locality_pid,
      status:         'pending',
    })
    .select('id')
    .single()

  if (importError) {
    // core_market is already created; this is a soft-fail — the worker
    // route also handles "stuck without an import job" by treating
    // markets older than X with no import as eligible for catch-up.
    // For now we just log and return the market without an import_id.
    console.error('[core-markets] failed to enqueue import', importError)
    return NextResponse.json({
      core_market: coreMarket,
      import_id:   null,
      warning:     'Import enqueue failed; will retry automatically.',
    }, { status: 201 })
  }

  return NextResponse.json({
    core_market: coreMarket,
    import_id:   (importJob as { id: string }).id,
  }, { status: 201 })
}
