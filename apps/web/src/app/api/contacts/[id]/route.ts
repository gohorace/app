import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // ?include_deleted=true lets the restore flow fetch a soft-deleted contact
  // for the "Restore Sarah?" confirmation surface. Default reads hide them.
  const includeDeleted = req.nextUrl.searchParams.get('include_deleted') === 'true'

  const contactQuery = admin
    .from('contacts')
    .select(
      'id, first_name, last_name, full_name_raw, email, phone, score, last_seen_at, ' +
        'property_address, suburb, source, medium, deleted_at, residence_property_id',
    )
    .eq('id', params.id)
    .eq('agent_id', agent.id)

  const [{ data: contact }, { data: events }, { data: scoreHistory }] = await Promise.all([
    (includeDeleted ? contactQuery : contactQuery.is('deleted_at', null)).maybeSingle(),
    admin.rpc('get_contact_events', { p_contact_id: params.id }),
    admin
      .from('score_history')
      .select('id, delta, reason, score_after, occurred_at')
      .eq('contact_id', params.id)
      .eq('agent_id', agent.id)
      .order('occurred_at', { ascending: false })
      .limit(30),
  ])

  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Phase 2c: enrich with the joined residence property when set. Falls back
  // to the legacy contacts.property_address text for un-migrated rows.
  let residenceProperty:
    | {
        id: string
        street_number: string | null
        street_name: string | null
        suburb: string | null
        state: string | null
        postcode: string | null
        status: string | null
      }
    | null = null

  if (contact.residence_property_id) {
    const { data: property } = await admin
      .from('properties')
      .select('id, street_number, street_name, suburb, state, postcode, status')
      .eq('id', contact.residence_property_id)
      .is('deleted_at', null)
      .maybeSingle()
    residenceProperty = property ?? null
  }

  return NextResponse.json({
    contact,
    residence_property: residenceProperty,
    events: events ?? [],
    scoreHistory: scoreHistory ?? [],
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()

  // Allowlist of patchable fields
  const allowed = ['property_address', 'suburb', 'first_name', 'last_name', 'email', 'phone'] as const
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Refuse edits on soft-deleted contacts. Restore first, then edit.
  const { error } = await admin
    .from('contacts')
    .update(update)
    .eq('id', params.id)
    .eq('agent_id', agent.id) // scoped — agent can only update their own contacts
    .is('deleted_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/contacts/:id            → soft delete (sets deleted_at = now())
 * DELETE /api/contacts/:id?hard=true  → hard delete; CASCADE FKs handle the rest:
 *                                        events, identified_devices, identity_map,
 *                                        score_history, campaign_tokens,
 *                                        contact_tracked_links, contact_roles,
 *                                        contact_property_relationships,
 *                                        ownership_history all delete with the row.
 *                                        notification_log / enquiries are SET NULL
 *                                        on contact_id so audit history survives.
 *
 * 30-day-old soft-deleted contacts are swept by /api/cron/purge-soft-deleted.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Ownership check via agent_id; matches PATCH behaviour. Phase 4 swaps to
  // owner_agent_id + visibility/permission function.
  const { data: existing } = await admin
    .from('contacts')
    .select('id, deleted_at')
    .eq('id', params.id)
    .eq('agent_id', agent.id)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const hard = req.nextUrl.searchParams.get('hard') === 'true'

  if (hard) {
    const { error } = await admin
      .from('contacts')
      .delete()
      .eq('id', params.id)
      .eq('agent_id', agent.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, mode: 'hard' })
  }

  // Soft delete: idempotent. Re-deleting an already-deleted contact is a no-op
  // (doesn't reset the 30-day clock).
  if (existing.deleted_at) {
    return NextResponse.json({ ok: true, mode: 'soft', already_deleted_at: existing.deleted_at })
  }

  const now = new Date().toISOString()
  const { error } = await admin
    .from('contacts')
    .update({ deleted_at: now })
    .eq('id', params.id)
    .eq('agent_id', agent.id)
    .is('deleted_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mode: 'soft', deleted_at: now })
}
