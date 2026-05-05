import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
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
  const { first_name, last_name, email, phone } = body as {
    first_name?: string
    last_name?: string
    email?: string
    phone?: string
  }

  if (!first_name && !email) {
    return NextResponse.json({ error: 'Provide at least a name or email' }, { status: 400 })
  }

  // Prevent duplicate email
  if (email) {
    const { data: existing } = await admin
      .from('contacts')
      .select('id')
      .eq('agent_id', agent.id)
      .eq('email', email.toLowerCase().trim())
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'A contact with this email already exists' }, { status: 409 })
    }
  }

  const { data, error } = await admin
    .from('contacts')
    .insert({
      agent_id:   agent.id,
      first_name: first_name?.trim() || null,
      last_name:  last_name?.trim()  || null,
      email:      email?.toLowerCase().trim() || null,
      phone:      phone?.trim() || null,
      crm_source: 'manual',
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create contact' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id }, { status: 201 })
}
