/**
 * HOR-322 · Revoke an agency API key (admin-only). Revocation is immediate —
 * resolve_api_v1_token ignores rows where revoked_at IS NOT NULL.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createApiV1Db()
  const ctx = await resolveAdminContext(db, user.id)
  if (!ctx) return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  if (!ctx.isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const { data, error } = await db
    .from('workspace_api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('workspace_id', ctx.workspaceId)
    .eq('kind', 'api_v1')
    .is('revoked_at', null)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Key not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
