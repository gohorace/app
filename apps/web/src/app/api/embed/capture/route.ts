/**
 * HOR-284 — POST /api/embed/capture
 *
 * Public, cross-origin endpoint hit by the Doorstep website embed (embed.js,
 * HOR-283) running first-party on the agent's own site. Mirrors
 * /api/inspections/capture, but there is no inspection: the workspace is
 * resolved from the `snippet_key`, the contact is owned by the workspace
 * default agent, and — because the embed is same-origin on the agent's domain
 * — the stitch_contact_from_embed RPC also writes identity_map so the tracker
 * attributes the visitor's later page views to this contact.
 *
 * Security:
 *   - HARD origin-lock: the browser Origin (or Referer host) must be in the
 *     workspace's allowed list (snippet_domains + verified custom domains).
 *     403 otherwise. CORS stays permissive (no credentials) — this
 *     server-side check is the real gate, not the CORS header.
 *   - Honeypot (hp_email) → silent 200, no writes.
 *   - Rate limit (5/min/IP, 200/day/snippet_key), best-effort in-memory.
 *   - Light-touch mobile validation (toE164), no SMS verification.
 *
 * Error model: 400 bad body/field · 403 origin not authorised · 404 unknown
 * snippet_key · 429 rate-limited · 500 unexpected. Honeypot returns 200.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/inspections/phone'
import { sendEmbedCaptureAlert } from '@/lib/notifications/push'
import { isAllowedEmbedOrigin } from '@/lib/doorstep/embed-origin'

// CORS is permissive (no credentials are sent); the hard origin-lock below is
// the real enforcement. Mirrors /api/identity + /api/t.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// ── Rate limiting (in-memory, best-effort — same shape as inspection capture) ─
const IP_LIMIT_PER_MIN = 5
const KEY_LIMIT_PER_DAY = 200
const ONE_MIN_MS = 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

interface Bucket {
  timestamps: number[]
}
const ipBuckets = new Map<string, Bucket>()
const keyBuckets = new Map<string, Bucket>()

function consume(buckets: Map<string, Bucket>, key: string, windowMs: number, limit: number): boolean {
  const now = Date.now()
  const bucket = buckets.get(key) ?? { timestamps: [] }
  const fresh = bucket.timestamps.filter((t) => now - t < windowMs)
  if (fresh.length >= limit) {
    buckets.set(key, { timestamps: fresh })
    return false
  }
  fresh.push(now)
  buckets.set(key, { timestamps: fresh })
  return true
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface EmbedBody {
  snippet_key?: string
  name?: string
  mobile?: string
  anonymous_id?: string
  tracker_session_id?: string
  page_url?: string
  hp_email?: string
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()

  let body: EmbedBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400, headers: CORS_HEADERS })
  }

  // 1. Honeypot — silent 200, no writes.
  if (body.hp_email && body.hp_email.length > 0) {
    return NextResponse.json({ ok: true }, { status: 200, headers: CORS_HEADERS })
  }

  // 2. Rate-limit by IP, then by snippet_key.
  const ip = clientIp(req)
  if (!consume(ipBuckets, ip, ONE_MIN_MS, IP_LIMIT_PER_MIN)) {
    return NextResponse.json({ error: 'Too many submissions, slow down.' }, { status: 429, headers: CORS_HEADERS })
  }

  // 3. Validate inputs.
  const snippetKey = body.snippet_key?.trim() ?? ''
  if (!UUID_RE.test(snippetKey)) {
    return NextResponse.json({ error: 'Invalid embed key.', field: 'snippet_key' }, { status: 400, headers: CORS_HEADERS })
  }
  if (!consume(keyBuckets, snippetKey, ONE_DAY_MS, KEY_LIMIT_PER_DAY)) {
    return NextResponse.json({ error: 'Daily submission cap reached.' }, { status: 429, headers: CORS_HEADERS })
  }

  const name = body.name?.trim() ?? ''
  if (name.length < 1 || name.length > 120) {
    return NextResponse.json({ error: 'Please enter your name.', field: 'name' }, { status: 400, headers: CORS_HEADERS })
  }

  const { e164, isValid } = toE164(body.mobile)
  if (!isValid || !e164) {
    return NextResponse.json(
      { error: 'That mobile number doesn’t look right.', field: 'mobile' },
      { status: 400, headers: CORS_HEADERS },
    )
  }

  const anonymousId = body.anonymous_id?.trim() ?? ''
  const trackerSessionId = body.tracker_session_id?.trim() ?? ''
  if (!anonymousId || !trackerSessionId) {
    return NextResponse.json(
      { error: 'Missing device identifier — please refresh the page.' },
      { status: 400, headers: CORS_HEADERS },
    )
  }

  const userAgent = req.headers.get('user-agent') ?? null
  const pageUrl = typeof body.page_url === 'string' ? body.page_url.slice(0, 2048) : null

  const admin = createAdminClient()

  // 4. Resolve workspace by snippet_key + collect its allowed origins.
  const { data: wsRow, error: wsErr } = await admin
    .from('workspaces')
    .select('id')
    .eq('snippet_key', snippetKey)
    .maybeSingle()
  if (wsErr) {
    console.error('[embed] workspace lookup error:', wsErr)
    return NextResponse.json({ error: 'Could not resolve embed.' }, { status: 500, headers: CORS_HEADERS })
  }
  if (!wsRow) {
    return NextResponse.json({ error: 'Unknown embed.' }, { status: 404, headers: CORS_HEADERS })
  }
  const workspaceId = wsRow.id as string

  const { data: settingsRow } = await admin
    .from('workspace_settings')
    .select('snippet_domains')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const { data: domainRows } = await admin
    // workspace_custom_domains (HOR-204) may lag database.types.ts — cast.
    .from('workspace_custom_domains' as never)
    .select('hostname')
    .eq('workspace_id', workspaceId)
    .eq('status', 'verified')
  const allowed: string[] = [
    ...((settingsRow?.snippet_domains as string[] | undefined) ?? []),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(((domainRows as any[]) ?? []).map((d) => d.hostname as string)),
  ]

  // 5. HARD origin-lock — the real gate for the unbranded snippet.
  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  if (!isAllowedEmbedOrigin(origin, referer, allowed)) {
    console.warn(
      JSON.stringify({
        doorstep_event: 'embed_origin_rejected',
        workspace_id: workspaceId,
        origin,
        referer,
        ts: new Date().toISOString(),
      }),
    )
    return NextResponse.json(
      { error: 'This embed is not authorised for this site.' },
      { status: 403, headers: CORS_HEADERS },
    )
  }

  // 6. Upsert session — gives the RPC's events insert a valid FK target.
  const sessionId = await upsertSession(admin, workspaceId, anonymousId, trackerSessionId, userAgent)
  if (!sessionId) {
    return NextResponse.json({ error: 'Could not record session.' }, { status: 500, headers: CORS_HEADERS })
  }
  const t1 = Date.now()

  // 7. Stitch RPC — contact + event + device + identity_map in one transaction.
  let result: {
    contact_id: string
    agent_id: string
    workspace_id: string
    contact_name: string
    is_new_contact: boolean
  } | null
  try {
    const { data, error } = await admin.rpc(
      // RPC is brand new (HOR-284) — not yet in database.types.ts.
      'stitch_contact_from_embed' as never,
      {
        p_snippet_key: snippetKey,
        p_phone: e164,
        p_name: name,
        p_anonymous_id: anonymousId,
        p_session_id: sessionId,
        p_page_url: pageUrl,
        p_user_agent: userAgent,
      } as never,
    )
    if (error) throw error
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = (Array.isArray(data) ? data[0] : data) as any
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : null
    if (code === 'P0002') {
      return NextResponse.json({ error: 'Unknown embed.' }, { status: 404, headers: CORS_HEADERS })
    }
    console.error('[embed] stitch RPC failed:', err)
    return NextResponse.json({ error: 'Could not save your details.' }, { status: 500, headers: CORS_HEADERS })
  }
  const t2 = Date.now()

  // 8. Push — deduped 30min in the dispatcher, so safe to fire every submit.
  if (result?.agent_id && result?.contact_id) {
    try {
      await sendEmbedCaptureAlert(result.agent_id, result.contact_id)
    } catch (err) {
      console.error('[embed] push dispatch failed:', err)
    }
  }
  const t3 = Date.now()

  // 9. Telemetry — structured JSON for Vercel log search (HOR-158 style).
  console.log(
    JSON.stringify({
      doorstep_event: 'embed_capture_ok',
      workspace_id: workspaceId,
      contact_id: result?.contact_id,
      agent_id: result?.agent_id,
      is_new_contact: result?.is_new_contact,
      session_ms: t1 - t0,
      rpc_ms: t2 - t1,
      push_ms: t3 - t2,
      total_ms: t3 - t0,
      ts: new Date().toISOString(),
    }),
  )

  return NextResponse.json({ ok: true }, { status: 200, headers: CORS_HEADERS })
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function upsertSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  workspaceId: string,
  anonymousId: string,
  trackerSessionId: string,
  userAgent: string | null,
): Promise<string | null> {
  const { data, error } = await admin
    .from('sessions')
    .upsert(
      {
        workspace_id: workspaceId,
        anonymous_id: anonymousId,
        tracker_session_id: trackerSessionId,
        last_seen_at: new Date().toISOString(),
        user_agent: userAgent ?? undefined,
      },
      { onConflict: 'workspace_id,tracker_session_id', ignoreDuplicates: false },
    )
    .select('id')
    .single()

  if (error || !data) {
    console.error('[embed] session upsert error:', error)
    return null
  }
  return data.id as string
}
