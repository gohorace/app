/**
 * HOR-152 — POST /api/inspections/capture
 *
 * Public endpoint hit by the /i/<token> capture form (HOR-151).
 * Performs every write needed when a prospect signs in to an open home:
 *
 *   1. Honeypot guard (silent 200 on tripped hp_email — bots don't get probe signal)
 *   2. Rate limit (5/min/IP, 100/day/token) — best-effort, in-memory
 *   3. Validate inputs (name length, mobile→E.164, token well-formed)
 *   4. Resolve token to workspace_id (small indexed lookup)
 *   5. Upsert sessions row → get sessions.id for the events FK
 *   6. Call stitch_contact_from_inspection RPC (HOR-147) — does contact +
 *      device + event + scan transactionally, returns is_new_scan
 *   7. Fire sendInspectionCaptureAlert (HOR-153) on a fresh scan
 *   8. Respond 200 — the form swaps to its "Thanks…" success state
 *
 * Auth: none. This is the public form. The 8-char token is the only
 * gate — see HOR-146 for why that's enumeration-resistant enough.
 *
 * Error model:
 *   - 400  malformed body / bad phone / bad token shape / honeypot tripped
 *           (the honeypot returns 200 with no DB writes — see comments)
 *   - 404  token not found / soft-deleted / cancelled (RPC raises P0002)
 *   - 429  rate-limited
 *   - 500  unexpected
 *
 * Sub-5-second submit→push latency is the headline non-functional bar
 * (per brief). The RPC is one round-trip; push is dispatched on the
 * response path before we return. If push latency creeps later, swap
 * the await for waitUntil() / after().
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/inspections/phone'
import { isWellFormed } from '@/lib/inspections/tokens'
import { captureScan } from '@/lib/inspections/repo'
import { sendInspectionCaptureAlert } from '@/lib/notifications/push'

// ── Rate limiting (in-memory, best-effort) ───────────────────────────────────
//
// Per-instance buckets — Vercel can spin up multiple isolates, so this is
// soft enforcement. The 8-char base62 token does the heavy lifting against
// enumeration; this just keeps a single instance from being trivially
// flooded between Cloudflare WAF rules and the real DB. Move to Upstash if
// real abuse appears.

const IP_LIMIT_PER_MIN = 5
const TOKEN_LIMIT_PER_DAY = 100
const ONE_MIN_MS = 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

interface Bucket {
  timestamps: number[]
}

const ipBuckets = new Map<string, Bucket>()
const tokenBuckets = new Map<string, Bucket>()

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

// ── Request body ──────────────────────────────────────────────────────────────

interface CaptureBody {
  token?: string
  name?: string
  mobile?: string
  anonymous_id?: string
  tracker_session_id?: string
  hp_email?: string
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const t0 = Date.now()

  let body: CaptureBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  // 1. Honeypot — return 200 so bots can't tell they were filtered, but
  //    write nothing. (Mirroring the real success surface keeps probes
  //    indistinguishable from accepted submits.)
  if (body.hp_email && body.hp_email.length > 0) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // 2. Rate-limit by IP, then by token. IP cap is the spam shield;
  //    token cap protects a single inspection from being scan-bombed.
  const ip = clientIp(req)
  if (!consume(ipBuckets, ip, ONE_MIN_MS, IP_LIMIT_PER_MIN)) {
    return NextResponse.json({ error: 'Too many submissions, slow down.' }, { status: 429 })
  }
  if (body.token && !consume(tokenBuckets, body.token, ONE_DAY_MS, TOKEN_LIMIT_PER_DAY)) {
    return NextResponse.json({ error: 'This open home has reached its daily sign-in cap.' }, { status: 429 })
  }

  // 3. Validate inputs.
  const token = body.token?.trim() ?? ''
  if (!isWellFormed(token)) {
    return NextResponse.json({ error: 'Invalid sign-in link.', field: 'token' }, { status: 400 })
  }

  const name = body.name?.trim() ?? ''
  if (name.length < 1 || name.length > 120) {
    return NextResponse.json({ error: 'Please enter your name.', field: 'name' }, { status: 400 })
  }

  const { e164, isValid } = toE164(body.mobile)
  if (!isValid || !e164) {
    return NextResponse.json(
      { error: 'That mobile number doesn’t look right.', field: 'mobile' },
      { status: 400 },
    )
  }

  const anonymousId = body.anonymous_id?.trim() ?? ''
  const trackerSessionId = body.tracker_session_id?.trim() ?? ''
  if (!anonymousId || !trackerSessionId) {
    return NextResponse.json(
      { error: 'Missing device identifier — please refresh the page.' },
      { status: 400 },
    )
  }

  const userAgent = req.headers.get('user-agent') ?? null

  const admin = createAdminClient()

  // 4. Resolve token → inspection.workspace_id. The RPC validates the
  //    token again inside the transaction; this pre-lookup just exists
  //    so we have a workspace_id to upsert the session against (sessions
  //    table has FK + UNIQUE on (workspace_id, tracker_session_id)).
  const { data: inspectionRow, error: inspectionErr } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('inspections' as never)
    .select('workspace_id, status, deleted_at, property_id')
    .eq('token', token)
    .maybeSingle()

  if (inspectionErr) {
    console.error('[capture] inspection lookup error:', inspectionErr)
    return NextResponse.json({ error: 'Could not resolve sign-in link.' }, { status: 500 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inspection = inspectionRow as any
  if (!inspection || inspection.deleted_at || inspection.status === 'cancelled') {
    return NextResponse.json({ error: 'This open home is not accepting sign-ins.' }, { status: 404 })
  }
  const workspaceId: string = inspection.workspace_id

  // 5. Upsert session — give the RPC's events insert a valid FK target.
  const sessionId = await upsertSession(admin, workspaceId, anonymousId, trackerSessionId, userAgent)
  if (!sessionId) {
    return NextResponse.json({ error: 'Could not record session.' }, { status: 500 })
  }
  const t1 = Date.now()

  // 6. Call the stitch RPC — single transaction for contact + device +
  //    event + scan.
  let result: Awaited<ReturnType<typeof captureScan>>
  try {
    result = await captureScan(admin, {
      token,
      phone: e164,
      name,
      anonymousId,
      sessionId,
      userAgent,
    })
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code: string }).code
        : null
    if (code === 'P0002') {
      return NextResponse.json({ error: 'This open home is not accepting sign-ins.' }, { status: 404 })
    }
    console.error('[capture] stitch RPC failed:', err)
    return NextResponse.json({ error: 'Could not complete sign-in.' }, { status: 500 })
  }
  const t2 = Date.now()

  // 7. Push (only on a fresh scan — repeat submits don't re-buzz).
  if (result.is_new_scan) {
    try {
      await sendInspectionCaptureAlert(
        result.agent_id,
        result.contact_id,
        result.contact_name,
        result.address,
        // HOR-350: tag the moment with the inspection's property so the
        // property page can link straight back to it.
        inspection.property_id ?? null,
      )
    } catch (err) {
      // Don't fail the prospect's submit if push delivery hiccups.
      console.error('[capture] push dispatch failed:', err)
    }
  }
  const t3 = Date.now()

  // 8. Done. Latency telemetry — structured JSON so HOR-158's metrics
  // can be computed from Vercel log search (filter on doorstep_event).
  console.log(
    JSON.stringify({
      doorstep_event: 'inspection_capture_ok',
      inspection_token: token,
      contact_id: result.contact_id,
      agent_id: result.agent_id,
      is_new_scan: result.is_new_scan,
      session_ms: t1 - t0,
      rpc_ms: t2 - t1,
      push_ms: t3 - t2,
      total_ms: t3 - t0,
      ts: new Date().toISOString(),
    }),
  )

  return NextResponse.json({ ok: true }, { status: 200 })
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
    console.error('[capture] session upsert error:', error)
    return null
  }
  return data.id as string
}
