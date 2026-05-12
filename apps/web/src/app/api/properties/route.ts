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
 * Note: we kept status='residence_only' rather than introducing a new
 * 'manual' enum value. No current consumer queries on status, and we can
 * add the value later if a filtering surface needs it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveResidence, type SelectedAddressInput } from '@/lib/contacts/residence'

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
