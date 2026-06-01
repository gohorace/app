import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import type { ContactsInPatchResponse } from './types'

/**
 * GET /api/onboarding/contacts-in-patch  → { total, in_patch }
 *
 * Turn 4 of the agentic shell pings this immediately after the CSV
 * import lands. The pill reads "X of N already live in your patch" —
 * the contacts.suburb ↔ core_markets.locality_name join lives in the
 * onboarding_contacts_in_patch RPC (migration 20260518000041).
 *
 * Auth flow:
 *   1. Anon client resolves the auth user from the request cookie.
 *   2. Admin client looks up that user's agent.id (RLS on agents only
 *      allows SELECT for the owning user — the RPC needs the agent_id
 *      explicitly because it's SECURITY DEFINER).
 *   3. RPC computes the two counts in one round-trip.
 *
 * Types live in ./types — Next.js 14 disallows non-route exports from
 * route.ts.
 */

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id)
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // database.types.ts lags the 20260518000041 migration that adds the
  // RPC. Cast at the boundary until next `supabase gen types` regen —
  // same pattern as lib/onboarding/state.ts:57.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await admin.rpc('onboarding_contacts_in_patch' as any, {
    p_agent_id: agent.id,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // The RPC returns a TABLE — supabase-js delivers it as an array.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { total: number | string; in_patch: number | string }
    | null
    | undefined
  // `count(*)` returns bigint; supabase-js may surface as string on
  // older clients. Coerce defensively.
  const total = row ? Number(row.total) : 0
  const inPatch = row ? Number(row.in_patch) : 0

  const res: ContactsInPatchResponse = {
    total: Number.isFinite(total) ? total : 0,
    in_patch: Number.isFinite(inPatch) ? inPatch : 0,
  }
  return NextResponse.json(res)
}
