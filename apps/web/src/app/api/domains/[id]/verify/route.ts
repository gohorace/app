/**
 * HOR-204 — POST /api/domains/[id]/verify
 *
 * Re-runs Vercel's DNS verification on a custom domain row. Used by:
 *   - The "Check status" button in /settings/custom-domain
 *   - The pg_cron poller for pending/verifying rows
 *
 * Idempotent: re-runs are safe. Flips the row to verified on success;
 * leaves it in verifying / failed otherwise.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { addDomain, verifyDomain, VercelDomainError } from '@/lib/vercel/domains'
import { invalidateHostLookup } from '@/lib/domains/lookup'

interface CustomDomainRow {
  id: string
  workspace_id: string
  hostname: string
  status: string
  vercel_domain_id: string | null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Fetch row + ACL in one shot.
  const { data: rowRaw } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_custom_domains' as any)
    .select('id, workspace_id, hostname, status, vercel_domain_id')
    .eq('id', id)
    .maybeSingle()
  const row = rowRaw as CustomDomainRow | null
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', row.workspace_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const now = new Date().toISOString()
    let nextStatus: 'verified' | 'verifying' = 'verifying'
    let nextSsl: 'pending' | 'provisioning' | 'active' = 'pending'
    let verificationRecords: Awaited<ReturnType<typeof verifyDomain>>['verificationRecords']

    if (!row.vercel_domain_id) {
      // Row never reached Vercel (e.g. the create call errored with
      // env_missing before addDomain succeeded). Run addDomain now so
      // the Retry button on a failed row can recover without forcing
      // the user to delete the DB row manually.
      const result = await addDomain(row.hostname)
      verificationRecords = result.verificationRecords
      if (result.verified) {
        nextStatus = 'verified'
        nextSsl = 'provisioning'
      } else {
        nextStatus = 'verifying'
        nextSsl = 'pending'
      }
      await admin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('workspace_custom_domains' as any)
        .update({
          status: nextStatus,
          ssl_status: nextSsl,
          vercel_domain_id: row.hostname,
          verification_records: verificationRecords,
          last_checked_at: now,
          verified_at: nextStatus === 'verified' ? now : null,
          error_message: null,
        })
        .eq('id', row.id)
    } else {
      // Row is registered with Vercel — re-check verification state.
      const status = await verifyDomain(row.hostname)
      verificationRecords = status.verificationRecords

      if (status.verified && !status.misconfigured) {
        nextStatus = 'verified'
        nextSsl = status.sslActive ? 'active' : 'provisioning'
      } else {
        // Includes the "verified but misconfigured" transient case.
        nextStatus = 'verifying'
        nextSsl = 'pending'
      }

      await admin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('workspace_custom_domains' as any)
        .update({
          status: nextStatus,
          ssl_status: nextSsl,
          verification_records: verificationRecords,
          last_checked_at: now,
          verified_at: nextStatus === 'verified' ? now : null,
          error_message: null,
        })
        .eq('id', row.id)
    }

    invalidateHostLookup(row.hostname)

    return NextResponse.json({
      id: row.id,
      hostname: row.hostname,
      status: nextStatus,
      ssl_status: nextSsl,
      verification_records: verificationRecords,
    })
  } catch (err) {
    const message = err instanceof VercelDomainError ? err.message : 'Vercel call failed'
    await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('workspace_custom_domains' as any)
      .update({
        status: 'failed',
        error_message: message,
        last_checked_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    return NextResponse.json({ error: message, status: 'failed' }, { status: 502 })
  }
}
