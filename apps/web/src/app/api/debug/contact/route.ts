import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

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
    admin.from('contacts').select('id, email, first_name, last_name, score, crm_source').eq('id', contactId).maybeSingle(),
    admin.from('identity_map').select('*').eq('contact_id', contactId),
    admin.rpc('get_contact_events', { p_contact_id: contactId }),
  ])

  // Get the agent and workspace for this contact so we can test the insert
  const { data: contactFull } = await admin.from('contacts').select('agent_id').eq('id', contactId).maybeSingle()
  const { data: agent } = contactFull?.agent_id
    ? await admin.from('agents').select('id, workspace_id').eq('id', contactFull.agent_id).maybeSingle()
    : { data: null }

  // Probe the identity_map columns in production
  const { data: imColumns } = await admin
    .from('identity_map')
    .select('*')
    .limit(1)

  // Attempt a test insert with a fake anonymous_id to surface the exact error
  const testAnonId = 'debug-test-' + Date.now()
  const { error: insertError } = await admin.from('identity_map').insert({
    workspace_id: agent?.workspace_id ?? 'unknown',
    agent_id: agent?.id ?? 'unknown',
    anonymous_id: testAnonId,
    contact_id: contactId,
    stitch_method: 'form',
    confidence: 'high',
  })

  // Clean up test row if it was inserted
  if (!insertError) {
    await admin.from('identity_map').delete().eq('anonymous_id', testAnonId)
  }

  const anonymousIds = (identityMap ?? []).map((r: Record<string, unknown>) => r.anonymous_id as string)
  const { data: sessions } = anonymousIds.length
    ? await admin.from('sessions').select('id, anonymous_id, workspace_id, last_seen_at').in('anonymous_id', anonymousIds)
    : { data: [] }

  const sessionIds = (sessions ?? []).map((s: Record<string, unknown>) => s.id as string)
  const { data: events } = sessionIds.length
    ? await admin.from('events').select('id, event_type, session_id, occurred_at').in('session_id', sessionIds).order('occurred_at', { ascending: false }).limit(20)
    : { data: [] }

  return NextResponse.json({
    contact,
    identityMap,
    imColumnsSample: imColumns,
    insertTest: insertError ? { error: insertError.message, code: insertError.code, details: insertError.details } : 'success',
    sessions,
    events,
    rpcResult,
    rpcError,
  })
}
