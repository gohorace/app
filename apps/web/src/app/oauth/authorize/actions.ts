'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateAuthCode, AUTH_CODE_TTL_SECONDS } from '@/lib/oauth/helpers'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

function withParams(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') u.searchParams.set(k, v)
  }
  return u.toString()
}

export async function authorizeAction(formData: FormData) {
  const clientId            = String(formData.get('client_id') ?? '')
  const redirectUri         = String(formData.get('redirect_uri') ?? '')
  const state               = String(formData.get('state') ?? '')
  const scope               = String(formData.get('scope') ?? 'mcp')
  const codeChallenge       = String(formData.get('code_challenge') ?? '')
  const codeChallengeMethod = String(formData.get('code_challenge_method') ?? 'S256')
  const decision            = String(formData.get('decision') ?? 'deny')

  if (!clientId || !redirectUri || !codeChallenge) {
    throw new Error('Missing required parameters')
  }

  // We only support S256 PKCE (the token endpoint verifies S256). Reject any
  // other method up front rather than silently recording it as S256 and
  // failing later at the token exchange with a misleading invalid_grant.
  if (codeChallengeMethod !== 'S256') {
    throw new Error('Unsupported code_challenge_method (S256 required)')
  }

  if (decision !== 'approve') {
    redirect(withParams(redirectUri, {
      error: 'access_denied',
      error_description: 'User cancelled authorization',
      state: state || undefined,
    }))
  }

  // Re-verify session, agent ownership, and client (form values must not be trusted blindly).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const admin = createAdminClient()

  const { data: client } = await admin
    .from('oauth_clients')
    .select('client_id, redirect_uris, scope')
    .eq('client_id', clientId)
    .maybeSingle()
  if (!client) throw new Error('Unknown client')
  if (!client.redirect_uris.includes(redirectUri)) throw new Error('redirect_uri mismatch')

  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })
  if (!agent || !agent.workspace_id) throw new Error('No workspace for user')

  const code = generateAuthCode()
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString()

  const { error } = await admin.from('oauth_authorization_codes').insert({
    code,
    client_id: clientId,
    user_id: user.id,
    agent_id: agent.id,
    workspace_id: agent.workspace_id,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope,
    expires_at: expiresAt,
  })
  if (error) {
    console.error('[oauth/authorize] code insert failed', error)
    throw new Error('Failed to issue authorization code')
  }

  redirect(withParams(redirectUri, { code, state: state || undefined }))
}
