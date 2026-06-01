/**
 * DELETE /api/email/scheduled/[id] — cancel a scheduled send before it fires.
 * PATCH  /api/email/scheduled/[id] — reschedule it to a new future time.
 *
 * Both only act while the row is still status='scheduled' (a row the worker
 * has already claimed → 'queued'/'sent' can't be cancelled). Scoped to the
 * authenticated agent. Used by the composer dock's "Scheduled —" bar and the
 * Stream upcoming item. (HOR-357)
 *
 * Auth mirrors /api/email/send (MCP bearer → cookie session).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import { authenticateRequest } from '@/lib/mcp/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function resolveAgentId(req: NextRequest): Promise<string | null> {
  const mcp = await authenticateRequest(req)
  if (mcp) return mcp.agentId

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })
  return agent?.id ?? null
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const agentId = await resolveAgentId(req)
  if (!agentId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  // email_sends isn't in the generated Database type yet (regen deferred).
  const { data, error } = await (admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('email_sends' as any)
    .delete()
    .eq('id', id)
    .eq('agent_id', agentId)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle())

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    // Either not found, not this agent's, or already fired — nothing to cancel.
    return NextResponse.json({ error: 'Not cancellable' }, { status: 409 })
  }
  return NextResponse.json({ cancelled: true, id }, { status: 200 })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const agentId = await resolveAgentId(req)
  if (!agentId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { scheduled_at?: string }
  try {
    body = (await req.json()) as { scheduled_at?: string }
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 })
  }
  const at = body.scheduled_at ? new Date(body.scheduled_at) : null
  if (!at || Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'scheduled_at must be a future ISO timestamp' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await (admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('email_sends' as any)
    .update({ scheduled_at: at.toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('agent_id', agentId)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle())

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not reschedulable' }, { status: 409 })
  return NextResponse.json({ rescheduled: true, id, scheduled_at: at.toISOString() }, { status: 200 })
}
