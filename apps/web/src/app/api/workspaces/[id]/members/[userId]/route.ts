/**
 * HOR-101 — DELETE /api/workspaces/[id]/members/[userId]
 *
 * Owner removes a member. The agents row is flipped to status='departed'
 * with departed_at set (preserving history for HOR-94's departed-agent
 * email flow). The workspace_members row is deleted, which RLS-cuts
 * the user off from the workspace on next request.
 *
 * Sole-owner guard: if the target is the only owner in the workspace,
 * we return 409 — they must designate another owner first (owner
 * transfer is part of Slice 2, separate ticket).
 *
 * No email is sent from this endpoint. The departed-agent + export-ready
 * email flow lives in the Alerts project (HOR-94).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileSupportSeats } from '@/lib/stripe/support-seats'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: workspaceId, userId: targetUserId } = await params
  if (!workspaceId || !targetUserId) {
    return NextResponse.json({ error: 'workspace id and user id required' }, { status: 400 })
  }

  // Authn
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ACL — owner only.
  const admin = createAdminClient()
  const { data: callerMembership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!callerMembership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (callerMembership.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only owners can remove members' },
      { status: 403 },
    )
  }

  // Look up target membership.
  const { data: targetMembership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', targetUserId)
    .maybeSingle()

  if (!targetMembership) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // Sole-owner guard: refuse to remove the only owner.
  if (targetMembership.role === 'owner') {
    const { count: ownerCount } = await admin
      .from('workspace_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('role', 'owner')

    if ((ownerCount ?? 0) <= 1) {
      return NextResponse.json(
        {
          error:
            'Cannot remove the only owner. Promote another member to owner first.',
        },
        { status: 409 },
      )
    }
  }

  // Flip agents to departed (preserves history) and delete workspace_members.
  // We use two writes rather than a single RPC since neither table has
  // cross-row constraints that need transactional atomicity at this scale.
  const now = new Date().toISOString()

  // status/departed_at on `agents` are added by HOR-65 but aren't in
  // database.types.ts until regenerated post-merge. Cast through.
  const { error: agentErr } = await admin
    .from('agents')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: 'departed', departed_at: now } as any)
    .eq('workspace_id', workspaceId)
    .eq('user_id', targetUserId)

  if (agentErr) {
    console.error('Failed to flip agent to departed', {
      workspaceId,
      targetUserId,
      error: agentErr,
    })
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }

  const { error: membershipErr } = await admin
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', targetUserId)

  if (membershipErr) {
    console.error('Failed to delete workspace_members row', {
      workspaceId,
      targetUserId,
      error: membershipErr,
    })
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }

  // Reconcile Stripe support-seat quantity (no-op when the removed
  // member was an agent seat). Best-effort; status='departed' already
  // excludes the row from the next reconcile pass regardless.
  try {
    await reconcileSupportSeats(workspaceId)
  } catch (err) {
    console.error('reconcileSupportSeats failed after member remove', {
      workspaceId,
      targetUserId,
      err,
    })
  }

  return NextResponse.json({ removed: true }, { status: 200 })
}
