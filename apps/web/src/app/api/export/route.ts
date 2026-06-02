/**
 * POST /api/export  — HOR-375 (Phase 7, Access Control epic).
 *
 * Sovereign-layer export. Two paths, both logged to audit_log:
 *   • { scope: 'account' } — whole-account export, Admin only (`export_account`).
 *   • { scope: 'own' }     — the caller's own scope. Admins always may; a pure
 *                            Agent may only with an active Admin grant
 *                            (`export_grants`). No unilateral agent export.
 *
 * Gated behind EXPORT_ENABLED until Marketing refocuses the trust-page copy to
 * account-level sovereignty (see lib/export/launch).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActor } from '@/lib/auth/capabilities'
import { logAudit, AuditAction } from '@/lib/audit/log'
import { hasActiveExportGrant } from '@/lib/export/grants'
import { buildAccountExport, buildScopeExport, type ExportBundle } from '@/lib/export/build'
import { EXPORT_ENABLED } from '@/lib/export/launch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({ scope: z.enum(['account', 'own']) })

export async function POST(req: NextRequest) {
  if (!EXPORT_ENABLED) {
    return NextResponse.json({ error: 'export_not_enabled' }, { status: 403 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'scope must be "account" or "own"' }, { status: 400 })
  }

  const admin = createAdminClient()
  const actor = await getActor(admin, user.id, { requireWorkspace: true })
  if (!actor?.workspaceId || !actor.agentId) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  let bundle: ExportBundle
  let action: string

  if (body.scope === 'account') {
    if (!actor.can('export_account')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    bundle = await buildAccountExport(admin, actor.workspaceId)
    action = AuditAction.ExportAccount
  } else {
    // own scope: capability AND (Admin OR an active grant). Pure Agents cannot
    // self-export without an Admin having granted it.
    if (!actor.can('export_own_scope')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!actor.isAdmin && !(await hasActiveExportGrant(admin, actor.agentId))) {
      return NextResponse.json({ error: 'grant_required' }, { status: 403 })
    }
    bundle = await buildScopeExport(admin, actor.workspaceId, actor.agentId)
    action = AuditAction.ExportScope
  }

  await logAudit(admin, {
    workspaceId: actor.workspaceId,
    actorUserId: user.id,
    actorAgentId: actor.agentId,
    action,
    resourceType: 'export',
    resourceId: null,
    scope: body.scope === 'account' ? 'account' : 'own',
    metadata: { counts: bundle.counts },
  })

  const filename = `horace-export-${body.scope}-${bundle.exported_at.slice(0, 10)}.json`
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
