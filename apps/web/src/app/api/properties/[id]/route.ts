/**
 * HOR-126 — Single-property CRUD.
 *
 *   GET    /api/properties/:id   → property + linked contacts + recent events
 *   PATCH  /api/properties/:id   → status / notes (notes stored on metadata)
 *   DELETE /api/properties/:id   → soft delete (deleted_at = now())
 *
 * All operations are scoped to the caller's workspace.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRoles } from '@/lib/contacts/roles'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

// HOR-135 — V1 relationship-first vocabulary. Migration
// 20260514000001_property_state_v1.sql tightens the CHECK constraint to
// exactly these four values.
const PropertyStatusEnum = z.enum(['listed', 'appraising', 'watching', 'sold'])

// HOR-130: per-property notes stored at metadata.notes. Hard-capped at
// 2000 chars to keep the JSONB row a sensible size.
const PatchSchema = z.object({
  status: PropertyStatusEnum.optional(),
  notes:  z.string().max(2000).nullable().optional(),
})

async function resolveAgent(userId: string) {
  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, userId)
  return { admin, agent }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { admin, agent } = await resolveAgent(user.id)
  if (!agent?.workspace_id) {
    return NextResponse.json({ error: 'No workspace for user' }, { status: 400 })
  }

  const { data: property } = await admin
    .from('properties')
    // HOR-130: metadata column added by 20260514000002 migration.
    // Excluded from this select for graceful behaviour pre-migration —
    // callers wanting notes should query separately (the detail page
    // already does this defensively).
    .select('id, street_number, street_name, suburb, state, postcode, property_type, status, first_seen_at, last_activity_at, created_at, updated_at')
    .eq('id', params.id)
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!property) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Linked contacts: residence + role attachments. We fetch all contacts in
  // the agent's book and filter client-side because the role link lives in
  // metadata.roles (no FK index). This is fine at workspace scale; if it
  // gets slow we can move to a GIN index on contacts.metadata.
  const { data: contacts } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email, phone, score, last_seen_at, residence_property_id, metadata, source')
    .eq('agent_id', agent.id)
    .is('deleted_at', null)

  const linkedContacts = (contacts ?? []).filter((c) => {
    if (c.residence_property_id === property.id) return true
    return getRoles(c.metadata).some((r) => r.property_id === property.id)
  })

  // Events for this property come from the events table joined on
  // `properties->>property_id`. The events RPC operates per-contact, not
  // per-property, so we issue a direct query.
  const { data: events } = await admin
    .from('events')
    .select('id, event_type, properties, score_delta, occurred_at')
    .eq('workspace_id', agent.workspace_id)
    .filter('properties->>property_id', 'eq', property.id)
    .order('occurred_at', { ascending: false })
    .limit(40)

  return NextResponse.json({
    property,
    linked_contacts: linkedContacts,
    events: events ?? [],
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { admin, agent } = await resolveAgent(user.id)
  if (!agent?.workspace_id) {
    return NextResponse.json({ error: 'No workspace for user' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.format() },
      { status: 400 },
    )
  }

  const update: Record<string, unknown> = {}
  if (parsed.data.status !== undefined) {
    update.status = parsed.data.status
  }

  // HOR-130: notes round-trip through metadata.notes. Read-modify-write
  // to preserve any other keys callers might add to metadata later.
  if (parsed.data.notes !== undefined) {
    const { data: current, error: readErr } = await admin
      .from('properties')
      .select('metadata')
      .eq('id', params.id)
      .eq('workspace_id', agent.workspace_id)
      .is('deleted_at', null)
      .maybeSingle()

    if (readErr || !current) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 })
    }

    const base = (current.metadata && typeof current.metadata === 'object')
      ? { ...(current.metadata as Record<string, unknown>) }
      : {}
    const trimmed = parsed.data.notes?.trim()
    if (parsed.data.notes === null || !trimmed) {
      delete base.notes
    } else {
      base.notes = trimmed
    }
    update.metadata = base
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await admin
    .from('properties')
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

  const { admin, agent } = await resolveAgent(user.id)
  if (!agent?.workspace_id) {
    return NextResponse.json({ error: 'No workspace for user' }, { status: 400 })
  }

  // Soft delete only — properties referenced by contacts.residence_property_id
  // shouldn't disappear from history. The 30-day purge cron handles hard
  // deletes once nothing's referencing them.
  const now = new Date().toISOString()
  const { error } = await admin
    .from('properties')
    .update({ deleted_at: now })
    .eq('id', params.id)
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, deleted_at: now })
}
