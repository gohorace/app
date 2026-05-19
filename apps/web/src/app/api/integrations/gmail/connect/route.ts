/**
 * GET /api/integrations/gmail/connect
 *
 * Starts the Gmail OAuth flow. Mints an HMAC-signed state cookie that binds
 * the upcoming /callback round-trip to this agent, then 302s the user to
 * Google's consent screen.
 *
 * The state cookie is HttpOnly + SameSite=Lax + Path scoped tight to the
 * callback so it isn't leaked anywhere else. 10-minute TTL.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildGmailConsentRedirect,
  STATE_COOKIE_NAME,
  STATE_TTL_SECONDS,
} from '@/lib/email/integrations'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve the agent's id + workspace; reject agents without a workspace
  // (agent_integrations.workspace_id is NOT NULL — surface this before we
  // bounce out to Google, not after).
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()

  if (!agent || !agent.workspace_id) {
    return NextResponse.json(
      { error: 'No workspace found — finish onboarding before connecting Gmail.' },
      { status: 400 }
    )
  }

  const { url, state } = buildGmailConsentRedirect(agent.id)

  const response = NextResponse.redirect(url, { status: 302 })
  response.cookies.set({
    name: STATE_COOKIE_NAME,
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/integrations/gmail',
    maxAge: STATE_TTL_SECONDS,
  })
  return response
}
