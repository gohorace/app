/**
 * HOR-120 — POST /api/properties
 *
 * Creates a property directly (rather than as a side-effect of contact
 * resolution). Used by the manual property creation surface
 * (/properties/new) where an agent records an address before any contact
 * or web tracking exists — typically appraisal targets.
 *
 * Body:
 *   { residence: SelectedAddress, notes?: string }
 *
 * The address is resolved through the same `resolve_residence_property`
 * RPC as the contact form — meaning entering an address that already
 * exists in the workspace's properties table (from a contact's residence
 * or listing parsing) just returns the existing id. The response notes
 * how many contacts (if any) already reference the property so the UI
 * can surface a "this address is already linked to X" message.
 *
 * HOR-135: resolve_residence_property() now inserts new rows with
 * status='watching' (was 'residence_only'). Callers that want a
 * different state (Listed / Appraising / Sold) PATCH after create.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveResidence, type SelectedAddressInput } from '@/lib/contacts/residence'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

/**
 * HOR-125 — GET /api/properties
 *
 * Lists properties in the caller's workspace. Used by:
 *  - Add Contact modal's role picker (Seller/Buyer of which property?)
 *  - Future: Properties list page (HOR-126)
 *
 * Excludes soft-deleted rows. No pagination yet — caps at 100 results.
 * If a workspace grows past 100 properties we'll add a `?q=` search param
 * and cursor pagination.
 */
export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id)

  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'No workspace for user' }, { status: 400 })
  }

  const { data: properties, error } = await admin
    .from('properties')
    .select('id, street_number, street_name, suburb, state, postcode, status, last_activity_at')
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ properties: properties ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id)

  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'No workspace for user' }, { status: 400 })
  }

  const body = await req.json() as { residence?: SelectedAddressInput | null }
  const residence = body.residence

  if (!residence) {
    return NextResponse.json({ error: 'residence is required' }, { status: 400 })
  }

  // Empty-shape guard — must have at least one identifying field.
  const hasAnyAddress =
    Boolean(residence.google_place_id) ||
    Boolean(residence.street_number) ||
    Boolean(residence.street_name)   ||
    Boolean(residence.suburb)        ||
    Boolean(residence.postcode)      ||
    Boolean(residence.formatted)

  if (!hasAnyAddress) {
    return NextResponse.json({ error: 'Address is empty' }, { status: 400 })
  }

  const { propertyId, error } = await resolveResidence(admin, agent.workspace_id, residence)
  if (error) {
    return NextResponse.json({ error: `Address resolution failed: ${error}` }, { status: 500 })
  }
  if (!propertyId) {
    return NextResponse.json({ error: 'Could not resolve the address' }, { status: 422 })
  }

  // Surface whether this address is already linked to any contacts —
  // lets the UI say "this address is already on file with N contact(s)".
  const { count: linkedContacts } = await admin
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('residence_property_id', propertyId)
    .is('deleted_at', null)

  return NextResponse.json({
    id: propertyId,
    linked_contacts: linkedContacts ?? 0,
  }, { status: 201 })
}
