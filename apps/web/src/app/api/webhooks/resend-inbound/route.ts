import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processInboundEmail } from '@/lib/inbound/router'
import type { ResendFetchedEmail } from '@/lib/inbound/types'

export const runtime = 'nodejs'

/**
 * POST /api/webhooks/resend-inbound
 *
 * Resend inbound webhook for portal.gohorace.com. Captures emails into
 * `inbound_emails`, fetches the body via Resend's Received Emails API,
 * dispatches to the right parser, and writes structured `enquiries`
 * + `contacts` records.
 *
 * Notes:
 * - No signature verification yet (HOR-63 Phase 1d). Endpoint URL is
 *   unguessable; route writes only to the inbound tables. Add
 *   `resend.webhooks.verify()` before going beyond this phase.
 * - Idempotent on Message-ID: replays update the existing inbound_emails
 *   row and re-write the matching enquiry.
 */
export async function POST(req: NextRequest) {
  let payload: unknown
  try {
    payload = await req.json()
  } catch (err) {
    console.error('resend-inbound: invalid JSON body', err)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Resend's payload shape: { type: 'email.received', data: { from, to, subject, email_id, message_id, ... } }
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

  // Fetch full body via Resend's Received Emails API (webhook is metadata-only).
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

  // Always 200 if we successfully captured the row — Resend retries on non-2xx.
  // Errors during capture itself (DB write failure) return 500 so they retry.
  if (outcome.kind === 'error') {
    return NextResponse.json({ error: outcome.error }, { status: 500 })
  }
  return NextResponse.json({ received: true, outcome: outcome.kind })
}

/**
 * Fetch a received email's full content from Resend.
 * Returns null on missing key / missing id / fetch failure — the router
 * still captures metadata in that case.
 */
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
