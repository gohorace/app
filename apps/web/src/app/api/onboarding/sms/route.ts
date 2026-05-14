/**
 * HOR-162 — POST /api/onboarding/sms.
 *
 * SMS-fallback channel for the desktop pair screen. Sends the
 * signed pairing link to the agent's phone via Twilio.
 *
 * Body: { phone, token }.
 *
 * Validation:
 *   • Phone parses as a valid AU number and is MOBILE-typed
 *     (or FIXED_LINE_OR_MOBILE, which AU mobile prefixes resolve to
 *     when libphonenumber-js can't disambiguate).
 *   • Token belongs to the calling user's agent, un-consumed,
 *     un-expired.
 *
 * Rate limit (stored on the `pairing_tokens` row, so it survives
 * multi-tab and multi-device desktop scenarios):
 *   • sms_sends_count >= 3 → 429 (per-token cap).
 *   • last_sms_sent_at within 30s → 429 (per-token cooldown).
 *   • Counters increment ONLY after Twilio resolves successfully.
 *     A provider error does NOT consume rate-limit budget.
 *
 * Auth: Supabase session (desktop).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashPairingToken, looksLikePairingToken } from '@/lib/pairing/tokens'
import { normalizeAuMobile } from '@/lib/pairing/phone'
import { sendPairingLinkSms } from '@/lib/notifications/sms'

export const runtime = 'nodejs'

const SMS_CAP = 3
const SMS_COOLDOWN_SECONDS = 30

const schema = z.object({
  phone: z.string().min(1).max(40),
  token: z.string().min(1),
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
  const { phone, token } = parsed.data

  if (!looksLikePairingToken(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  const e164 = normalizeAuMobile(phone)
  if (!e164) {
    return NextResponse.json(
      { error: 'Enter a valid Australian mobile.' },
      { status: 400 },
    )
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
    .select('id, agent_id, expires_at, consumed_at, sms_sends_count, last_sms_sent_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  if (row.agent_id !== agent.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (row.consumed_at) {
    return NextResponse.json({ error: 'Already paired' }, { status: 410 })
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Token expired' }, { status: 410 })
  }

  // Rate-limit guards. Both check current row state — there is no
  // optimistic increment. Provider errors below do NOT advance the
  // counters; that's the fail-closed property.
  if (row.sms_sends_count >= SMS_CAP) {
    return NextResponse.json(
      { error: "You've reached the SMS limit for this pairing. Try the QR code instead." },
      { status: 429 },
    )
  }
  if (row.last_sms_sent_at) {
    const sinceMs = Date.now() - new Date(row.last_sms_sent_at).getTime()
    if (sinceMs < SMS_COOLDOWN_SECONDS * 1000) {
      const remaining = Math.ceil((SMS_COOLDOWN_SECONDS * 1000 - sinceMs) / 1000)
      return NextResponse.json(
        { error: `One more moment — you can resend in ${remaining}s.` },
        { status: 429, headers: { 'Retry-After': String(remaining) } },
      )
    }
  }

  // Dispatch first; only update counters after success.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const installUrl = `${appUrl}/m/${token}`
  try {
    await sendPairingLinkSms(e164, installUrl)
  } catch (err) {
    console.error('[/api/onboarding/sms] Twilio dispatch failed:', err)
    return NextResponse.json(
      { error: "Couldn't send. Try again or scan the QR." },
      { status: 502 },
    )
  }

  const { error: updErr } = await admin
    .from('pairing_tokens')
    .update({
      sms_sends_count: row.sms_sends_count + 1,
      last_sms_sent_at: new Date().toISOString(),
    })
    .eq('id', row.id)

  if (updErr) {
    // The SMS already went out — we just couldn't update the counter.
    // Log loudly but still report success so the agent doesn't retry.
    console.error('[/api/onboarding/sms] counter update failed post-send:', updErr)
  }

  return NextResponse.json({ ok: true })
}
