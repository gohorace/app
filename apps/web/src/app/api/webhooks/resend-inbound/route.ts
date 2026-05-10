import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database.types'

export const runtime = 'nodejs'

/**
 * POST /api/webhooks/resend-inbound
 *
 * Resend inbound webhook for portal.horace.app. Captures raw MIME +
 * parsed payload to inbound_email_samples for the HOR-28 parsing spike.
 *
 * SPIKE NOTES
 * - No business logic. Logs only.
 * - No signature verification (spike). TODO: add `resend.webhooks.verify()`
 *   before this code path goes near production.
 * - Resend's webhook is metadata-only by design. We do a follow-up
 *   GET /emails/receiving/{id} to fetch text/html/headers and store
 *   both webhook + fetched body in `parsed` as { webhook, fetched }.
 * - Upsert merges on Message-ID so replaying the webhook (e.g. via
 *   Resend's Replay button) updates the existing row with newly
 *   fetched body content.
 */
export async function POST(req: NextRequest) {
  let payload: unknown
  try {
    payload = await req.json()
  } catch (err) {
    console.error('resend-inbound: invalid JSON body', err)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Webhook payload shape: { type: 'email.received', data: { from, to, subject, email_id, message_id, ... } }
  // The `data.email_id` is Resend's internal ID, used to fetch the body separately.
  const data = (payload as { data?: Record<string, unknown> })?.data ?? (payload as Record<string, unknown>)

  const fromAddress = pickString(data, ['from', 'sender', 'from_address'])
  const toAddress = pickFirstString(data, ['to', 'recipient', 'to_address'])
  const subject = pickString(data, ['subject'])
  const messageId =
    pickString(data, ['message_id', 'messageId']) ??
    extractHeader(data, 'message-id') ??
    extractHeader(data, 'Message-ID')
  const emailId = pickString(data, ['email_id', 'emailId', 'id'])

  // Fetch full body (text/html/headers/reply_to) via Resend's Received Emails API.
  // Webhook is metadata-only by design — body must be fetched separately.
  // https://resend.com/docs/api-reference/emails/retrieve-received-email
  const fetchedEmail = await fetchReceivedEmail(emailId)

  const sourcePortal = guessSourcePortal(fromAddress)

  const admin = createAdminClient()
  const { error } = await admin
    .from('inbound_email_samples')
    .upsert(
      {
        to_address: toAddress,
        from_address: fromAddress,
        subject,
        message_id: messageId,
        source_portal: sourcePortal,
        parsed: { webhook: payload, fetched: fetchedEmail } as Json,
        raw_mime: null,
      },
      { onConflict: 'message_id' },
    )

  if (error) {
    console.error('resend-inbound: insert failed', error)
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }

  console.log('resend-inbound: captured', {
    from: fromAddress,
    to: toAddress,
    subject,
    source_portal: sourcePortal,
    fetched_body: !!fetchedEmail,
  })

  return NextResponse.json({ received: true })
}

/**
 * Fetch a received email's full content from Resend.
 * Returns null on missing key / missing id / fetch failure — webhook
 * still captures metadata in that case.
 */
async function fetchReceivedEmail(emailId: string | null): Promise<Json> {
  // Prefer a dedicated receiving-scoped key; fall back to the main API key.
  // Keeps RESEND_API_KEY as least-privilege (send-only) for outbound.
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
    return (await res.json()) as Json
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
