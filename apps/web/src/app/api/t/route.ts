// Node.js runtime — needed for Twilio (via scoring engine SMS check)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCampaignToken } from '@/lib/identity/resolver'
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

  // 2. Upsert session — create if new, update last_seen_at if existing
  const sessionUpsert: TablesInsert<'sessions'> = {
    workspace_id: workspaceId,
    anonymous_id: anonymousId,
    last_seen_at: new Date().toISOString(),
    ...(sessionMeta?.ctoken && { campaign_token: sessionMeta.ctoken }),
    ...(sessionMeta?.utm_source && { utm_source: sessionMeta.utm_source }),
    ...(sessionMeta?.utm_medium && { utm_medium: sessionMeta.utm_medium }),
    ...(sessionMeta?.utm_campaign && { utm_campaign: sessionMeta.utm_campaign }),
    ...(sessionMeta?.utm_content && { utm_content: sessionMeta.utm_content }),
    ...(sessionMeta?.referrer && { referrer: sessionMeta.referrer }),
    ...(sessionMeta?.ua && { user_agent: sessionMeta.ua }),
  }

  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .upsert(sessionUpsert, { onConflict: 'workspace_id,anonymous_id' })
    .select('id')
    .single()

  if (sessionErr || !session) {
    console.error('Session upsert error:', sessionErr)
    return new Response('Internal error', { status: 500, headers: CORS_HEADERS })
  }

  const dbSessionId = session.id
  let contactId: string | null = null
  let agentId: string | null = null

  // 3. Resolve campaign token if present
  if (sessionMeta?.ctoken) {
    // Look up agent_id from campaign_tokens table
    const { data: tokenRow } = await supabase
      .from('campaign_tokens')
      .select('agent_id')
      .eq('token', sessionMeta.ctoken)
      .maybeSingle()

    if (tokenRow?.agent_id) {
      agentId = tokenRow.agent_id
      contactId = await resolveCampaignToken(supabase, workspaceId, agentId, sessionMeta.ctoken, anonymousId)
    }
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

  // 5. Bulk insert events
  const { error: eventsErr } = await supabase.from('events').insert(eventRows)

  if (eventsErr) {
    console.error('Events insert error:', eventsErr)
    return new Response('Internal error', { status: 500, headers: CORS_HEADERS })
  }

  // 6. Score events if contact and agent are identified
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
  'scroll_depth', 'return_visit', 'campaign_click',
])

function isValidEventType(t: unknown): t is string {
  return typeof t === 'string' && VALID_EVENT_TYPES.has(t)
}
