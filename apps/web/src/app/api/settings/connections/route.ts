/**
 * HOR-324 · CRM connections (admin-only, workspace-scoped).
 *
 * GET  — list the agency's connections.
 * POST — submit a concierge connection request: upserts the row to
 *        'assisted_pending' with the requested intent. The Slack post to
 *        #connection-requests lands in Phase 5 (HOR-325); the team then wires
 *        it up by hand and flips the row to 'active'.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'
import { postConnectionRequest } from '@/lib/notifications/slack'

const CONNECTION_COLUMNS =
  'id, system, display_name, status, auth_method, inbound_enabled, outbound_enabled, last_synced_at, last_error, connected_at, requested_at, created_at'

const requestSchema = z
  .object({
    system: z.string().min(1).max(40),
    display_name: z.string().min(1).max(60),
    inbound: z.boolean().optional().default(false),
    outbound: z.boolean().optional().default(false),
  })
  .refine((d) => d.inbound || d.outbound, {
    message: 'Tell us which way the data should flow.',
    path: ['inbound'],
  })

export async function GET() {
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
    .from('crm_connections')
    .select(CONNECTION_COLUMNS)
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to load connections' }, { status: 500 })
  return NextResponse.json({ connections: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = requestSchema.safeParse(await req.json())
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ error: issue?.message ?? 'Invalid input' }, { status: 400 })
  }

  const db = createApiV1Db()
  const ctx = await resolveAdminContext(db, user.id)
  if (!ctx) return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  if (!ctx.isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const v = parsed.data

  const { data: existing } = await db
    .from('crm_connections')
    .select('id, status')
    .eq('workspace_id', ctx.workspaceId)
    .eq('system', v.system)
    .maybeSingle()

  if (existing?.status === 'active') {
    return NextResponse.json({ error: `${v.display_name} is already connected.` }, { status: 409 })
  }

  const fields = {
    workspace_id: ctx.workspaceId,
    system: v.system,
    display_name: v.display_name,
    status: 'assisted_pending',
    inbound_enabled: v.inbound,
    outbound_enabled: v.outbound,
    connected_by: ctx.agentId,
    requested_at: new Date().toISOString(),
  }

  const query = existing
    ? db.from('crm_connections').update(fields).eq('id', existing.id)
    : db.from('crm_connections').insert(fields)
  const { data, error } = await query.select(CONNECTION_COLUMNS).single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 })
  }

  // Post to #connection-requests so the team can wire it up by hand. Inert if
  // the webhook env is unset; never let a Slack hiccup fail the request.
  try {
    const [{ data: ws }, { data: agent }] = await Promise.all([
      db.from('workspaces').select('name').eq('id', ctx.workspaceId).maybeSingle(),
      db.from('agents').select('first_name, last_name, email').eq('id', ctx.agentId).maybeSingle(),
    ])
    await postConnectionRequest({
      agencyName: (ws?.name as string) ?? 'Unknown agency',
      agencyId: ctx.workspaceId,
      agentName: [agent?.first_name, agent?.last_name].filter(Boolean).join(' ') || 'Unknown',
      agentEmail: (agent?.email as string) ?? user.email ?? 'unknown',
      crm: v.display_name,
      inbound: v.inbound,
      outbound: v.outbound,
    })
  } catch (e) {
    console.error('[connections] slack notify failed', e)
  }

  return NextResponse.json({ connection: data })
}
