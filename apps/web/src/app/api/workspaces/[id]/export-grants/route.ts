/**
 * /api/workspaces/[id]/export-grants  — HOR-375 (Phase 7).
 *
 * GET  — list the workspace's export grants (Admin only).
 * POST — grant an agent self-export of their own scope (Admin only). No agent can
 *        self-export without one of these. Body: { agent_id, expires_at? }.
 *
 * Both Admin-only and gated behind EXPORT_ENABLED. Grant creation is audited.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActor } from '@/lib/auth/capabilities'
import { logAudit, AuditAction } from '@/lib/audit/log'
import { EXPORT_ENABLED } from '@/lib/export/launch'

const CreateSchema = z.object({
  agent_id: z.string().uuid(),
  expires_at: z.string().datetime().nullish(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params
  const guard = await requireAdmin(workspaceId)
  if ('error' in guard) return guard.error

  const { data, error } = await guard.admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('export_grants' as any)
    .select('id, granted_to_agent_id, granted_by_agent_id, scope, created_at, expires_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to load grants' }, { status: 500 })
  return NextResponse.json({ grants: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: workspaceId } = await params
  const guard = await requireAdmin(workspaceId)
  if ('error' in guard) return guard.error
  const { admin, actorUserId, actorAgentId } = guard

  let body: z.infer<typeof CreateSchema>
  try {
    body = CreateSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'agent_id (uuid) is required' }, { status: 400 })
  }

  // Target must be a real agent in this workspace.
  const { data: target } = await admin
    .from('agents')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('id, status' as any)
    .eq('workspace_id', workspaceId)
    .eq('id', body.agent_id)
    .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!target || (target as any).status === 'departed') {
    return NextResponse.json({ error: 'Agent not found in workspace' }, { status: 404 })
  }

  const { data: grant, error } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('export_grants' as any)
    .insert({
      workspace_id: workspaceId,
      granted_to_agent_id: body.agent_id,
      granted_by_agent_id: actorAgentId,
      scope: 'own_scope',
      expires_at: body.expires_at ?? null,
    })
    .select('id, granted_to_agent_id, expires_at')
    .single()

  if (error) {
    console.error('[export-grants] insert failed', { workspaceId, error })
    return NextResponse.json({ error: 'Failed to create grant' }, { status: 500 })
  }

  await logAudit(admin, {
    workspaceId,
    actorUserId,
    actorAgentId,
    action: AuditAction.ExportGrant,
    resourceType: 'export_grant',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resourceId: (grant as any).id,
    scope: 'account',
    metadata: { granted_to_agent_id: body.agent_id, expires_at: body.expires_at ?? null },
  })

  return NextResponse.json({ grant }, { status: 201 })
}

// ── Admin guard (Admin-only + EXPORT_ENABLED) ───────────────────────────────
async function requireAdmin(
  workspaceId: string,
): Promise<
  | { error: NextResponse }
  | { admin: ReturnType<typeof createAdminClient>; actorUserId: string; actorAgentId: string | null }
> {
  if (!EXPORT_ENABLED) {
    return { error: NextResponse.json({ error: 'export_not_enabled' }, { status: 403 }) }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const admin = createAdminClient()
  const actor = await getActor(admin, user.id, { requireWorkspace: true })
  if (!actor || actor.workspaceId !== workspaceId || !actor.isAdmin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { admin, actorUserId: user.id, actorAgentId: actor.agentId }
}
