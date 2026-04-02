// Node.js runtime — needed for Twilio (via scoring engine SMS check)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCampaignToken } from '@/lib/identity/resolver'
import { scoreEventsForContact, getOrgScoringOverrides } from '@/lib/scoring/engine'
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
  k: string       // org key (slug)
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

  const { k: orgKey, aid: anonymousId, sid: sessionId, events, s: sessionMeta } = payload

  if (!orgKey || !anonymousId || !sessionId || !Array.isArray(events)) {
    return new Response('Bad request', { status: 400, headers: CORS_HEADERS })
  }

  const supabase = createAdminClient()

  // 1. Validate org key
  const { data: org } = await supabase
    .from('orgs')
    .select('id')
    .eq('slug', orgKey)
    .maybeSingle()

  if (!org) {
    return new Response('Unknown org', { status: 404, headers: CORS_HEADERS })
  }

  const orgId = org.id

  // 2. Upsert session — create if new, update last_seen_at if existing
  const sessionUpsert: TablesInsert<'sessions'> = {
    org_id: orgId,
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
    .upsert(sessionUpsert, { onConflict: 'org_id,anonymous_id' })
    .select('id, contact_id')
    .single()

  if (sessionErr || !session) {
    console.error('Session upsert error:', sessionErr)
    return new Response('Internal error', { status: 500, headers: CORS_HEADERS })
  }

  const dbSessionId = session.id
  let contactId: string | null = session.contact_id

  // 3. Resolve campaign token if present and session not yet linked
  if (sessionMeta?.ctoken && !contactId) {
    contactId = await resolveCampaignToken(supabase, orgId, sessionMeta.ctoken, dbSessionId)
  }

  // 4. Map incoming events to DB rows
  const eventRows = events
    .filter((e) => isValidEventType(e.t))
    .map((e) => ({
      org_id: orgId,
      session_id: dbSessionId,
      contact_id: contactId,
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

  // 6. Score events if contact is identified
  if (contactId) {
    const incomingEvents: IncomingEvent[] = eventRows.map((e) => ({
      session_id: dbSessionId,
      event_type: e.event_type,
      properties: e.properties,
      occurred_at: e.occurred_at,
    }))

    const overrides = await getOrgScoringOverrides(supabase, orgId)
    scoreEventsForContact(supabase, orgId, contactId, incomingEvents, overrides).catch((err) =>
      console.error('Scoring error:', err),
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
