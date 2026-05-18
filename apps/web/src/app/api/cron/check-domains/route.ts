/**
 * HOR-204 — GET /api/cron/check-domains
 *
 * Re-runs Vercel verification on workspace_custom_domains rows in
 * status='pending' or 'verifying' so the settings UI catches a flip to
 * verified without the user clicking "Check status". Scheduled by
 * Supabase pg_cron (the memory note pins us off Vercel Hobby cron).
 *
 * Recommended schedule: every 10 minutes. Each invocation re-checks at
 * most BATCH_SIZE rows.
 *
 * Auth: same Bearer-token pattern as daily-briefing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyDomain, VercelDomainError } from '@/lib/vercel/domains'
import { invalidateHostLookup } from '@/lib/domains/lookup'

const BATCH_SIZE = 25

interface DomainRow {
  id: string
  workspace_id: string
  hostname: string
  status: string
  last_checked_at: string | null
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.VERCEL_API_TOKEN || !process.env.VERCEL_PROJECT_ID) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'vercel_not_configured' })
  }

  const admin = createAdminClient()

  // Pick the oldest-checked pending/verifying rows so we don't starve
  // long-pending ones.
  const { data: rowsRaw } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_custom_domains' as any)
    .select('id, workspace_id, hostname, status, last_checked_at')
    .in('status', ['pending', 'verifying'])
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE)

  const rows = (rowsRaw as DomainRow[] | null) ?? []
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, checked: 0 })
  }

  let verified = 0
  let stillPending = 0
  let failed = 0

  for (const row of rows) {
    try {
      const status = await verifyDomain(row.hostname)
      const now = new Date().toISOString()
      let nextStatus: 'verified' | 'verifying' = 'verifying'
      let nextSsl: 'pending' | 'provisioning' | 'active' = 'pending'

      if (status.verified && !status.misconfigured) {
        nextStatus = 'verified'
        nextSsl = status.sslActive ? 'active' : 'provisioning'
        verified++
      } else {
        stillPending++
      }

      await admin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('workspace_custom_domains' as any)
        .update({
          status: nextStatus,
          ssl_status: nextSsl,
          verification_records: status.verificationRecords,
          last_checked_at: now,
          verified_at: nextStatus === 'verified' ? now : null,
        })
        .eq('id', row.id)

      if (nextStatus === 'verified') {
        invalidateHostLookup(row.hostname)
      }
    } catch (err) {
      failed++
      const message = err instanceof VercelDomainError ? err.message : 'Vercel call failed'
      await admin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('workspace_custom_domains' as any)
        .update({
          // Don't flip to 'failed' here — that's a terminal state.
          // Transient Vercel errors should leave the row pending so the
          // next cron tick retries. Just bump last_checked_at + log.
          last_checked_at: new Date().toISOString(),
          error_message: message,
        })
        .eq('id', row.id)
      console.error('[check-domains] verify failed', { id: row.id, hostname: row.hostname, err })
    }
  }

  return NextResponse.json({
    ok: true,
    checked: rows.length,
    verified,
    stillPending,
    failed,
  })
}
