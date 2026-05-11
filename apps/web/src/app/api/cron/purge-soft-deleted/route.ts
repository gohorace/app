import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Daily cron — hard-delete contacts whose 30-day soft-delete window has expired.
 *
 * Auth: Bearer ${CRON_SECRET} (same pattern as daily-briefing).
 * Schedule: vercel.json → /api/cron/purge-soft-deleted at 03:00 UTC daily.
 *
 * Postgres CASCADE FKs handle the downstream cleanup (events, identified_devices,
 * identity_map, score_history, campaign_tokens, contact_tracked_links, contact_roles,
 * contact_property_relationships, ownership_history). notification_log and enquiries
 * are SET NULL on contact_id so audit history survives the purge.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Cutoff in DB time (timestamptz) — avoid client-clock drift.
  const { data: rows, error: selectError } = await admin
    .from('contacts')
    .select('id, deleted_at')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

  if (selectError) {
    console.error('[purge-soft-deleted] select error:', selectError)
    return NextResponse.json({ error: selectError.message }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, purged: 0 })
  }

  const ids = rows.map((r) => r.id)
  const { error: deleteError } = await admin
    .from('contacts')
    .delete()
    .in('id', ids)

  if (deleteError) {
    console.error('[purge-soft-deleted] delete error:', deleteError)
    return NextResponse.json({ error: deleteError.message, attempted: ids.length }, { status: 500 })
  }

  console.log(`[purge-soft-deleted] hard-deleted ${ids.length} contacts past 30-day window`)
  return NextResponse.json({ ok: true, purged: ids.length, ids })
}
