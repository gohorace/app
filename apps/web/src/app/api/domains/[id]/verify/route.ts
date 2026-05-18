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
import { verifyDomain, VercelDomainError } from '@/lib/vercel/domains'
import { invalidateHostLookup } from '@/lib/domains/lookup'

interface CustomDomainRow {
  id: string
  workspace_id: string
  hostname: string
  status: string
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
    .select('id, workspace_id, hostname, status')
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
    const status = await verifyDomain(row.hostname)
    const now = new Date().toISOString()

    let nextStatus: 'verified' | 'verifying' | 'failed' = 'verifying'
    let nextSsl: 'pending' | 'provisioning' | 'active' | 'failed' = 'pending'
    let errorMessage: string | null = null

    if (status.verified && !status.misconfigured) {
      nextStatus = 'verified'
      nextSsl = status.sslActive ? 'active' : 'provisioning'
    } else if (status.verified && status.misconfigured) {
      // Vercel marked it verified but DNS resolution still off — usually
      // a transient state.
      nextStatus = 'verifying'
      nextSsl = 'pending'
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
        verification_records: status.verificationRecords,
        last_checked_at: now,
        verified_at: nextStatus === 'verified' ? now : null,
        error_message: errorMessage,
      })
      .eq('id', row.id)

    invalidateHostLookup(row.hostname)

    return NextResponse.json({
      id: row.id,
      hostname: row.hostname,
      status: nextStatus,
      ssl_status: nextSsl,
      verification_records: status.verificationRecords,
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
