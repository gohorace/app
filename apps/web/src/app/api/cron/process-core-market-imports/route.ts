/**
 * GET /api/cron/process-core-market-imports
 *
 * One tick of the Core Markets import worker. Invoked every minute by
 * a Supabase pg_cron schedule (HOR-193 migration 20260517000011) via
 * pg_net.http_post, NOT by Vercel cron (Hobby caps at 2 daily-only
 * crons — see memory note horace_cron_pg_cron.md).
 *
 * Each tick:
 *   1. Auth via CRON_SECRET bearer.
 *   2. claim_core_market_import RPC — at most one job, FOR UPDATE
 *      SKIP LOCKED. Eligible: pending OR running-with-stale-heartbeat.
 *   3. import_core_market_batch RPC — bulk-INSERT a 2k-row page from
 *      gnaf.address_principal into properties + run the auto-match
 *      pass. Returns (done, batch_cursor, imported, matched).
 *   4. If done: dispatch the import-complete notification.
 *   5. Return JSON status for observability.
 *
 * Vercel Hobby caps function duration at 60s. A 2k-row batch sits
 * comfortably under that. If the import has more rows, the next
 * pg_cron tick picks up where this left off (batch_cursor is
 * persisted by the SQL function).
 *
 * Idle ticks (no eligible jobs) return immediately — they're the
 * common case.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendImportCompleteNotification } from '@/lib/notifications/core-markets'

// Vercel function config — we want this to be allowed to run up to
// 60s on Hobby. The 2k batch finishes well inside that, but the
// margin protects against a slow query plan on a cold connection.
export const maxDuration = 60

const BATCH_SIZE = 2000

interface ClaimedImport {
  id:             string
  core_market_id: string
  agent_id:       string
  locality_pid:   string
}

interface BatchResult {
  done:         boolean
  batch_cursor: string | null
  imported:     number
  matched:      number
}

export async function GET(request: NextRequest) {
  // ── 1. Auth ──────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // ── 2. Claim a job ───────────────────────────────────────────────
  // The RPC returns SETOF core_market_imports; supabase-js surfaces
  // this as an array. Take the first (and only) row if present.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimedRows, error: claimError } = await admin.rpc('claim_core_market_import' as any)

  if (claimError) {
    console.error('[process-core-market-imports] claim error', claimError)
    return NextResponse.json({ error: claimError.message }, { status: 500 })
  }

  const claimed = Array.isArray(claimedRows) && claimedRows.length > 0
    ? (claimedRows[0] as ClaimedImport)
    : null

  if (!claimed) {
    // Idle tick — the most common case.
    return NextResponse.json({ idle: true })
  }

  // ── 3. Process one batch ─────────────────────────────────────────
  let result: BatchResult
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await admin.rpc('import_core_market_batch' as any, {
      p_import_id:  claimed.id,
      p_batch_size: BATCH_SIZE,
    })
    if (error) throw error

    // import_core_market_batch is RETURNS TABLE (one row); supabase-js
    // returns it as a single-element array.
    const row = Array.isArray(data) && data.length > 0
      ? (data[0] as BatchResult)
      : null
    if (!row) throw new Error('batch RPC returned empty result')

    result = row
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[process-core-market-imports] batch error', err)
    await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('core_market_imports' as any)
      .update({ status: 'error', error_message: message })
      .eq('id', claimed.id)
    return NextResponse.json({
      import_id: claimed.id,
      error:     message,
    }, { status: 500 })
  }

  // ── 4. Dispatch notification on completion ───────────────────────
  if (result.done) {
    try {
      // Look up the locality for the notification copy.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: market } = await admin
        .from('core_markets' as any)
        .select('locality_name, state_abbrev')
        .eq('id', claimed.core_market_id)
        .maybeSingle()

      const m = market as { locality_name: string; state_abbrev: string } | null
      if (m) {
        await sendImportCompleteNotification({
          importId:     claimed.id,
          agentId:      claimed.agent_id,
          localityName: m.locality_name,
          stateAbbrev:  m.state_abbrev,
          imported:     result.imported,
          matched:      result.matched,
        })
      }
    } catch (notifyErr) {
      // The import is complete and the row counts are persisted. A
      // failed notification is a soft-failure — log and move on. The
      // user's Properties page will already reflect the new rows.
      console.error('[process-core-market-imports] notification error', notifyErr)
    }
  }

  return NextResponse.json({
    import_id:    claimed.id,
    done:         result.done,
    imported:     result.imported,
    matched:      result.matched,
    batch_cursor: result.batch_cursor,
  })
}
