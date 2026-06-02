/**
 * POST /api/properties/:id/reassign  — HOR-379 (Phase 5, Access Control epic).
 *
 * Hand a property and everything that hangs off it (events, resident contacts,
 * in-flight comms) to another agent in one atomic move. Gated on the canonical
 * capability `assign_properties` (Admin + Manager — account-wide oversight, not
 * scoped to the actor's own assignments). The heavy lifting + the audit row live
 * in the `reassign_property` DEFINER RPC (migration 20260602000006) so the move
 * and its log can't diverge; this route is the trust boundary that resolves the
 * actor and enforces the gate before invoking it with the service client.
 *
 * Body: { to_agent_id: string, notes?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActor } from '@/lib/auth/capabilities'

const BodySchema = z.object({
  to_agent_id: z.string().uuid(),
  notes: z.string().max(2000).nullish(),
})

/** Raised-message → HTTP status for the RPC's guard exceptions. */
const RPC_ERROR_STATUS: Record<string, number> = {
  property_not_found: 404,
  invalid_target_agent: 422,
  same_agent: 409,
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const propertyId = params.id
  if (!propertyId) {
    return NextResponse.json({ error: 'property id required' }, { status: 400 })
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
    return NextResponse.json({ error: 'to_agent_id (uuid) is required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const actor = await getActor(admin, user.id, { requireWorkspace: true })
  if (!actor?.workspaceId || !actor.agentId) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  // Account-wide oversight capability — Admin + Manager. Reassignment is not
  // scoped to the actor's own assignments (that's the whole point: a Manager
  // moves work between agents). The RPC re-checks workspace membership of both
  // the property and the target agent, so a cross-workspace id can't leak.
  if (!actor.can('assign_properties')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // reassign_property isn't in the generated types yet (regen deferred).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).rpc('reassign_property', {
    p_property_id: propertyId,
    p_to_agent_id: body.to_agent_id,
    p_actor_user_id: user.id,
    p_actor_agent_id: actor.agentId,
    p_reason: 'manual_reassignment',
    p_notes: body.notes ?? null,
  })

  if (error) {
    const message = (error as { message?: string }).message ?? ''
    const known = Object.keys(RPC_ERROR_STATUS).find((k) => message.includes(k))
    if (known) {
      return NextResponse.json({ error: known }, { status: RPC_ERROR_STATUS[known] })
    }
    console.error('[reassign] rpc failed', { propertyId, error })
    return NextResponse.json({ error: 'Failed to reassign property' }, { status: 500 })
  }

  return NextResponse.json(data ?? { ok: true })
}
