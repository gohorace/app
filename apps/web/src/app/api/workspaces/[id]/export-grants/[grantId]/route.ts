/**
 * DELETE /api/workspaces/[id]/export-grants/[grantId]  — HOR-375 (Phase 7).
 *
 * Revoke an agent's self-export grant (Admin only, gated behind EXPORT_ENABLED).
 * Audited as export.revoke.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActor } from '@/lib/auth/capabilities'
import { logAudit, AuditAction } from '@/lib/audit/log'
import { EXPORT_ENABLED } from '@/lib/export/launch'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; grantId: string }> },
) {
  const { id: workspaceId, grantId } = await params
  if (!EXPORT_ENABLED) {
    return NextResponse.json({ error: 'export_not_enabled' }, { status: 403 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const actor = await getActor(admin, user.id, { requireWorkspace: true })
  if (!actor || actor.workspaceId !== workspaceId || !actor.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Delete scoped to the workspace so a grant id from elsewhere can't be revoked.
  const { data: deleted, error } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('export_grants' as any)
    .delete()
    .eq('id', grantId)
    .eq('workspace_id', workspaceId)
    .select('id, granted_to_agent_id')

  if (error) {
    console.error('[export-grants] delete failed', { workspaceId, grantId, error })
    return NextResponse.json({ error: 'Failed to revoke grant' }, { status: 500 })
  }
  const rows = (deleted as Array<{ id: string; granted_to_agent_id: string }> | null) ?? []
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Grant not found' }, { status: 404 })
  }

  await logAudit(admin, {
    workspaceId,
    actorUserId: user.id,
    actorAgentId: actor.agentId,
    action: AuditAction.ExportRevoke,
    resourceType: 'export_grant',
    resourceId: grantId,
    scope: 'account',
    metadata: { granted_to_agent_id: rows[0].granted_to_agent_id },
  })

  return NextResponse.json({ revoked: true })
}
