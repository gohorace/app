import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mintToken, mintRefreshToken, hashToken } from '@/lib/mcp/auth'
import { verifyPkce, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '@/lib/oauth/helpers'

export const runtime = 'nodejs'

type Admin = ReturnType<typeof createAdminClient>

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

interface TokenIdentity {
  workspaceId: string
  agentId: string
  userId: string
  clientId: string
  scope: string
}

// Mint a fresh access token (workspace_api_tokens row) and a rotating refresh
// token (oauth_refresh_tokens row) for an identity, then shape the RFC 6749
// token response. `rotatedFrom` links a refresh token to the one it replaced
// (audit only; null on the initial authorization_code grant).
async function issueTokenSet(admin: Admin, id: TokenIdentity, rotatedFrom: string | null) {
  const access = mintToken()
  const refresh = mintRefreshToken()
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString()
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString()

  const { error: accessErr } = await admin.from('workspace_api_tokens').insert({
    workspace_id: id.workspaceId,
    agent_id:     id.agentId,
    user_id:      id.userId,
    name:         `OAuth: ${id.clientId}`,
    token_hash:   access.hash,
    client_id:    id.clientId,
    expires_at:   accessExpiresAt,
    scope:        id.scope,
  })
  if (accessErr) {
    console.error('[oauth/token] access token insert failed', accessErr)
    return jsonError('server_error', 'Failed to issue access token', 500)
  }

  const { error: refreshErr } = await admin.from('oauth_refresh_tokens').insert({
    token_hash:   refresh.hash,
    client_id:    id.clientId,
    user_id:      id.userId,
    agent_id:     id.agentId,
    workspace_id: id.workspaceId,
    scope:        id.scope,
    expires_at:   refreshExpiresAt,
    rotated_from: rotatedFrom,
  })
  if (refreshErr) {
    console.error('[oauth/token] refresh token insert failed', refreshErr)
    return jsonError('server_error', 'Failed to issue refresh token', 500)
  }

  return NextResponse.json(
    {
      access_token:  access.plaintext,
      token_type:    'Bearer',
      expires_in:    ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refresh.plaintext,
      scope:         id.scope,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// RFC 6749 §4.1.3 — exchange a PKCE authorization code for tokens.
async function handleAuthorizationCode(params: URLSearchParams, admin: Admin) {
  const code        = params.get('code')
  const redirectUri = params.get('redirect_uri')
  const clientId    = params.get('client_id')
  const verifier    = params.get('code_verifier')

  if (!code || !redirectUri || !clientId || !verifier) {
    return jsonError('invalid_request', 'code, redirect_uri, client_id, and code_verifier are required')
  }

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

  return issueTokenSet(admin, {
    workspaceId: ctx.workspace_id,
    agentId:     ctx.agent_id,
    userId:      ctx.user_id,
    clientId,
    scope:       ctx.scope,
  }, null)
}

// RFC 6749 §6 — exchange a refresh token for a new token set. The presented
// refresh token is consumed (rotated): single-use, and the replacement is
// returned in the response, so a replayed token yields invalid_grant.
async function handleRefreshToken(params: URLSearchParams, admin: Admin) {
  const refreshToken = params.get('refresh_token')
  // client_id is OPTIONAL here: the rotated, hashed, single-use refresh token
  // is itself the credential. Requiring client_id would break refresh on the
  // hot path if a client omits it; when present we still verify it matches.
  const clientId = params.get('client_id')

  if (!refreshToken) {
    return jsonError('invalid_request', 'refresh_token is required')
  }

  const { data: rows, error } = await admin.rpc('consume_refresh_token', {
    p_token_hash: hashToken(refreshToken),
  })
  if (error) {
    console.error('[oauth/token] refresh consume failed', error)
    return jsonError('server_error', 'Failed to consume refresh token', 500)
  }
  const ctx = rows?.[0]
  if (!ctx) {
    return jsonError('invalid_grant', 'Refresh token is invalid, expired, or already used')
  }
  if (clientId && ctx.client_id !== clientId) {
    return jsonError('invalid_grant', 'client_id does not match the refresh token')
  }

  return issueTokenSet(admin, {
    workspaceId: ctx.workspace_id,
    agentId:     ctx.agent_id,
    userId:      ctx.user_id,
    clientId:    ctx.client_id,
    scope:       ctx.scope,
  }, ctx.id)
}

export async function POST(req: NextRequest) {
  let params: URLSearchParams
  try {
    params = await readParams(req)
  } catch {
    return jsonError('invalid_request', 'Could not parse request body')
  }

  const grantType = params.get('grant_type')
  const admin = createAdminClient()

  if (grantType === 'authorization_code') return handleAuthorizationCode(params, admin)
  if (grantType === 'refresh_token')      return handleRefreshToken(params, admin)
  return jsonError('unsupported_grant_type', `grant_type "${grantType}" not supported`)
}
