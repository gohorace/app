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

  const { data: contact } = await admin
    .from('contacts')
    .select('id, email, first_name, last_name, score, source, medium, agent_id, identified_at, last_seen_at')
    .eq('id', contactId)
    .maybeSingle()

  const { data: agent } = contact?.agent_id
    ? await admin.from('agents').select('id, workspace_id').eq('id', contact.agent_id).maybeSingle()
    : { data: null }

  // All identity_map rows for this contact
  const { data: identityMap, error: imReadError } = await admin
    .from('identity_map')
    .select('*')
    .eq('contact_id', contactId)

  // Recent sessions in this workspace (last 2 hours) to find the anonymous_id
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: recentSessions } = agent?.workspace_id
    ? await admin.from('sessions').select('id, anonymous_id, last_seen_at')
        .eq('workspace_id', agent.workspace_id)
        .gte('last_seen_at', since)
        .order('last_seen_at', { ascending: false })
        .limit(10)
    : { data: [] }

  // Try inserting identity_map with the most recent session's anonymous_id
  const mostRecentSession = recentSessions?.[0]
  let realInsertTest: unknown = 'no recent session found'
  if (mostRecentSession && agent && agent.workspace_id) {
    const { error: realInsertError } = await admin.from('identity_map').insert({
      workspace_id: agent.workspace_id,
      agent_id: agent.id,
      anonymous_id: mostRecentSession.anonymous_id + '-debug',
      contact_id: contactId,
      stitch_method: 'form',
      confidence: 'high',
    })
    if (!realInsertError) {
      await admin.from('identity_map').delete()
        .eq('anonymous_id', mostRecentSession.anonymous_id + '-debug')
      realInsertTest = 'success'
    } else {
      realInsertTest = { error: realInsertError.message, code: realInsertError.code, details: realInsertError.details, hint: realInsertError.hint }
    }
  }

  // Check if session anonymous_ids are already mapped to OTHER contacts (explains 23505 silent failure)
  const sessionAnonIds = (recentSessions ?? []).map(s => s.anonymous_id)
  const { data: conflictingMappings } = sessionAnonIds.length
    ? await admin.from('identity_map')
        .select('anonymous_id, contact_id, agent_id')
        .in('anonymous_id', sessionAnonIds)
    : { data: [] }

  // Score history
  const { data: scoreHistory } = await admin
    .from('score_history')
    .select('delta, reason, occurred_at')
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })
    .limit(5)

  // Events via the known session IDs
  const sessionIds = (recentSessions ?? []).map(s => s.id)
  const { data: events } = sessionIds.length
    ? await admin.from('events').select('id, event_type, session_id, occurred_at')
        .in('session_id', sessionIds).order('occurred_at', { ascending: false }).limit(20)
    : { data: [] }

  return NextResponse.json({
    contact,
    agent,
    identityMap,
    imReadError,
    recentSessions,
    conflictingMappings,
    realInsertTest,
    scoreHistory,
    events,
  })
}
