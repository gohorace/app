/**
 * HOR-160 — POST /api/onboarding/pairing-complete.
 *
 * Phone-side endpoint that marks a pairing token consumed. Called
 * from the phone after the push permission resolves (either granted
 * or denied) — the spec is clear that the desktop should flip to
 * "Paired" even on denial, provided the install/sign-in succeeded.
 *
 * Auth: phone session (Supabase). Body: { token, outcome, deviceLabel? }.
 *
 * Idempotent. If the row is already consumed, returns ok without
 * re-stamping — the phone may retry on flaky network without
 * corrupting state.
 *
 * Explicit endpoint rather than wrapping /api/push/subscribe:
 *   • The `push_denied_but_installed` outcome doesn't go through
 *     subscribe at all — it has no subscription to save.
 *   • Subscribe has multiple call sites (notify step, settings,
 *     future devices) which shouldn't couple to pairing semantics.
 *   • Atomicity: if pairing-complete fails after subscribe
 *     succeeds, the subscription is still good and the user is
 *     paired; the desktop poll surfaces it on the next cycle once
 *     the retry lands.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashPairingToken, looksLikePairingToken } from '@/lib/pairing/tokens'

export const runtime = 'nodejs'

const schema = z.object({
  token: z.string().min(1),
  outcome: z.enum(['push_granted', 'push_denied_but_installed']),
  deviceLabel: z.string().max(64).optional(),
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const { token, outcome, deviceLabel } = parsed.data

  if (!looksLikePairingToken(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const tokenHash = hashPairingToken(token)
  const { data: row } = await admin
    .from('pairing_tokens')
    .select('id, agent_id, expires_at, consumed_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  if (row.agent_id !== agent.id) {
    // The phone session shouldn't be able to redeem someone else's
    // token — the magic link is bound to the agent's email. But
    // defence in depth.
    console.warn('[pairing-complete] agent mismatch:', { user: user.id, row: row.id })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Idempotent: already consumed → return ok without restamping.
  if (row.consumed_at) {
    return NextResponse.json({ ok: true, alreadyConsumed: true })
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Token expired' }, { status: 410 })
  }

  const { error: updErr } = await admin
    .from('pairing_tokens')
    .update({
      consumed_at: new Date().toISOString(),
      consumed_outcome: outcome,
      device_label: deviceLabel ?? null,
    })
    .eq('id', row.id)

  if (updErr) {
    console.error('[pairing-complete] update error:', updErr)
    return NextResponse.json({ error: 'Failed to complete' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
