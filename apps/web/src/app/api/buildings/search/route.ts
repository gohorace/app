/**
 * GET /api/buildings/search?q=…&limit=10&locality_pid=…
 *
 * Building/complex-picker typeahead for the granular import flow
 * (HOR-410). Thin wrapper around the SECURITY DEFINER
 * `search_buildings(p_q, p_limit, p_locality_pid)` RPC over
 * gnaf.complexes.
 *
 * Buildings are structural (no G-NAF building_name): the agent searches
 * by street, optionally prefixing the number ("10 Smith St"). The RPC
 * returns unit_count + locality + postcode for disambiguation. Optional
 * locality_pid narrows to one suburb.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface BuildingRow {
  complex_key:         string
  street_locality_pid: string
  number_first:        string
  street_name:         string
  street_type_code:    string | null
  locality_pid:        string
  locality_name:       string
  state_abbrev:        string
  postcode:            string | null
  unit_count:          number
  address_count:       number
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  const limitRaw = request.nextUrl.searchParams.get('limit')
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 10, 1), 50) : 10
  const localityPid = (request.nextUrl.searchParams.get('locality_pid') ?? '').trim() || null

  if (q.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await admin.rpc('search_buildings' as any, {
    p_q: q,
    p_limit: limit,
    p_locality_pid: localityPid,
  })

  if (error) {
    console.error('[buildings/search] rpc error', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  return NextResponse.json({ results: (data as BuildingRow[] | null) ?? [] })
}
