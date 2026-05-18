/**
 * HOR-204 — DELETE /api/domains/[id]
 *
 * Detach a custom domain. Flips the row status to 'removed' and asks
 * Vercel to release the SSL cert. Does NOT delete any Doorstep data —
 * inspections / scans / contacts are preserved per the brief
 * ("data preserved, Doorstep capture paused until domain restored").
 *
 * Owner/admin only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { removeDomain, VercelDomainError } from '@/lib/vercel/domains'
import { invalidateHostLookup } from '@/lib/domains/lookup'

interface CustomDomainRow {
  id: string
  workspace_id: string
  hostname: string
  status: string
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

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

  // Idempotent — already removed is a 200 no-op.
  if (row.status === 'removed') {
    return NextResponse.json({ id: row.id, removed: true, already: true })
  }

  // Detach from Vercel first; flip status only if that succeeded (or the
  // domain was already absent there).
  try {
    await removeDomain(row.hostname)
  } catch (err) {
    const message = err instanceof VercelDomainError ? err.message : 'Vercel call failed'
    console.error('Vercel removeDomain failed', { hostname: row.hostname, err })
    return NextResponse.json({ error: message }, { status: 502 })
  }

  await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_custom_domains' as any)
    .update({
      status: 'removed',
      last_checked_at: new Date().toISOString(),
    })
    .eq('id', row.id)

  invalidateHostLookup(row.hostname)

  return NextResponse.json({ id: row.id, removed: true, already: false })
}
