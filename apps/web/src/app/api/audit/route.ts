/**
 * GET /api/audit — HOR-374 (Phase 2, Access Control epic).
 *
 * Admin-only read of the workspace audit trail. Gated on the canonical Role axis
 * (`actor.isAdmin` — true Admin only, per the spec's "queryable by Admin"). This is
 * a net-new surface, so it takes the strict gate from the start (unlike the legacy
 * owner|admin surfaces HOR-376 left untouched).
 *
 * Query params:
 *   limit          — page size, default 50, max 200
 *   before         — ISO timestamp; return rows strictly older than this (cursor)
 *   resource_type  — optional filter ('contact' | 'email' | …)
 *   resource_id    — optional filter (uuid)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActor } from '@/lib/auth/capabilities'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const actor = await getActor(admin, user.id, { requireWorkspace: true })
  if (!actor?.workspaceId) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }
  if (!actor.isAdmin) {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200)
  const before = sp.get('before')
  const resourceType = sp.get('resource_type')
  const resourceId = sp.get('resource_id')

  let query = admin
    // audit_log isn't in the generated types yet (regen deferred).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('audit_log' as any)
    .select(
      'id, actor_user_id, actor_agent_id, acting_as_agent_id, action, resource_type, resource_id, scope, metadata, created_at',
    )
    .eq('workspace_id', actor.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (before) query = query.lt('created_at', before)
  if (resourceType) query = query.eq('resource_type', resourceType)
  if (resourceId) query = query.eq('resource_id', resourceId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data as Array<{ created_at: string }> | null) ?? []
  // Cursor for the next page: the oldest created_at in this batch (when full).
  const nextBefore = rows.length === limit ? rows[rows.length - 1].created_at : null

  return NextResponse.json({ entries: rows, next_before: nextBefore })
}
