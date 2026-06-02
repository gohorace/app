/**
 * /api/workspaces/[id]/members/[userId]
 *
 * POST   — change a member's role (promote/demote). HOR-377.
 * DELETE — remove a member (flips agents.status='departed', deletes the
 *          workspace_members row). HOR-101, retrofitted for HOR-377.
 *
 * Both are gated on the canonical Role axis (agents.role, HOR-376) and the
 * grant ceiling ("a user can only act at or below their own role"). The
 * "account must retain ≥1 admin" invariant is enforced in the DB by the
 * enforce_last_admin trigger (migration 20260602000002) — every mutation path
 * is covered there, so these handlers just surface its 23514 as a clean 409.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileSupportSeats } from '@/lib/stripe/support-seats'
import { ROLE_RANK, checkRoleChange, type AgentRole } from '@/lib/auth/capabilities'
import { logAudit, AuditAction } from '@/lib/audit/log'

/** Postgres check_violation raised by the last-admin invariant trigger. */
const LAST_ADMIN_ERRCODE = '23514'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Resolve a user's canonical agent (role + id) within a specific workspace.
 * Multi-workspace safe: queries the (workspace_id, user_id) row directly rather
 * than the user's "primary" agent.
 */
async function agentInWorkspace(
  admin: AdminClient,
  workspaceId: string,
  userId: string,
  opts: { excludeDeparted?: boolean } = {},
): Promise<{ id: string; role: AgentRole; status: string } | null> {
  const { data } = await admin
    .from('agents')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('id, role, status' as any)
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any
  if (!row) return null
  if (opts.excludeDeparted && row.status === 'departed') return null
  const role: AgentRole = row.role === 'admin' || row.role === 'manager' ? row.role : 'agent'
  return { id: row.id as string, role, status: row.status as string }
}

/** Canonical agents.role → legacy workspace_members.role tier (kept in sync). */
function membersRoleFor(role: AgentRole): 'admin' | 'viewer' {
  // admin + manager are both "elevated" in the legacy members vocabulary (matches
  // today's invite mapping); agent maps to viewer. The fine admin-vs-manager
  // distinction lives in agents.role (canonical, HOR-376).
  return role === 'agent' ? 'viewer' : 'admin'
}

// ── POST: change a member's role ────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: workspaceId, userId: targetUserId } = await params
  if (!workspaceId || !targetUserId) {
    return NextResponse.json({ error: 'workspace id and user id required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { role?: unknown }
  try {
    body = (await request.json()) as { role?: unknown }
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
  }
  const nextRole = body.role
  if (nextRole !== 'admin' && nextRole !== 'manager' && nextRole !== 'agent') {
    return NextResponse.json(
      { error: 'role must be "admin", "manager", or "agent"' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()

  const caller = await agentInWorkspace(admin, workspaceId, user.id, { excludeDeparted: true })
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const target = await agentInWorkspace(admin, workspaceId, targetUserId)
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const check = checkRoleChange({
    actorRole: caller.role,
    actorIsSelf: user.id === targetUserId,
    currentRole: target.role,
    nextRole,
  })
  if (!check.ok) {
    const message =
      check.reason === 'self_escalation'
        ? 'You cannot raise your own role.'
        : check.reason === 'ceiling'
          ? 'You can only assign a role at or below your own.'
          : 'You do not have permission to manage roles.'
    return NextResponse.json({ error: message }, { status: 403 })
  }

  if (target.role === nextRole) {
    return NextResponse.json({ ok: true, role: nextRole, unchanged: true })
  }

  // Canonical write: agents.role. The last-admin trigger guards a demotion of
  // the final admin and raises 23514 → surface as 409.
  const { error: roleErr } = await admin
    .from('agents')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ role: nextRole } as any)
    .eq('workspace_id', workspaceId)
    .eq('user_id', targetUserId)

  if (roleErr) {
    if ((roleErr as { code?: string }).code === LAST_ADMIN_ERRCODE) {
      return NextResponse.json(
        { error: 'The workspace must keep at least one admin.' },
        { status: 409 },
      )
    }
    console.error('Failed to change member role', { workspaceId, targetUserId, error: roleErr })
    return NextResponse.json({ error: 'Failed to change role' }, { status: 500 })
  }

  // Keep the legacy membership tier in sync (still read by older route gates).
  await admin
    .from('workspace_members')
    .update({ role: membersRoleFor(nextRole) })
    .eq('workspace_id', workspaceId)
    .eq('user_id', targetUserId)

  await logAudit(admin, {
    workspaceId,
    actorUserId: user.id,
    actorAgentId: caller.id,
    action: AuditAction.RoleChange,
    resourceType: 'member',
    resourceId: target.id,
    metadata: { from: target.role, to: nextRole, target_user_id: targetUserId },
  })

  return NextResponse.json({ ok: true, role: nextRole })
}

// ── DELETE: remove a member ─────────────────────────────────────────────────

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

  // ACL — caller must manage team (Admin or Manager), HOR-377.
  const admin = createAdminClient()
  const caller = await agentInWorkspace(admin, workspaceId, user.id, { excludeDeparted: true })
  if (!caller || (caller.role !== 'admin' && caller.role !== 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Look up target.
  const target = await agentInWorkspace(admin, workspaceId, targetUserId)
  if (!target) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // Ceiling: cannot remove someone more senior than yourself.
  if (ROLE_RANK[target.role] > ROLE_RANK[caller.role]) {
    return NextResponse.json(
      { error: 'You can only remove members at or below your own role.' },
      { status: 403 },
    )
  }

  // Flip agents to departed (preserves history) and delete workspace_members.
  // The enforce_last_admin trigger raises 23514 if this would remove the final
  // admin — surface it as a 409 rather than a 500.
  const now = new Date().toISOString()

  // status/departed_at on `agents` aren't in database.types.ts until regenerated.
  const { error: agentErr } = await admin
    .from('agents')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: 'departed', departed_at: now } as any)
    .eq('workspace_id', workspaceId)
    .eq('user_id', targetUserId)

  if (agentErr) {
    if ((agentErr as { code?: string }).code === LAST_ADMIN_ERRCODE) {
      return NextResponse.json(
        { error: 'Cannot remove the last admin. Promote another admin first.' },
        { status: 409 },
      )
    }
    console.error('Failed to flip agent to departed', { workspaceId, targetUserId, error: agentErr })
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

  await logAudit(admin, {
    workspaceId,
    actorUserId: user.id,
    actorAgentId: caller.id,
    action: AuditAction.MemberRemove,
    resourceType: 'member',
    resourceId: target.id,
    metadata: { role: target.role, target_user_id: targetUserId },
  })

  // Reconcile Stripe support-seat quantity (no-op when the removed member was an
  // agent seat). Best-effort; status='departed' already excludes the row.
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
