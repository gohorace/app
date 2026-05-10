// Node.js runtime — needed for Twilio (via scoring engine SMS check)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scoreEventsForContact, getAgentScoringOverrides } from '@/lib/scoring/engine'
import type { IncomingEvent } from '@/lib/scoring/types'
import type { Json, TablesInsert } from '@/types/database.types'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

interface TrackPayload {
  k: string       // workspace snippet_key (UUID)
  aid: string     // anonymous ID
  sid: string     // session ID
  events: Array<{
    t: string     // event type
    p: Record<string, unknown> // properties
    ts: number    // timestamp (ms)
  }>
  s?: {           // session meta (only on new sessions or when ctoken changes)
    ctoken?: string
    utm_source?: string | null
    utm_medium?: string | null
    utm_campaign?: string | null
    utm_content?: string | null
    referrer?: string | null
    is_return?: boolean
    ua?: string
  }
}

export async function POST(request: NextRequest) {
  let payload: TrackPayload

  try {
    payload = await request.json()
  } catch {
    return new Response('Bad request', { status: 400, headers: CORS_HEADERS })
  }

  const { k: snippetKey, aid: anonymousId, sid: sessionId, events, s: sessionMeta } = payload

  if (!snippetKey || !anonymousId || !sessionId || !Array.isArray(events)) {
    return new Response('Bad request', { status: 400, headers: CORS_HEADERS })
  }

  const supabase = createAdminClient()

  // 1. Validate workspace by snippet_key
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('snippet_key', snippetKey)
    .maybeSingle()

  if (!workspace) {
    return new Response('Unknown workspace', { status: 404, headers: CORS_HEADERS })
  }

  const workspaceId = workspace.id

  // 2. Upsert session — one row per tracker session (30-min window identified by `sid`).
  //    Conflict target is (workspace_id, tracker_session_id) so each distinct visit
  //    gets its own row; session_count in the contacts list reflects real visit count.
  const sessionUpsert: TablesInsert<'sessions'> = {
    workspace_id:       workspaceId,
    anonymous_id:       anonymousId,
    tracker_session_id: sessionId,
    last_seen_at:       new Date().toISOString(),
    ...(sessionMeta?.utm_source   && { utm_source:   sessionMeta.utm_source }),
    ...(sessionMeta?.utm_medium   && { utm_medium:   sessionMeta.utm_medium }),
    ...(sessionMeta?.utm_campaign && { utm_campaign: sessionMeta.utm_campaign }),
    ...(sessionMeta?.utm_content  && { utm_content:  sessionMeta.utm_content }),
    ...(sessionMeta?.referrer     && { referrer:     sessionMeta.referrer }),
    ...(sessionMeta?.ua           && { user_agent:   sessionMeta.ua }),
  }

  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .upsert(sessionUpsert, { onConflict: 'workspace_id,tracker_session_id' })
    .select('id')
    .single()

  if (sessionErr || !session) {
    console.error('Session upsert error:', sessionErr)
    return new Response('Internal error', { status: 500, headers: CORS_HEADERS })
  }

  const dbSessionId = session.id
  let contactId: string | null = null
  let agentId: string | null = null

  // 2b. Email-click stitch — if the visitor arrived via a /c/{token} link,
  //     the tracker forwards `s.ctoken`. Resolve it to a contact and write
  //     the identity_map row (last-write-wins). Errors are non-fatal —
  //     ingest still proceeds even if the token is invalid.
  if (sessionMeta?.ctoken) {
    const { error: stitchErr } = await supabase.rpc('stitch_contact_from_token', {
      p_token:        sessionMeta.ctoken,
      p_workspace_id: workspaceId,
      p_anonymous_id: anonymousId,
    })
    if (stitchErr) console.error('Tracked-link stitch error:', stitchErr)
  }

  // 3. Resolve anonymous_id → contact via identity_map
  const { data: identity } = await supabase
    .from('identity_map')
    .select('contact_id, agent_id')
    .eq('workspace_id', workspaceId)
    .eq('anonymous_id', anonymousId)
    .maybeSingle()

  if (identity) {
    contactId = identity.contact_id
    agentId   = identity.agent_id

    // Update contact's last_seen_at on every visit
    await supabase
      .from('contacts')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', contactId)
  }

  // 4. Map incoming events to DB rows
  const eventRows = events
    .filter((e) => isValidEventType(e.t))
    .map((e) => ({
      workspace_id: workspaceId,
      session_id: dbSessionId,
      event_type: e.t as IncomingEvent['event_type'],
      properties: (e.p ?? {}) as unknown as Json,
      occurred_at: e.ts ? new Date(e.ts).toISOString() : new Date().toISOString(),
    }))

  if (eventRows.length === 0) {
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
  }

  // 5. Bulk-insert events
  const { error: eventsErr } = await supabase.from('events').insert(eventRows)

  if (eventsErr) {
    console.error('Events insert error:', eventsErr)
    return new Response('Internal error', { status: 500, headers: CORS_HEADERS })
  }

  // 6. Score events if contact + agent are identified
  if (contactId && agentId) {
    const incomingEvents: IncomingEvent[] = eventRows.map((e) => ({
      session_id: dbSessionId,
      event_type: e.event_type,
      properties: e.properties,
      occurred_at: e.occurred_at,
    }))

    const overrides = await getAgentScoringOverrides(supabase, agentId)
    // Await scoring — fire-and-forget causes "fetch failed" in Vercel as the
    // function is killed before the in-flight Supabase request completes
    await scoreEventsForContact(supabase, agentId, contactId, incomingEvents, overrides).catch(
      (err) => console.error('Scoring error:', err),
    )
  }

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
}

const VALID_EVENT_TYPES = new Set([
  'page_view', 'property_view', 'form_submit',
  'scroll_depth', 'return_visit',
])

function isValidEventType(t: unknown): t is string {
  return typeof t === 'string' && VALID_EVENT_TYPES.has(t)
}
