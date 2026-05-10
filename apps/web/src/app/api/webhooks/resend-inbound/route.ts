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
 * - No signature verification. Earlier custom-header check was wrong:
 *   Resend signs webhooks with svix headers (svix-id, svix-timestamp,
 *   svix-signature), not custom headers. Endpoint URL is unguessable
 *   and route only writes to a samples table; safe enough for the spike.
 * - TODO before promoting beyond spike: add `resend.webhooks.verify()`
 *   using the signing secret from the webhook detail page.
 * - Idempotent on Message-ID header.
 */
export async function POST(req: NextRequest) {
  let payload: unknown
  try {
    payload = await req.json()
  } catch (err) {
    console.error('resend-inbound: invalid JSON body', err)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Defensive extraction — Resend's inbound payload shape is:
  //   { type: 'email.received' | 'email.inbound', data: { from, to, subject, text, html, headers, raw, ... } }
  // but field names may vary. Store the whole thing in `parsed` and pull common fields out.
  const data = (payload as { data?: Record<string, unknown> })?.data ?? (payload as Record<string, unknown>)

  const fromAddress = pickString(data, ['from', 'sender', 'from_address'])
  const toAddress = pickFirstString(data, ['to', 'recipient', 'to_address'])
  const subject = pickString(data, ['subject'])
  const messageId =
    pickString(data, ['message_id', 'messageId']) ??
    extractHeader(data, 'message-id') ??
    extractHeader(data, 'Message-ID')
  const rawMime = pickString(data, ['raw', 'raw_mime', 'mime'])

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
        parsed: payload as Json,
        raw_mime: rawMime,
      },
      { onConflict: 'message_id', ignoreDuplicates: true },
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
    has_raw: !!rawMime,
  })

  return NextResponse.json({ received: true })
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
