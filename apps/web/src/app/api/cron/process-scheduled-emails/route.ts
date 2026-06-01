/**
 * GET /api/cron/process-scheduled-emails
 *
 * One tick of the scheduled tracked-email worker (HOR-357). Invoked every
 * minute by a Supabase pg_cron schedule (migration 20260601000120) via
 * pg_net.http_get, NOT by Vercel cron (Hobby caps at 2 daily-only crons —
 * see memory note horace_cron_pg_cron.md).
 *
 * Each tick:
 *   1. Auth via CRON_SECRET bearer.
 *   2. Select email_sends rows where status='scheduled' AND scheduled_at<=now()
 *      (oldest first, capped per tick).
 *   3. dispatchScheduledRow() per row — claims it (scheduled→queued, so a
 *      double-tick can't double-send), re-checks the recipient guard, then
 *      routes through the shared dispatchSend (same path as an immediate send).
 *   4. Return JSON counts for observability.
 *
 * Idle ticks (no due rows) return immediately — the common case. A per-row
 * failure is logged and the row is left in its failed/queued state; it does
 * not abort the rest of the batch.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  dispatchScheduledRow,
  type DueScheduledRow,
} from '@/lib/email/send'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Cap rows per tick so a backlog can't blow the 60s budget. The next tick
// (one minute later) drains the rest.
const MAX_PER_TICK = 25

export async function GET(request: NextRequest) {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // ── 2. Find due rows ───────────────────────────────────────────────────────
  const nowIso = new Date().toISOString()
  // email_sends + scheduled_at aren't in the generated Database type yet
  // (regen deferred — see memory). Cast like the other email_sends writers.
  const { data: dueRows, error: selectErr } = await (admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('email_sends' as any)
    .select(
      'id, agent_id, workspace_id, contact_id, to_email, subject, body_html, body_text, tracked, source',
    )
    .eq('status', 'scheduled')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(MAX_PER_TICK))

  if (selectErr) {
    console.error('[process-scheduled-emails] select error', selectErr)
    return NextResponse.json({ error: selectErr.message }, { status: 500 })
  }

  const rows = (dueRows ?? []) as DueScheduledRow[]
  if (rows.length === 0) {
    return NextResponse.json({ idle: true })
  }

  // ── 3. Dispatch each due row ───────────────────────────────────────────────
  let sent = 0
  let failed = 0
  const failures: Array<{ id: string; error: string }> = []

  for (const row of rows) {
    try {
      await dispatchScheduledRow(admin, row)
      sent++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ id: row.id, error: message })
      console.error('[process-scheduled-emails] dispatch failed', row.id, message)
    }
  }

  return NextResponse.json({ due: rows.length, sent, failed, failures })
}
