/**
 * HOR-160 — POST /api/onboarding/pairing-token.
 *
 * Issues a fresh pairing token for the calling agent. The plaintext
 * is returned ONCE in the response (the desktop client uses it to
 * build the QR / SMS URL and holds it in component state); only the
 * sha256 hash is persisted on `pairing_tokens`.
 *
 * On each issue we delete any prior un-consumed rows for this agent.
 * Rationale: only one in-flight pairing per agent makes the polling
 * semantics on the desktop trivially "latest row". A consumed row is
 * left in place as a historical record (and so the phone can hit
 * `already paired` copy if it scans an old QR after success).
 *
 * Note on two-tab race: the original plan included a 60s
 * dedup-and-return-same-token rule. We dropped it because the row
 * stores token_hash only, so a second mint can't return the prior
 * tab's plaintext. The pragmatic alternative — cache plaintext in an
 * HttpOnly cookie — was deemed too much surface for a niche case.
 * The current behaviour: each issue revokes the prior un-consumed
 * row. Two desktop tabs will display different QRs but both poll
 * the same status endpoint, so both flip on first successful pair.
 */

import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mintPairingToken, TOKEN_TTL_SECONDS } from '@/lib/pairing/tokens'

export const runtime = 'nodejs'

// Visual tokens for the QR. Match the Horace palette — dark on cream
// rather than pure black on white. Kept inline (rather than imported
// from a tokens module) because qrcode's API takes string hex codes
// and these are tightly coupled to this single render context.
const QR_DARK = '#1A1A1A'
const QR_LIGHT = '#FAF6EF'

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Revoke prior un-consumed rows. Consumed rows stay so re-scans of
  // an old QR hit the "already paired" branch on the phone.
  const { error: revokeErr } = await admin
    .from('pairing_tokens')
    .delete()
    .eq('agent_id', agent.id)
    .is('consumed_at', null)

  if (revokeErr) {
    console.error('[pairing-token] revoke error:', revokeErr)
    return NextResponse.json({ error: 'Failed to issue token' }, { status: 500 })
  }

  const { plaintext, hash } = mintPairingToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString()

  const { error: insertErr } = await admin
    .from('pairing_tokens')
    .insert({
      agent_id: agent.id,
      token_hash: hash,
      expires_at: expiresAt,
    })

  if (insertErr) {
    console.error('[pairing-token] insert error:', insertErr)
    return NextResponse.json({ error: 'Failed to issue token' }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const qrUrl = `${appUrl}/m/${plaintext}`

  // Server-side QR render. Keeps `qrcode` off the client bundle and
  // avoids a round-trip from the client to fetch the image. 256×256
  // matches the visual spec (printed inside a card at 1× display).
  const qrDataUrl = await QRCode.toDataURL(qrUrl, {
    width: 256,
    margin: 1,
    color: { dark: QR_DARK, light: QR_LIGHT },
  })

  return NextResponse.json({ token: plaintext, expiresAt, qrUrl, qrDataUrl })
}
