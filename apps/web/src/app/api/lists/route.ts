import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database.types'

// HOR-142  /api/lists
// Workspace-shared lists. Every member of the workspace sees everyone's lists.
// Slice 1 only handles manual + saved_filter (the latter wired in Slice 2).
//
// GET   → workspace lists with member counts. Sorted newest-touched first.
// POST  → create a list. Body: { name, description?, kind?, filter_state? }.

const CreateListSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(400).optional().nullable(),
  // 'manual' is the everyday surface; 'saved_filter' is HOR-143's surface.
  kind: z.enum(['manual', 'saved_filter']).optional(),
  filter_state: z.record(z.unknown()).optional().nullable(),
})

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // Fetch lists + a member count per list. Member counts only matter for
  // 'manual' lists — 'saved_filter' counts are derived at view time so we
  // return null for those and let the consumer compute on demand.
  const { data: lists, error } = await admin
    .from('lists')
    .select('id, name, description, kind, filter_state, created_at, updated_at, agent_id')
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const manualIds = (lists ?? []).filter((l) => l.kind === 'manual').map((l) => l.id)
  const counts = new Map<string, number>()
  if (manualIds.length > 0) {
    // Single round-trip count: pull membership rows and tally client-side.
    // Workspace member counts are small (V1 expects ≤ a few thousand rows
    // total), so this is fine; switch to a group-by RPC if it ever bites.
    const { data: rows } = await admin
      .from('contact_list_membership')
      .select('list_id')
      .in('list_id', manualIds)
    for (const r of rows ?? []) {
      counts.set(r.list_id, (counts.get(r.list_id) ?? 0) + 1)
    }
  }

  // Optional ?contact_id=<uuid> lets the AddToListSheet pre-check the lists
  // this contact already belongs to without a second round-trip.
  const contactId = req.nextUrl.searchParams.get('contact_id')
  const memberOf = new Set<string>()
  if (contactId && manualIds.length > 0) {
    const { data: memberRows } = await admin
      .from('contact_list_membership')
      .select('list_id')
      .eq('contact_id', contactId)
      .in('list_id', manualIds)
    for (const r of memberRows ?? []) memberOf.add(r.list_id)
  }

  return NextResponse.json({
    lists: (lists ?? []).map((l) => ({
      ...l,
      member_count: l.kind === 'manual' ? (counts.get(l.id) ?? 0) : null,
      contact_is_member: contactId ? memberOf.has(l.id) : undefined,
    })),
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const parsed = CreateListSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.format() },
      { status: 400 },
    )
  }

  // Surface the partial-unique-index collision as a friendly 409 rather than
  // a 500 from a raw Postgres error.
  const { data: existing } = await admin
    .from('lists')
    .select('id')
    .eq('workspace_id', agent.workspace_id)
    .eq('name', parsed.data.name)
    .is('deleted_at', null)
    .maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: 'A list with that name already exists in this workspace' },
      { status: 409 },
    )
  }

  const { data: list, error } = await admin
    .from('lists')
    .insert({
      workspace_id: agent.workspace_id,
      agent_id: agent.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      kind: parsed.data.kind ?? 'manual',
      // Zod's z.record(z.unknown()) widens to Record<string, unknown> which
      // isn't a subtype of Json (Json's index sig allows undefined values).
      // We've already validated shape at the API boundary, so cast through.
      filter_state: (parsed.data.filter_state ?? null) as Json | null,
    })
    .select('id, name, description, kind, filter_state, created_at, updated_at, agent_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ list: { ...list, member_count: 0 } }, { status: 201 })
}
