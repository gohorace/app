/**
 * GET /api/localities/search?q=…&limit=10
 *
 * Suburb-picker typeahead for onboarding (HOR-194) and Settings →
 * Core markets (HOR-196). Thin wrapper around the SECURITY DEFINER
 * `search_localities(p_q, p_limit)` RPC (HOR-192 migration A7).
 *
 * The RPC handles ordering (prefix match wins, then pg_trgm
 * similarity) and the >= 2-character guard. We just authenticate,
 * normalise the query, and pass through.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface LocalityRow {
  locality_pid:  string
  locality_name: string
  state_abbrev:  string
  postcode:      string | null
}

export async function GET(request: NextRequest) {
  // Auth: any signed-in user can search. We don't gate by agent here
  // because the picker may be hit from onboarding-mid-signup flows
  // before an agent row exists in unusual states; the worst case is
  // a stranger using the typeahead on public CC BY 4.0 data.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  const limitRaw = request.nextUrl.searchParams.get('limit')
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 10, 1), 50) : 10

  // RPC enforces length >= 2 internally; we short-circuit here to avoid
  // a round-trip on empty inputs (the picker fires on every keystroke).
  if (q.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await admin.rpc('search_localities' as any, {
    p_q: q,
    p_limit: limit,
  })

  if (error) {
    console.error('[localities/search] rpc error', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  return NextResponse.json({ results: (data as LocalityRow[] | null) ?? [] })
}
