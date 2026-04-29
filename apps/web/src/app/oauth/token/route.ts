import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mintToken } from '@/lib/mcp/auth'
import { verifyPkce, ACCESS_TOKEN_TTL_SECONDS } from '@/lib/oauth/helpers'

export const runtime = 'nodejs'

function jsonError(error: string, error_description?: string, status = 400) {
  return NextResponse.json(
    { error, ...(error_description ? { error_description } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

async function readParams(req: NextRequest): Promise<URLSearchParams> {
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(await req.text())
  }
  if (ct.includes('application/json')) {
    const body = (await req.json()) as Record<string, unknown>
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'string') params.set(k, v)
    }
    return params
  }
  return new URLSearchParams(await req.text())
}

export async function POST(req: NextRequest) {
  let params: URLSearchParams
  try {
    params = await readParams(req)
  } catch {
    return jsonError('invalid_request', 'Could not parse request body')
  }

  const grantType   = params.get('grant_type')
  const code        = params.get('code')
  const redirectUri = params.get('redirect_uri')
  const clientId    = params.get('client_id')
  const verifier    = params.get('code_verifier')

  if (grantType !== 'authorization_code') {
    return jsonError('unsupported_grant_type', `grant_type "${grantType}" not supported`)
  }
  if (!code || !redirectUri || !clientId || !verifier) {
    return jsonError('invalid_request', 'code, redirect_uri, client_id, and code_verifier are required')
  }

  const admin = createAdminClient()

  // Atomically consume the code (single-use, expiry-checked).
  const { data: rows, error } = await admin.rpc('consume_oauth_code', { p_code: code })
  if (error) {
    console.error('[oauth/token] consume failed', error)
    return jsonError('server_error', 'Failed to consume authorization code', 500)
  }
  const ctx = rows?.[0]
  if (!ctx) {
    return jsonError('invalid_grant', 'Authorization code is invalid, expired, or already used')
  }

  if (ctx.client_id !== clientId) {
    return jsonError('invalid_grant', 'client_id does not match the issued code')
  }
  if (ctx.redirect_uri !== redirectUri) {
    return jsonError('invalid_grant', 'redirect_uri does not match the issued code')
  }
  if (!verifyPkce(verifier, ctx.code_challenge, ctx.code_challenge_method)) {
    return jsonError('invalid_grant', 'code_verifier failed PKCE verification')
  }

  // Issue a workspace_api_tokens row scoped to this client + agent.
  const { plaintext, hash } = mintToken()
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString()

  const { error: insertErr } = await admin.from('workspace_api_tokens').insert({
    workspace_id: ctx.workspace_id,
    agent_id:     ctx.agent_id,
    user_id:      ctx.user_id,
    name:         `OAuth: ${clientId}`,
    token_hash:   hash,
    client_id:    clientId,
    expires_at:   expiresAt,
    scope:        ctx.scope,
  })
  if (insertErr) {
    console.error('[oauth/token] token insert failed', insertErr)
    return jsonError('server_error', 'Failed to issue access token', 500)
  }

  return NextResponse.json(
    {
      access_token: plaintext,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: ctx.scope,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
