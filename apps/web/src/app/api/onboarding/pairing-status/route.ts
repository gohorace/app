/**
 * HOR-160 — GET /api/onboarding/pairing-status.
 *
 * Desktop polls this every ~2s while the agent is on the pair step
 * of onboarding. Returns the state of the latest `pairing_tokens`
 * row for the calling user's agent:
 *
 *   • { status: 'pending' }                                  → keep polling
 *   • { status: 'paired', outcome, deviceLabel? }            → stop polling
 *   • HTTP 404 (no row found at all)                         → no in-flight pair
 *
 * The original plan also distinguished an HTTP 410 "fully done"
 * state for once `last_completed_step='pair'`. For this slice we
 * collapse it into the `paired` JSON response — the desktop client
 * can read the status and decide when to stop. Simpler shape, same
 * behaviour.
 *
 * Auth: session. No body. No mutation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const agent = await resolvePrimaryAgent(admin, user.id)

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { data: row } = await admin
    .from('pairing_tokens')
    .select('expires_at, consumed_at, consumed_outcome, device_label')
    .eq('agent_id', agent.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!row) {
    // No pairing has ever been started — let the client decide what
    // to do (most likely: hit POST /pairing-token to mint one).
    return NextResponse.json({ error: 'No pairing token' }, { status: 404 })
  }

  if (row.consumed_at) {
    return NextResponse.json({
      status: 'paired',
      outcome: row.consumed_outcome,
      deviceLabel: row.device_label,
    })
  }

  // Token not yet consumed — return pending regardless of expiry.
  // The desktop client should stop polling when its own local
  // deadline (passed in via the issued `expiresAt`) passes; the
  // server doesn't gate the response on that here. Keeping the
  // shape stable keeps the client logic obvious.
  return NextResponse.json({ status: 'pending' })
}
