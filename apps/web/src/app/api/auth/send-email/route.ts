import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { Resend } from 'resend'
import { buildMagicLinkEmail, type MagicLinkAction } from '@/lib/notifications/email'

export const runtime = 'nodejs'

interface HookPayload {
  user: {
    id: string
    email?: string | null
    user_metadata?: Record<string, unknown> | null
  }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: MagicLinkAction
    site_url: string
    token_new?: string
    token_hash_new?: string
  }
}

function timingSafeEq(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

// Standard Webhooks signature scheme used by Supabase Auth Hooks.
// Secret is stored as `v1,whsec_<base64>`. The signature header is a
// space-separated list of `v1,<base64>` entries; any matching entry is valid.
function verifySignature(
  rawBody: string,
  headers: { id: string; timestamp: string; signature: string },
  secret: string,
): boolean {
  const stripped = secret.startsWith('v1,whsec_')
    ? secret.slice('v1,whsec_'.length)
    : secret.startsWith('whsec_')
      ? secret.slice('whsec_'.length)
      : secret

  let key: Buffer
  try {
    key = Buffer.from(stripped, 'base64')
  } catch {
    return false
  }

  const signed = `${headers.id}.${headers.timestamp}.${rawBody}`
  const expected = crypto.createHmac('sha256', key).update(signed).digest('base64')

  return headers.signature
    .split(' ')
    .filter((s) => s.startsWith('v1,'))
    .map((s) => s.slice(3))
    .some((sig) => timingSafeEq(sig, expected))
}

export async function POST(request: NextRequest) {
  const secret = process.env.SUPABASE_AUTH_HOOK_SECRET
  if (!secret) {
    console.error('[send-email] SUPABASE_AUTH_HOOK_SECRET not set')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const id = request.headers.get('webhook-id')
  const timestamp = request.headers.get('webhook-timestamp')
  const signature = request.headers.get('webhook-signature')
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: 'Missing webhook headers' }, { status: 401 })
  }

  // Reject replays older than 5 minutes.
  const ts = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return NextResponse.json({ error: 'Stale webhook' }, { status: 401 })
  }

  const rawBody = await request.text()
  if (!verifySignature(rawBody, { id, timestamp, signature }, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: HookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { user, email_data } = payload
  if (!user?.email || !email_data?.token_hash || !email_data?.email_action_type) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    console.error('[send-email] NEXT_PUBLIC_SUPABASE_URL not set')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  // Point the magic link at our own token_hash verifier (/auth/confirm)
  // instead of Supabase's PKCE `/auth/v1/verify` → `?code=` round-trip.
  // verifyOtp on /auth/confirm needs no code_verifier, so the link works even
  // when opened in a different browser than the one that requested it (e.g.
  // the Gmail in-app browser on iOS) — the case that made the PKCE callback
  // fail with "both auth code and code verifier should be non-empty".
  let verifyUrl: string
  try {
    const requested = new URL(email_data.redirect_to)
    const confirm = new URL('/auth/confirm', requested.origin)
    confirm.searchParams.set('token_hash', email_data.token_hash)
    confirm.searchParams.set('type', email_data.email_action_type)

    // Carry the original destination through. Invites encode the invite id as
    // a path segment on /auth/callback/invite/<id> (HOR-201); everything else
    // uses a ?redirectTo= query param.
    const inviteMatch = requested.pathname.match(/^\/auth\/callback\/invite\/([^/]+)/)
    if (inviteMatch) {
      confirm.searchParams.set('invite_id', decodeURIComponent(inviteMatch[1]))
    } else {
      const next = requested.searchParams.get('redirectTo')
      if (next) confirm.searchParams.set('redirectTo', next)
    }
    verifyUrl = confirm.toString()
  } catch {
    // redirect_to unparseable — fall back to Supabase's verify endpoint.
    verifyUrl =
      `${supabaseUrl}/auth/v1/verify` +
      `?token=${encodeURIComponent(email_data.token_hash)}` +
      `&type=${encodeURIComponent(email_data.email_action_type)}` +
      `&redirect_to=${encodeURIComponent(email_data.redirect_to)}`
  }

  const { subject, html } = buildMagicLinkEmail({
    action: email_data.email_action_type,
    url: verifyUrl,
    email: user.email,
  })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[send-email] RESEND_API_KEY not set')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const from = process.env.RESEND_AUTH_FROM_EMAIL
    ?? process.env.RESEND_FROM_EMAIL
    ?? 'The Horace team <auth@gohorace.com>'

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: user.email,
    subject,
    html,
  })

  if (error) {
    console.error('[send-email] Resend error:', error)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 502 })
  }

  return NextResponse.json({})
}
