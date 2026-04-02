import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEmail } from '@/lib/identity/resolver'
import { scoreEventsForContact, getOrgScoringOverrides } from '@/lib/scoring/engine'
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
  k: z.string().min(1),         // org key
  aid: z.string().uuid(),       // anonymous ID
  sid: z.string().uuid(),       // session ID from tracker
  email: z.string().email(),
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

  const { k: orgKey, aid: anonymousId, email } = parsed.data

  const supabase = createAdminClient()

  // Validate org
  const { data: org } = await supabase
    .from('orgs')
    .select('id')
    .eq('slug', orgKey)
    .maybeSingle()

  if (!org) {
    return new Response('Unknown org', { status: 404, headers: CORS_HEADERS })
  }

  const orgId = org.id

  // Find the session by anonymous_id (the tracker's sid might differ from DB session id)
  const { data: session } = await supabase
    .from('sessions')
    .select('id, contact_id')
    .eq('org_id', orgId)
    .eq('anonymous_id', anonymousId)
    .maybeSingle()

  if (!session) {
    // Session not yet created (race condition) — still create/find the contact
    const contactId = await resolveEmail(supabase, orgId, email, '')
    return NextResponse.json({ ok: true, contactId }, { headers: CORS_HEADERS })
  }

  // Already identified — nothing to do
  if (session.contact_id) {
    return NextResponse.json({ ok: true, contactId: session.contact_id }, { headers: CORS_HEADERS })
  }

  // Resolve email → contact and link session
  const contactId = await resolveEmail(supabase, orgId, email, session.id)

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

  // Score the form_submit event — await so backfill (triggered inside resolveEmail)
  // runs after and sees the updated scoreBefore, ensuring threshold crossing is detected
  const incomingEvents: IncomingEvent[] = [{
    session_id: session.id,
    event_type: 'form_submit',
    properties: { form_id: formName },
  }]
  const overrides = await getOrgScoringOverrides(supabase, orgId)
  await scoreEventsForContact(supabase, orgId, contactId, incomingEvents, overrides).catch(
    (err) => console.error('Identity scoring error:', err),
  )

  // SMS for form submit (non-blocking)
  sendFormSubmitSms(supabase, orgId, contactId, formName).catch(
    (err) => console.error('Form submit SMS error:', err),
  )

  return NextResponse.json({ ok: true, contactId }, { headers: CORS_HEADERS })
}
