/**
 * GET /api/cron/webhook-deliver
 *
 * One tick of the webhook delivery worker (HOR-323). Driven every minute by a
 * Supabase pg_cron schedule via pg_net (same pattern as the core-markets
 * worker), NOT Vercel cron. Auth via the shared CRON_SECRET bearer.
 *
 * Each tick claims a batch of due deliveries (claim_webhook_deliveries leases
 * them: status→sending, attempts++), then for each: builds + snapshots the
 * public payload on first attempt, signs it (HMAC-SHA256), POSTs with a 10s
 * timeout, and writes back the result — delivered, rescheduled (backoff
 * 1m/5m/30m/2h/12h), or exhausted (which flags the endpoint failing).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createApiV1Db } from '@/lib/api-v1/db'
import {
  mapContact,
  mapRelationship,
  type ContactRow,
  type EngagementRow,
} from '@/lib/api-v1/mappers'
import { webhookSignatureHeader, nextBackoffMs } from '@/lib/api-v1/webhooks'
import type { SupabaseClient } from '@supabase/supabase-js'

export const maxDuration = 60

const CLAIM_LIMIT = 50
const DELIVERY_TIMEOUT_MS = 10_000

const CONTACT_COLUMNS =
  'id, email, phone, first_name, last_name, source, ingestion_method, external_ids, created_at, updated_at'
const ENGAGEMENT_COLUMNS =
  'id, contact_id, property_id, type, first_engaged_at, last_engaged_at, engagement_count'

interface DeliveryRow {
  id: string
  workspace_id: string
  endpoint_id: string
  event_id: string
  event_type: string
  resource_kind: 'contact' | 'relationship'
  resource_id: string
  payload: Record<string, unknown> | null
  attempts: number
  created_at: string
}

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createApiV1Db()
  const { data, error } = await db.rpc('claim_webhook_deliveries', { p_limit: CLAIM_LIMIT })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as DeliveryRow[]
  if (rows.length === 0) return NextResponse.json({ idle: true })

  let delivered = 0
  let failed = 0
  for (const row of rows) {
    const ok = await deliverOne(db, row)
    if (ok) delivered++
    else failed++
  }

  return NextResponse.json({ processed: rows.length, delivered, failed })
}

async function deliverOne(db: SupabaseClient, row: DeliveryRow): Promise<boolean> {
  // 1. Payload — reuse the snapshot, or build it from the live resource.
  let payload = row.payload
  if (!payload) {
    const built = await buildPayload(db, row)
    if (!built) {
      await fail(db, row, null, 'Resource no longer exists.', true)
      return false
    }
    payload = built
  }

  // 2. Endpoint + signing secret.
  const { data: endpoint } = await db
    .from('webhook_endpoints')
    .select('id, url, secret_id, status')
    .eq('id', row.endpoint_id)
    .maybeSingle()
  if (!endpoint || endpoint.status === 'disabled' || !endpoint.url) {
    await fail(db, row, null, 'Endpoint is gone or disabled.', true)
    return false
  }
  const { data: secret } = await db.rpc('get_integration_secret', {
    p_secret_id: endpoint.secret_id,
  })
  if (!secret || typeof secret !== 'string') {
    await fail(db, row, null, 'Signing secret is missing.', true)
    return false
  }

  // 3. Sign + POST (10s timeout).
  const body = JSON.stringify(payload)
  const signature = webhookSignatureHeader(secret, body)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)
  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Horace-Signature': signature,
        'User-Agent': 'Horace-Webhooks/1',
      },
      body,
      signal: controller.signal,
    })
    if (res.status >= 200 && res.status < 300) {
      await succeed(db, row, payload, res.status)
      return true
    }
    await fail(db, row, res.status, `Endpoint returned ${res.status}.`, false, payload)
    return false
  } catch (e) {
    const message =
      e instanceof Error && e.name === 'AbortError' ? 'Timed out after 10s.' : 'Delivery failed.'
    await fail(db, row, null, message, false, payload)
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function buildPayload(
  db: SupabaseClient,
  row: DeliveryRow,
): Promise<Record<string, unknown> | null> {
  let resource: unknown = null
  if (row.resource_kind === 'contact') {
    const { data } = await db
      .from('contacts')
      .select(CONTACT_COLUMNS)
      .eq('id', row.resource_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (data) resource = mapContact(data as ContactRow)
  } else {
    const { data } = await db
      .from('contact_property_engagement')
      .select(ENGAGEMENT_COLUMNS)
      .eq('id', row.resource_id)
      .maybeSingle()
    if (data) resource = mapRelationship(data as EngagementRow)
  }
  if (!resource) return null
  return { id: row.event_id, type: row.event_type, created_at: row.created_at, data: resource }
}

async function succeed(
  db: SupabaseClient,
  row: DeliveryRow,
  payload: Record<string, unknown>,
  status: number,
) {
  await db
    .from('webhook_deliveries')
    .update({ status: 'delivered', response_status: status, last_error: null, payload })
    .eq('id', row.id)
  // A success clears a failing endpoint and stamps last_delivery_at.
  await db
    .from('webhook_endpoints')
    .update({ last_delivery_at: new Date().toISOString(), last_error: null })
    .eq('id', row.endpoint_id)
  await db
    .from('webhook_endpoints')
    .update({ status: 'active' })
    .eq('id', row.endpoint_id)
    .eq('status', 'failing')
}

async function fail(
  db: SupabaseClient,
  row: DeliveryRow,
  responseStatus: number | null,
  message: string,
  terminal: boolean,
  payload?: Record<string, unknown>,
) {
  const delayMs = terminal ? null : nextBackoffMs(row.attempts)
  const exhausted = delayMs === null

  await db
    .from('webhook_deliveries')
    .update({
      status: exhausted ? 'exhausted' : 'pending',
      response_status: responseStatus,
      last_error: message,
      next_attempt_at: exhausted ? row.created_at : new Date(Date.now() + delayMs).toISOString(),
      ...(payload ? { payload } : {}),
    })
    .eq('id', row.id)

  if (exhausted) {
    await db
      .from('webhook_endpoints')
      .update({ status: 'failing', last_error: message })
      .eq('id', row.endpoint_id)
      .neq('status', 'disabled')
  }
}
