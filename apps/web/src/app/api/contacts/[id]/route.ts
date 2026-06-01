import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveResidence, type SelectedAddressInput } from '@/lib/contacts/residence'
import { getRoles, withRoleAdded, withRoleRemoved } from '@/lib/contacts/roles'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

// Body shape for role mutations. Caller sends one of:
//   - `{ add_role: { type, property_id, date? } }`         — append/replace
//   - `{ remove_role_id: '<uuid>' }`                       — remove by id
const AddRoleSchema = z.object({
  type: z.enum(['seller', 'buyer', 'landlord']),
  property_id: z.string().uuid(),
  date: z.string().datetime({ offset: true }).optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id)

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // HOR-203: support seats see signals for their assigned agent(s).
  const { getSeatPermissions } = await import('@/lib/seats/permissions')
  const seats = await getSeatPermissions(admin, user.id)
  const allowedAgentIds =
    seats.allowedAgentIds.length > 0 ? seats.allowedAgentIds : [agent.id]

  // ?include_deleted=true lets the restore flow fetch a soft-deleted contact
  // for the "Restore Sarah?" confirmation surface. Default reads hide them.
  const includeDeleted = req.nextUrl.searchParams.get('include_deleted') === 'true'

  const contactQuery = admin
    .from('contacts')
    .select('id, first_name, last_name, full_name_raw, email, phone, score, last_seen_at, property_address, suburb, source, medium, deleted_at, residence_property_id, metadata')
    .eq('id', params.id)
    .in('agent_id', allowedAgentIds)

  const [{ data: contact }, { data: events }, { data: scoreHistory }] = await Promise.all([
    (includeDeleted ? contactQuery : contactQuery.is('deleted_at', null)).maybeSingle(),
    admin.rpc('get_contact_events', { p_contact_id: params.id }),
    admin
      .from('score_history')
      .select('id, delta, reason, score_after, occurred_at')
      .eq('contact_id', params.id)
      .in('agent_id', allowedAgentIds)
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

  // Roles: parsed safely from metadata. For each role, fetch the linked
  // property so the detail page can render the role-attached card without
  // an extra round-trip.
  const roles = getRoles(contact.metadata)
  let roleProperties: Array<{
    id: string
    street_number: string | null
    street_name: string | null
    suburb: string | null
    state: string | null
    postcode: string | null
    status: string | null
  }> = []
  if (roles.length > 0) {
    const { data: props } = await admin
      .from('properties')
      .select('id, street_number, street_name, suburb, state, postcode, status')
      .in('id', roles.map((r) => r.property_id))
      .is('deleted_at', null)
    roleProperties = props ?? []
  }

  return NextResponse.json({
    contact,
    residence_property: residenceProperty,
    events: events ?? [],
    scoreHistory: scoreHistory ?? [],
    roles,
    role_properties: roleProperties,
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
  const agent = await resolvePrimaryAgent(admin, user.id)

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // HOR-203: support seats can action signals on contacts owned by
  // their assigned agent(s). Resolve allowed agent IDs once; reuse
  // for every ownership filter below.
  const { getSeatPermissions } = await import('@/lib/seats/permissions')
  const seats = await getSeatPermissions(admin, user.id)
  const allowedAgentIds =
    seats.allowedAgentIds.length > 0 ? seats.allowedAgentIds : [agent.id]

  const body = await req.json() as Record<string, unknown>

  // Slice 4: the legacy property_address / suburb columns are no longer
  // patchable directly. The address path is `residence: SelectedAddress | null`
  // which is resolved through resolve_residence_property and written to
  // contacts.residence_property_id. contacts.suburb is then auto-maintained
  // by the sync_contact_suburb trigger from Slice 1.
  const allowed = ['first_name', 'last_name', 'email', 'phone'] as const
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  // HOR-130 follow-up: per-contact notes. Stored at contacts.metadata.notes
  // (mirrors the properties.metadata.notes pattern in HOR-130). The types
  // file claims a top-level `notes` column, but the actual migrations never
  // created one — metadata is the safe home.
  //
  // Validated separately from add_role/remove_role_id because that block
  // does its own read-modify-write on metadata. We piggy-back into that
  // block below when the only mutation is notes.
  const hasNotesUpdate = 'notes' in body
  let notesValue: string | null | undefined = undefined
  if (hasNotesUpdate) {
    const raw = body.notes
    if (raw === null) {
      notesValue = null
    } else if (typeof raw === 'string') {
      const trimmed = raw.slice(0, 2000).trim()
      notesValue = trimmed.length === 0 ? null : trimmed
    } else {
      return NextResponse.json({ error: 'Invalid notes value' }, { status: 400 })
    }
  }

  // HOR-125 + HOR-130: metadata-bucket mutations. Three flavours, all
  // sharing the same read-modify-write so concurrent updates don't clobber
  // unrelated keys:
  //   { add_role: { type: 'seller'|'buyer', property_id: uuid, date? } }
  //   { remove_role_id: uuid }
  //   { notes: string | null }   → metadata.notes
  const hasAddRole    = 'add_role' in body && body.add_role !== null
  const hasRemoveRole = 'remove_role_id' in body && body.remove_role_id !== null
  if (hasAddRole || hasRemoveRole || hasNotesUpdate) {
    const { data: current, error: readErr } = await admin
      .from('contacts')
      .select('metadata')
      .eq('id', params.id)
      .in('agent_id', allowedAgentIds)
      .is('deleted_at', null)
      .maybeSingle()

    if (readErr || !current) {
      return NextResponse.json(
        { error: 'Contact not found or already deleted' },
        { status: 404 },
      )
    }

    let nextMetadata: Record<string, unknown> = (current.metadata as Record<string, unknown>) ?? {}

    if (hasAddRole) {
      const parsed = AddRoleSchema.safeParse(body.add_role)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid add_role payload', details: parsed.error.format() },
          { status: 400 },
        )
      }
      nextMetadata = withRoleAdded(nextMetadata, parsed.data)
    }
    if (hasRemoveRole) {
      const idCheck = z.string().uuid().safeParse(body.remove_role_id)
      if (!idCheck.success) {
        return NextResponse.json({ error: 'Invalid remove_role_id' }, { status: 400 })
      }
      nextMetadata = withRoleRemoved(nextMetadata, idCheck.data)
    }
    if (hasNotesUpdate) {
      if (notesValue === null) {
        delete nextMetadata.notes
      } else {
        nextMetadata = { ...nextMetadata, notes: notesValue }
      }
    }

    update.metadata = nextMetadata
  }

  // Handle residence separately. Three cases:
  //   • key absent → leave residence_property_id alone
  //   • key === null → clear residence_property_id (trigger clears suburb)
  //   • key === SelectedAddress object → resolve to property id and write
  const hasResidence = 'residence' in body
  if (hasResidence) {
    const residence = body.residence as SelectedAddressInput | null

    if (residence === null) {
      update.residence_property_id = null
    } else if (residence && agent.workspace_id) {
      const result = await resolveResidence(admin, agent.workspace_id, residence)
      if (result.error) {
        return NextResponse.json(
          { error: `Address resolution failed: ${result.error}` },
          { status: 500 },
        )
      }
      update.residence_property_id = result.propertyId
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Refuse edits on soft-deleted contacts. Restore first, then edit.
  // HOR-203: ownership scope expanded — support seats can action signals
  // on contacts owned by their assigned agent(s) (allowedAgentIds).
  const { error } = await admin
    .from('contacts')
    .update(update)
    .eq('id', params.id)
    .in('agent_id', allowedAgentIds)
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
  const agent = await resolvePrimaryAgent(admin, user.id)

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
