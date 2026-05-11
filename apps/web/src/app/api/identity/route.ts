import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEmail } from '@/lib/identity/resolver'
import { scoreEventsForContact, getAgentScoringOverrides } from '@/lib/scoring/engine'
import { sendFormSubmitSms } from '@/lib/notifications/sms'
import type { IncomingEvent } from '@/lib/scoring/types'
import { z } from 'zod'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

const schema = z.object({
  k: z.string().uuid(),         // workspace snippet_key
  aid: z.string().uuid(),       // anonymous ID
  sid: z.string().uuid(),       // session ID from tracker
  email: z.string().email(),
  meta: z.object({
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    phone: z.string().max(50).optional(),
  }).optional(),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('Bad request', { status: 400, headers: CORS_HEADERS })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return new Response('Bad request', { status: 400, headers: CORS_HEADERS })
  }

  const { k: snippetKey, aid: anonymousId, sid: sessionId, email, meta } = parsed.data

  const supabase = createAdminClient()

  // Validate workspace by snippet_key
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('snippet_key', snippetKey)
    .maybeSingle()

  if (!workspace) {
    return new Response('Unknown workspace', { status: 404, headers: CORS_HEADERS })
  }

  const workspaceId = workspace.id

  // Upsert session — creates it if the tracker hasn't flushed yet (race condition).
  // Uses tracker_session_id as conflict target so each 30-min visit gets its own row.
  const { data: session, error: sessionErr } = await supabase
    .from('sessions')
    .upsert(
      { workspace_id: workspaceId, anonymous_id: anonymousId, tracker_session_id: sessionId, last_seen_at: new Date().toISOString() },
      { onConflict: 'workspace_id,tracker_session_id' },
    )
    .select('id')
    .single()

  if (sessionErr || !session) {
    console.error('[identity] session upsert error:', sessionErr)
    return new Response('Internal error', { status: 500, headers: CORS_HEADERS })
  }

  // Resolve email → contacts via identity_map (also writes identified_devices).
  // UA from the request is fed through to identified_devices.user_agent_summary.
  const userAgent = request.headers.get('user-agent')
  const matches = await resolveEmail(supabase, workspaceId, email, anonymousId, meta, userAgent)

  if (matches.length === 0) {
    return NextResponse.json({ ok: true, contactId: null }, { headers: CORS_HEADERS })
  }

  // Ensure a form_submit event row exists for this session so the activity timeline shows it.
  // The tracker queues one via /api/t but CORS failures can drop it — insert here as the
  // authoritative record since identity resolution confirms the submission happened.
  const { data: existingFormEvent } = await supabase
    .from('events')
    .select('id, properties')
    .eq('session_id', session.id)
    .eq('event_type', 'form_submit')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!existingFormEvent) {
    await supabase.from('events').insert({
      workspace_id: workspaceId,
      session_id: session.id,
      event_type: 'form_submit',
      properties: {},
    })
  }

  const formName = (existingFormEvent?.properties as Record<string, unknown> | null)?.form_id as string | null

  // Score and notify for each matched agent/contact pair
  for (const { agentId, contactId } of matches) {
    const incomingEvents: IncomingEvent[] = [{
      session_id: session.id,
      event_type: 'form_submit',
      properties: { form_id: formName },
    }]

    // Score the form_submit event — await so backfill runs after and sees updated scoreBefore
    const overrides = await getAgentScoringOverrides(supabase, agentId)
    await scoreEventsForContact(supabase, agentId, contactId, incomingEvents, overrides).catch(
      (err) => console.error('Identity scoring error:', err),
    )

    // Await SMS — fire-and-forget is killed by Vercel before Twilio fetch completes
    await sendFormSubmitSms(supabase, agentId, contactId, formName).catch(
      (err) => console.error('Form submit SMS error:', err),
    )
  }

  const firstContactId = matches[0].contactId
  return NextResponse.json({ ok: true, contactId: firstContactId }, { headers: CORS_HEADERS })
}
