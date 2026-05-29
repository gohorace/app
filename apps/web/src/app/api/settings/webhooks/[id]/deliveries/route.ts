/**
 * HOR-323 · Webhook delivery log — last 30 days for one endpoint. Admin-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createApiV1Db()
  const ctx = await resolveAdminContext(db, user.id)
  if (!ctx) return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  if (!ctx.isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await db
    .from('webhook_deliveries')
    .select(
      'id, event_id, event_type, status, attempts, response_status, last_error, created_at, last_attempt_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .eq('endpoint_id', params.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: 'Failed to load deliveries' }, { status: 500 })
  return NextResponse.json({ deliveries: data ?? [] })
}
