/**
 * GET /api/email/check-recipient?email=foo@bar.com
 *
 * Composer-side check: is this recipient on the agent's exclusion list,
 * or has the contact unsubscribed? Used to render an inline banner before
 * Send is enabled.
 *
 * Returns `{ excluded: boolean, reason: string | null }`.
 * 200 on success; 400 for missing/malformed email; 401 unauth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const email = (req.nextUrl.searchParams.get('email') ?? '').trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })
  if (!agent) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  // RPC cast: slice A's is_recipient_excluded isn't in the generated
  // Database types yet (database.types.ts is stale post-slice-A).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcRow, error } = await (admin.rpc as any)('is_recipient_excluded', {
    p_agent_id: agent.id,
    p_email: email.toLowerCase(),
  })
  if (error) {
    return NextResponse.json({ error: 'Check failed' }, { status: 500 })
  }
  // RPC returns table(excluded boolean, reason text); first row is the result.
  const rows = (rpcRow ?? []) as Array<{ excluded?: boolean; reason?: string | null }>
  const result = rows[0] ?? null
  return NextResponse.json({
    excluded: Boolean(result?.excluded),
    reason: result?.reason ?? null,
  })
}
