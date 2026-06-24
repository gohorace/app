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

type Granularity = 'suburb' | 'street' | 'building'

interface CoreMarketResponse {
  id:                    string
  granularity:           Granularity
  locality_pid:          string
  locality_name:         string
  state_abbrev:          string
  postcode:              string | null
  street_locality_pid:   string | null
  building_number_first: string | null
  street_name:           string | null
  created_at:            string
  archived_at:           string | null
  import_status: 'pending' | 'running' | 'complete' | 'error' | null
}

const MARKET_SELECT =
  'id, granularity, locality_pid, locality_name, state_abbrev, postcode, street_locality_pid, building_number_first, street_name, created_at'

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
    .select(`${MARKET_SELECT}, archived_at`)
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
  // Defaults to 'suburb' when omitted — preserves the pre-HOR-410 shape
  // where callers sent only locality_pid.
  granularity?: Granularity
  locality_pid?: string
  // Required when granularity is 'street' or 'building'.
  street_locality_pid?: string
  // Required when granularity is 'building'.
  building_number_first?: string
}

/**
 * Resolves + validates the requested scope against the relevant gnaf
 * derived reference, returning the denormalised fields to persist on
 * the core_markets row. Returns an error string for the 4xx response.
 */
async function resolveScope(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  body: PostBody,
): Promise<{
  fields?: {
    granularity:           Granularity
    locality_pid:          string
    locality_name:         string
    state_abbrev:          string
    postcode:              string | null
    street_locality_pid:   string | null
    building_number_first: string | null
    street_name:           string | null
  }
  error?: string
  status?: number
}> {
  const granularity: Granularity = body.granularity ?? 'suburb'

  if (granularity === 'suburb') {
    const localityPid = typeof body.locality_pid === 'string' ? body.locality_pid.trim() : ''
    if (!localityPid) return { error: 'locality_pid is required', status: 400 }
    const { data } = await admin
      .schema('gnaf').from('localities')
      .select('locality_pid, locality_name, state_abbrev, postcode')
      .eq('locality_pid', localityPid).maybeSingle()
    if (!data) return { error: 'Unknown locality_pid', status: 404 }
    return { fields: {
      granularity, locality_pid: data.locality_pid, locality_name: data.locality_name,
      state_abbrev: data.state_abbrev, postcode: data.postcode,
      street_locality_pid: null, building_number_first: null, street_name: null,
    } }
  }

  if (granularity === 'street') {
    const streetPid = typeof body.street_locality_pid === 'string' ? body.street_locality_pid.trim() : ''
    if (!streetPid) return { error: 'street_locality_pid is required for street granularity', status: 400 }
    const { data } = await admin
      .schema('gnaf').from('street_localities')
      .select('street_locality_pid, street_name, locality_pid, locality_name, state_abbrev, postcode')
      .eq('street_locality_pid', streetPid).maybeSingle()
    if (!data) return { error: 'Unknown street_locality_pid', status: 404 }
    return { fields: {
      granularity, locality_pid: data.locality_pid, locality_name: data.locality_name,
      state_abbrev: data.state_abbrev, postcode: data.postcode,
      street_locality_pid: data.street_locality_pid, building_number_first: null,
      street_name: data.street_name,
    } }
  }

  // building
  const streetPid = typeof body.street_locality_pid === 'string' ? body.street_locality_pid.trim() : ''
  const numberFirst = typeof body.building_number_first === 'string' ? body.building_number_first.trim() : ''
  if (!streetPid || !numberFirst) {
    return { error: 'street_locality_pid and building_number_first are required for building granularity', status: 400 }
  }
  const complexKey = `${streetPid}:${numberFirst}`
  const { data } = await admin
    .schema('gnaf').from('complexes')
    .select('street_locality_pid, number_first, street_name, locality_pid, locality_name, state_abbrev, postcode')
    .eq('complex_key', complexKey).maybeSingle()
  if (!data) return { error: 'Unknown building/complex', status: 404 }
  return { fields: {
    granularity, locality_pid: data.locality_pid, locality_name: data.locality_name,
    state_abbrev: data.state_abbrev, postcode: data.postcode,
    street_locality_pid: data.street_locality_pid, building_number_first: data.number_first,
    street_name: data.street_name,
  } }
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

  const granularity: Granularity = body.granularity ?? 'suburb'
  if (!['suburb', 'street', 'building'].includes(granularity)) {
    return NextResponse.json({ error: 'Invalid granularity' }, { status: 400 })
  }

  // Enforce the 1–3 active markets cap. All granularities count toward
  // the same cap — finer scopes are still "places the agent works".
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

  // Resolve + validate the requested scope against the gnaf references,
  // denormalising the fields we persist so the UI never has to join gnaf.
  const scope = await resolveScope(admin, body)
  if (scope.error || !scope.fields) {
    return NextResponse.json({ error: scope.error ?? 'Invalid scope' }, { status: scope.status ?? 400 })
  }
  const fields = scope.fields

  // Insert core_markets row. The partial unique index now spans the full
  // scope tuple (agent, granularity, locality, street, building) so two
  // distinct places never collide; re-adding the SAME place returns the
  // existing row via the 23505 path below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertResult = await admin
    .from('core_markets' as any)
    .insert({
      workspace_id:          agent.workspace_id,
      agent_id:              agent.id,
      granularity:           fields.granularity,
      locality_pid:          fields.locality_pid,
      locality_name:         fields.locality_name,
      state_abbrev:          fields.state_abbrev,
      postcode:              fields.postcode,
      street_locality_pid:   fields.street_locality_pid,
      building_number_first: fields.building_number_first,
      street_name:           fields.street_name,
    })
    .select(MARKET_SELECT)
    .maybeSingle()

  let coreMarket = insertResult.data as Omit<CoreMarketResponse, 'archived_at' | 'import_status'> | null
  const insertError = insertResult.error

  if (insertError) {
    // PostgreSQL error 23505 = unique_violation. Race-conditioned re-add
    // of the same scope — look up the existing live row and return it.
    if ((insertError as { code?: string }).code === '23505') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = admin
        .from('core_markets' as any)
        .select(MARKET_SELECT)
        .eq('agent_id', agent.id)
        .eq('granularity', fields.granularity)
        .eq('locality_pid', fields.locality_pid)
        .is('archived_at', null)
      q = fields.street_locality_pid
        ? q.eq('street_locality_pid', fields.street_locality_pid)
        : q.is('street_locality_pid', null)
      q = fields.building_number_first
        ? q.eq('building_number_first', fields.building_number_first)
        : q.is('building_number_first', null)
      const { data: existing } = await q.maybeSingle()
      coreMarket = existing as Omit<CoreMarketResponse, 'archived_at' | 'import_status'> | null
    } else {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  if (!coreMarket) {
    return NextResponse.json({ error: 'Failed to insert core_market' }, { status: 500 })
  }

  // Enqueue import. The pg_cron-driven worker picks this up on the
  // next tick (≤1 min) — no synchronous wait here. Scope travels with
  // the job so the batch worker can filter by granularity.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: importJob, error: importError } = await admin
    .from('core_market_imports' as any)
    .insert({
      core_market_id:        coreMarket.id,
      workspace_id:          agent.workspace_id,
      agent_id:              agent.id,
      locality_pid:          coreMarket.locality_pid,
      granularity:           fields.granularity,
      street_locality_pid:   fields.street_locality_pid,
      building_number_first: fields.building_number_first,
      status:                'pending',
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
