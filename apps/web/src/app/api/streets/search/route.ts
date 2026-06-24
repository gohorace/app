/**
 * GET /api/streets/search?q=…&limit=10&locality_pid=…
 *
 * Street-picker typeahead for the granular import flow (HOR-410). Thin
 * wrapper around the SECURITY DEFINER `search_streets(p_q, p_limit,
 * p_locality_pid)` RPC over gnaf.street_localities.
 *
 * Mirrors /api/localities/search: the RPC handles ordering (prefix
 * match → pg_trgm similarity → address_count) and the >= 2-char guard;
 * we authenticate, normalise, and pass through. The optional
 * locality_pid narrows results to a single suburb.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface StreetRow {
  street_locality_pid: string
  street_name:         string
  street_type_code:    string | null
  locality_pid:        string
  locality_name:       string
  state_abbrev:        string
  postcode:            string | null
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
  const { data, error } = await admin.rpc('search_streets' as any, {
    p_q: q,
    p_limit: limit,
    p_locality_pid: localityPid,
  })

  if (error) {
    console.error('[streets/search] rpc error', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  return NextResponse.json({ results: (data as StreetRow[] | null) ?? [] })
}
