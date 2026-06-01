import { NextRequest, NextResponse } from 'next/server'
import { Webhook, WebhookVerificationError } from 'svix'
import { createAdminClient } from '@/lib/supabase/admin'
import { processInboundEmail } from '@/lib/inbound/router'
import type { ResendFetchedEmail } from '@/lib/inbound/types'

export const runtime = 'nodejs'

/**
 * POST /api/webhooks/resend-inbound
 *
 * Resend inbound webhook for portal.gohorace.com.
 *
 * Request flow:
 * 1. Verify svix signature (svix-id / svix-timestamp / svix-signature)
 *    against the signing secret from Resend's webhook detail page.
 * 2. Parse JSON payload, extract metadata.
 * 3. Fetch full body via Resend's Received Emails API.
 * 4. Delegate to processInboundEmail (router) for capture, parsing,
 *    contact + enquiry writes.
 *
 * Idempotent on Message-ID; replays update existing rows.
 */
export async function POST(req: NextRequest) {
  // Read raw body BEFORE parsing — svix verifies bytes exactly.
  const rawBody = await req.text()

  // Verify the signature unless explicitly disabled via env (for local dev).
  const verifyResult = verifySignature(rawBody, req.headers)
  if (!verifyResult.ok) {
    console.warn('resend-inbound: signature verification failed', verifyResult)
    return NextResponse.json({ error: verifyResult.error }, { status: verifyResult.status })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch (err) {
    console.error('resend-inbound: invalid JSON body', err)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const data = (payload as { data?: Record<string, unknown> })?.data ?? (payload as Record<string, unknown>)

  const fromAddress = pickString(data, ['from', 'sender', 'from_address'])
  const toAddress = pickFirstString(data, ['to', 'recipient', 'to_address'])
  const subject = pickString(data, ['subject'])
  const messageId =
    pickString(data, ['message_id', 'messageId']) ??
    extractHeader(data, 'message-id') ??
    extractHeader(data, 'Message-ID')
  const emailId = pickString(data, ['email_id', 'emailId', 'id'])
  const sourcePortal = guessSourcePortal(fromAddress)

  const fetchedEmail = await fetchReceivedEmail(emailId)

  const admin = createAdminClient()
  const outcome = await processInboundEmail(admin, {
    webhookPayload: payload,
    fetchedEmail,
    meta: { fromAddress, toAddress, subject, messageId, sourcePortal },
  })

  console.log('resend-inbound:', {
    outcome: outcome.kind,
    from: fromAddress,
    to: toAddress,
    subject,
    source_portal: sourcePortal,
    has_fetched_body: !!fetchedEmail,
    ...outcome,
  })

  if (outcome.kind === 'error') {
    return NextResponse.json({ error: outcome.error }, { status: 500 })
  }
  // The address matched a real agent but the body wasn't fetched yet (transient
  // Resend API timeout/4xx/5xx). Ask Resend to retry the whole capture — the
  // pipeline is idempotent on Message-ID — rather than ack'ing 2xx and silently
  // dropping the enquiry (no body would ever load). `no_match` stays 2xx: that's
  // a permanent "not our address" and must NOT be retried.
  if (outcome.kind === 'pending_body') {
    return NextResponse.json(
      { error: 'email body not yet available — retry', outcome: outcome.kind },
      { status: 503 },
    )
  }
  return NextResponse.json({ received: true, outcome: outcome.kind })
}

/**
 * Verify the inbound webhook's svix signature.
 *
 * Resend signs every webhook with svix headers — verifying ensures the
 * request actually came from Resend, not a spoofer who learned the URL.
 *
 * Reads the secret from `RESEND_INBOUND_SIGNING_SECRET` (preferred),
 * falling back to `RESEND_INBOUND_WEBHOOK_SECRET` for back-compat with
 * the spike's earlier env-var name.
 */
function verifySignature(
  rawBody: string,
  headers: Headers,
):
  | { ok: true }
  | { ok: false; status: number; error: string } {
  const secret =
    process.env.RESEND_INBOUND_SIGNING_SECRET ??
    process.env.RESEND_INBOUND_WEBHOOK_SECRET

  if (!secret) {
    // Fail closed — better to drop a webhook than to silently accept
    // spoofed POSTs. If you need to bypass for local dev, set the env
    // explicitly to the dev signing secret.
    return { ok: false, status: 500, error: 'webhook signing secret not configured' }
  }

  const svixHeaders = {
    'svix-id': headers.get('svix-id') ?? '',
    'svix-timestamp': headers.get('svix-timestamp') ?? '',
    'svix-signature': headers.get('svix-signature') ?? '',
  }

  if (!svixHeaders['svix-id'] || !svixHeaders['svix-timestamp'] || !svixHeaders['svix-signature']) {
    return { ok: false, status: 401, error: 'missing svix headers' }
  }

  try {
    const wh = new Webhook(secret)
    wh.verify(rawBody, svixHeaders)
    return { ok: true }
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return { ok: false, status: 401, error: 'invalid signature' }
    }
    return { ok: false, status: 401, error: 'verification failed' }
  }
}

async function fetchReceivedEmail(emailId: string | null): Promise<ResendFetchedEmail | null> {
  const resendKey = process.env.RESEND_RECEIVING_API_KEY ?? process.env.RESEND_API_KEY
  if (!emailId) {
    console.warn('resend-inbound: no email_id in payload — skipping body fetch')
    return null
  }
  if (!resendKey) {
    console.warn('resend-inbound: no Resend API key set — skipping body fetch')
    return null
  }

  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${resendKey}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn(`resend-inbound: body fetch returned ${res.status}: ${body.slice(0, 200)}`)
      return null
    }
    return (await res.json()) as ResendFetchedEmail
  } catch (err) {
    console.error('resend-inbound: body fetch failed', err)
    return null
  }
}

function pickString(obj: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!obj) return null
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

function pickFirstString(obj: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!obj) return null
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 0) return v
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0] as string
  }
  return null
}

function extractHeader(data: Record<string, unknown> | undefined, name: string): string | null {
  if (!data) return null
  const headers = data.headers
  if (!Array.isArray(headers)) return null
  const lower = name.toLowerCase()
  for (const h of headers) {
    if (!h || typeof h !== 'object') continue
    const obj = h as Record<string, unknown>
    const headerName = typeof obj.name === 'string' ? obj.name.toLowerCase() : null
    if (headerName === lower && typeof obj.value === 'string') return obj.value
  }
  return null
}

function guessSourcePortal(from: string | null): string | null {
  if (!from) return null
  const lower = from.toLowerCase()
  if (lower.includes('rea-mail.com.au') || lower.includes('realestate.com.au')) return 'rea'
  if (lower.includes('domain.com.au')) return 'domain'
  return 'other'
}
