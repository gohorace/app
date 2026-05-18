/**
 * HOR-101 — DELETE /api/workspaces/[id]/invites/[inviteId]
 *
 * Owner/admin revokes a pending invite. The row stays in the table
 * with `revoked_at = now()` so audit history is preserved; the
 * redemption page + RPC both reject revoked invites.
 *
 * Idempotent: revoking an already-revoked invite is a 200 no-op.
 *
 * 404 vs 403: a non-member gets 403 (don't leak workspace existence).
 * A member trying to revoke an invite that doesn't belong to this
 * workspace gets 404.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileSupportSeats } from '@/lib/stripe/support-seats'

interface InviteRow {
  id: string
  workspace_id: string
  role: 'manager' | 'agent' | 'support'
  revoked_at: string | null
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  const { id: workspaceId, inviteId } = await params
  if (!workspaceId || !inviteId) {
    return NextResponse.json({ error: 'workspace id and invite id required' }, { status: 400 })
  }

  // Authn
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ACL — owner or admin in workspace_members.
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only owners and admins can revoke invites' },
      { status: 403 },
    )
  }

  // Look up the invite. Confirm it belongs to this workspace.
  const { data: inviteRaw } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_invites' as any)
    .select('id, workspace_id, role, revoked_at')
    .eq('id', inviteId)
    .maybeSingle()

  const invite = inviteRaw as InviteRow | null
  if (!invite || invite.workspace_id !== workspaceId) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }

  // Idempotent — already-revoked is a 200 no-op.
  if (invite.revoked_at) {
    return NextResponse.json({ id: invite.id, revoked: true, already: true }, { status: 200 })
  }

  const { error: updateErr } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_invites' as any)
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', invite.id)

  if (updateErr) {
    console.error('Failed to revoke invite', { inviteId, error: updateErr })
    return NextResponse.json({ error: 'Failed to revoke invite' }, { status: 500 })
  }

  // Reconcile Stripe quantity when a support invite is revoked.
  // Best-effort: if Stripe fails we still keep the revoked row.
  if (invite.role === 'support') {
    try {
      await reconcileSupportSeats(workspaceId)
    } catch (err) {
      console.error('reconcileSupportSeats failed after invite revoke', {
        workspaceId,
        inviteId,
        err,
      })
    }
  }

  return NextResponse.json({ id: invite.id, revoked: true, already: false }, { status: 200 })
}
