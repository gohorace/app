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

  const { k: snippetKey, aid: anonymousId, email, meta } = parsed.data

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

  // Find the session by anonymous_id
  const { data: session } = await supabase
    .from('sessions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('anonymous_id', anonymousId)
    .maybeSingle()

  if (!session) {
    // Session not yet created (race condition) — still resolve the contact
    const matches = await resolveEmail(supabase, workspaceId, email, anonymousId, meta)
    const firstContactId = matches[0]?.contactId ?? null
    return NextResponse.json({ ok: true, contactId: firstContactId }, { headers: CORS_HEADERS })
  }

  // Resolve email → contacts via identity_map
  const matches = await resolveEmail(supabase, workspaceId, email, anonymousId, meta)

  if (matches.length === 0) {
    return NextResponse.json({ ok: true, contactId: null }, { headers: CORS_HEADERS })
  }

  // Fetch form name from the most recent form_submit event for this session
  const { data: recentFormEvent } = await supabase
    .from('events')
    .select('properties')
    .eq('session_id', session.id)
    .eq('event_type', 'form_submit')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const formName = (recentFormEvent?.properties as Record<string, unknown> | null)?.form_id as string | null

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
