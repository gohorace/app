import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// HOR-142  /api/lists/[id]
//
// GET    → list metadata + member contacts (manual lists only — saved_filter
//          lists derive members at view time, so this endpoint returns the
//          stored filter_state and an empty members array).
// PATCH  → rename / edit description / replace filter_state.
// DELETE → soft delete (sets deleted_at = now()). CASCADE handles membership.

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(400).nullable().optional(),
  filter_state: z.record(z.unknown()).nullable().optional(),
})

async function resolveAgentWorkspace(userId: string) {
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', userId)
    .maybeSingle()
  return { admin, agent }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { admin, agent } = await resolveAgentWorkspace(user.id)
  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const { data: list } = await admin
    .from('lists')
    .select('id, name, description, kind, filter_state, created_at, updated_at, agent_id')
    .eq('id', params.id)
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // saved_filter lists have no stored membership — Slice 3 derives them from
  // contacts + filter_state. Return empty for now and let the consumer route
  // to the Contacts grid with the filter applied.
  if (list.kind !== 'manual') {
    return NextResponse.json({ list, members: [] })
  }

  const { data: membershipRows } = await admin
    .from('contact_list_membership')
    .select('contact_id, added_at, added_by_agent_id')
    .eq('list_id', list.id)
    .order('added_at', { ascending: false })

  const ids = (membershipRows ?? []).map((m) => m.contact_id)
  if (ids.length === 0) return NextResponse.json({ list, members: [] })

  // Pull only the columns the AddToListSheet + lists page need. Scope by
  // agent_id is the V1 contact-ownership model; future merge to workspace-
  // scoped contacts will let us drop this filter.
  const { data: contacts } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email, phone, suburb, score, last_seen_at, residence_property_id')
    .in('id', ids)
    .eq('agent_id', agent.id)
    .is('deleted_at', null)

  // Preserve membership order (newest-added first), drop any contact that
  // got soft-deleted or moved out from under us.
  const byId = new Map((contacts ?? []).map((c) => [c.id, c]))
  const members = (membershipRows ?? [])
    .map((m) => {
      const c = byId.get(m.contact_id)
      return c ? { ...c, added_at: m.added_at, added_by_agent_id: m.added_by_agent_id } : null
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)

  return NextResponse.json({ list, members })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { admin, agent } = await resolveAgentWorkspace(user.id)
  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const parsed = PatchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.format() },
      { status: 400 },
    )
  }

  const update: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) update.name = parsed.data.name
  if (parsed.data.description !== undefined) update.description = parsed.data.description
  if (parsed.data.filter_state !== undefined) update.filter_state = parsed.data.filter_state

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Pre-check for name collisions so the consumer gets a 409 instead of a 500.
  if (typeof update.name === 'string') {
    const { data: collision } = await admin
      .from('lists')
      .select('id')
      .eq('workspace_id', agent.workspace_id)
      .eq('name', update.name)
      .is('deleted_at', null)
      .neq('id', params.id)
      .maybeSingle()
    if (collision) {
      return NextResponse.json(
        { error: 'A list with that name already exists in this workspace' },
        { status: 409 },
      )
    }
  }

  const { error } = await admin
    .from('lists')
    .update(update)
    .eq('id', params.id)
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { admin, agent } = await resolveAgentWorkspace(user.id)
  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // Soft delete. Memberships stay attached via FK but are unreachable
  // because every read filters `deleted_at IS NULL`. A future cleanup job
  // can hard-delete soft rows older than N days (mirrors contacts pattern).
  const { error } = await admin
    .from('lists')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
