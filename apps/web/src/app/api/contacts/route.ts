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

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const { first_name, last_name, email, phone, residence } = body as {
    first_name?: string
    last_name?: string
    email?: string
    phone?: string
    residence?: SelectedAddressInput | null
  }

  if (!first_name && !email) {
    return NextResponse.json({ error: 'Provide at least a name or email' }, { status: 400 })
  }

  // Prevent duplicate email. Ignore soft-deleted rows so the email can be
  // re-used; the old row will be purged within the 30-day window or the
  // agent can explicitly restore it.
  if (email) {
    const { data: existing } = await admin
      .from('contacts')
      .select('id')
      .eq('agent_id', agent.id)
      .eq('email', email.toLowerCase().trim())
      .is('deleted_at', null)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'A contact with this email already exists' }, { status: 409 })
    }
  }

  // Slice 4: resolve residence address to a property id when provided.
  // contacts.suburb is auto-populated from properties.suburb by the
  // sync_contact_suburb trigger (Slice 1). Legacy property_address /
  // suburb columns are no longer written on create.
  let residencePropertyId: string | null = null
  if (residence && agent.workspace_id) {
    const result = await resolveResidence(admin, agent.workspace_id, residence)
    if (result.error) {
      return NextResponse.json(
        { error: `Address resolution failed: ${result.error}` },
        { status: 500 },
      )
    }
    residencePropertyId = result.propertyId
  }

  const { data, error } = await admin
    .from('contacts')
    .insert({
      agent_id:              agent.id,
      first_name:            first_name?.trim() || null,
      last_name:             last_name?.trim()  || null,
      email:                 email?.toLowerCase().trim() || null,
      phone:                 phone?.trim() || null,
      source: 'manual',
      residence_property_id: residencePropertyId,
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create contact' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id }, { status: 201 })
}
