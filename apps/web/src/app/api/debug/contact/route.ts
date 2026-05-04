import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// Temporary debug endpoint — remove after diagnosing activity timeline issue
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contactId = request.nextUrl.searchParams.get('id')
  if (!contactId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const admin = createAdminClient()

  const [
    { data: contact },
    { data: identityMap },
    { data: rpcResult, error: rpcError },
  ] = await Promise.all([
    admin.from('contacts').select('id, email, first_name, last_name, score').eq('id', contactId).maybeSingle(),
    admin.from('identity_map').select('anonymous_id, workspace_id, agent_id, stitch_method').eq('contact_id', contactId),
    admin.rpc('get_contact_events', { p_contact_id: contactId }),
  ])

  const anonymousIds = (identityMap ?? []).map(r => r.anonymous_id)

  const { data: sessions } = anonymousIds.length
    ? await admin.from('sessions').select('id, anonymous_id, workspace_id, last_seen_at').in('anonymous_id', anonymousIds)
    : { data: [] }

  const sessionIds = (sessions ?? []).map(s => s.id)

  const { data: events } = sessionIds.length
    ? await admin.from('events').select('id, event_type, session_id, occurred_at, score_delta').in('session_id', sessionIds).order('occurred_at', { ascending: false }).limit(20)
    : { data: [] }

  return NextResponse.json({
    contact,
    identityMap,
    sessions,
    events,
    rpcResult,
    rpcError,
  })
}
