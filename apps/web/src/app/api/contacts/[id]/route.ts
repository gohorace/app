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

  const [{ data: contact }, { data: events }, { data: scoreHistory }] = await Promise.all([
    admin
      .from('contacts')
      .select('id, first_name, last_name, email, phone, score, last_seen_at, property_address, suburb, crm_source, notes')
      .eq('id', params.id)
      .eq('agent_id', agent.id)
      .maybeSingle(),
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

  return NextResponse.json({ contact, events: events ?? [], scoreHistory: scoreHistory ?? [] })
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
  const allowed = ['property_address', 'suburb', 'first_name', 'last_name', 'email', 'phone', 'notes'] as const
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await admin
    .from('contacts')
    .update(update)
    .eq('id', params.id)
    .eq('agent_id', agent.id) // scoped — agent can only update their own contacts

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
