import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

// HOR-142  POST /api/lists/[id]/members
//
// Batch-add contacts to a manual list. Saved-filter lists don't have stored
// members — adding to one is silently a no-op (caller is doing something
// confused; we return 400 rather than confuse them further).

const Schema = z.object({
  contact_ids: z.array(z.string().uuid()).min(1).max(500),
})

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id)

  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const parsed = Schema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.format() },
      { status: 400 },
    )
  }

  // Verify the list exists and is in this workspace + is manual. Done as a
  // single read so the FK doesn't fire on a stale list id.
  const { data: list } = await admin
    .from('lists')
    .select('id, kind')
    .eq('id', params.id)
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 })
  if (list.kind !== 'manual') {
    return NextResponse.json(
      { error: 'Cannot add members to a saved-filter list' },
      { status: 400 },
    )
  }

  // Defence: only allow adding contacts owned by this agent. Stops a caller
  // from leaking workspace-mate contact ids into another agent's lists via
  // a guessed uuid.
  const { data: visible } = await admin
    .from('contacts')
    .select('id')
    .in('id', parsed.data.contact_ids)
    .eq('agent_id', agent.id)
    .is('deleted_at', null)

  const visibleIds = new Set((visible ?? []).map((c) => c.id))
  const accepted = parsed.data.contact_ids.filter((id) => visibleIds.has(id))

  if (accepted.length === 0) {
    return NextResponse.json({ added: 0, skipped: parsed.data.contact_ids.length })
  }

  // Upsert so re-adding an existing member is a no-op rather than a unique-
  // violation. ON CONFLICT DO NOTHING via the PK.
  const rows = accepted.map((cid) => ({
    list_id: list.id,
    contact_id: cid,
    added_by_agent_id: agent.id,
  }))

  const { error } = await admin
    .from('contact_list_membership')
    .upsert(rows, { onConflict: 'list_id,contact_id', ignoreDuplicates: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Bump the parent list's updated_at so the overview reorders correctly.
  // (We could rely on a trigger, but explicit is cheaper than another
  // migration for a single derived field.)
  await admin
    .from('lists')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', list.id)

  return NextResponse.json({
    added: accepted.length,
    skipped: parsed.data.contact_ids.length - accepted.length,
  })
}
