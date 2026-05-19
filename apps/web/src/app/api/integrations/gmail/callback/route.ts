/**
 * GET /api/integrations/gmail/callback?code=…&state=…
 *
 * Endpoint Google redirects back to after the user grants (or denies) the
 * consent screen. Validates the state cookie, exchanges the auth code,
 * stores the refresh_token in Vault, upserts agent_integrations, then
 * redirects to /settings/integrations with a status query param.
 *
 * Failure modes (each renders a distinct query param the page surfaces):
 *   - ?error=consent_denied         — user clicked Cancel on Google's screen
 *   - ?error=invalid_state          — state cookie missing / forged / expired
 *   - ?error=workspace_admin_blocked — Google Workspace admin policy blocked
 *   - ?error=refresh_revoked         — token rejected (rare on initial consent)
 *   - ?error=unexpected              — anything else (logged server-side)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  completeGmailConsent,
  verifyState,
  STATE_COOKIE_NAME,
} from '@/lib/email/integrations'
import {
  RefreshRevokedError,
  WorkspaceAdminBlockedError,
} from '@/lib/email/gmail'
import { getAppUrl } from '@/lib/url'

function settingsRedirect(query: string): NextResponse {
  const appUrl = getAppUrl()
  const target = `${appUrl}/settings/integrations${query}`
  const res = NextResponse.redirect(target, { status: 302 })
  // Always clear the state cookie on the way out so it can't be replayed.
  res.cookies.set({
    name: STATE_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/integrations/gmail',
    maxAge: 0,
  })
  return res
}

export async function GET(req: NextRequest) {
  // ── User session check (we already auth'd them before /connect; they
  //    should still have a session here unless they were logged out mid-flow). ──
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return settingsRedirect('?error=invalid_state')
  }

  // ── Google-side error (user denied, admin block, etc.) ──
  const searchParams = req.nextUrl.searchParams
  const googleError = searchParams.get('error')
  if (googleError) {
    // Specifically map admin policy → its own banner; everything else is "consent_denied"
    // because Google's error vocabulary is opaque to end users.
    if (
      googleError === 'admin_policy_enforced' ||
      googleError === 'access_denied' && searchParams.get('error_subtype') === 'admin_policy_enforced'
    ) {
      return settingsRedirect('?error=workspace_admin_blocked')
    }
    return settingsRedirect('?error=consent_denied')
  }

  // ── Validate code + state ──
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const stateCookie = req.cookies.get(STATE_COOKIE_NAME)?.value
  if (!code || !stateParam || !stateCookie) {
    return settingsRedirect('?error=invalid_state')
  }
  // Cookie state must match the state we put in the consent URL.
  if (stateParam !== stateCookie) {
    return settingsRedirect('?error=invalid_state')
  }
  const decoded = verifyState(stateParam)
  if (!decoded) {
    return settingsRedirect('?error=invalid_state')
  }

  // ── Bind state to the current session's agent ──
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()

  if (!agent || !agent.workspace_id) {
    return settingsRedirect('?error=invalid_state')
  }
  if (agent.id !== decoded.agent_id) {
    // State was minted for a different agent than the current session — refuse.
    return settingsRedirect('?error=invalid_state')
  }

  // ── Exchange + persist ──
  try {
    await completeGmailConsent(admin, agent.id, agent.workspace_id, code)
    return settingsRedirect('?connected=1')
  } catch (err) {
    if (err instanceof WorkspaceAdminBlockedError) {
      return settingsRedirect('?error=workspace_admin_blocked')
    }
    if (err instanceof RefreshRevokedError) {
      return settingsRedirect('?error=refresh_revoked')
    }
    console.error('[gmail/callback] unexpected error:', err)
    return settingsRedirect('?error=unexpected')
  }
}
