/**
 * Google OAuth 2.0 + Gmail REST helpers (raw fetch).
 *
 * We deliberately avoid `googleapis` / `google-auth-library` to keep the
 * dependency surface small. The flows we need are simple REST:
 *
 *   • POST oauth2.googleapis.com/token — code exchange + refresh
 *   • POST oauth2.googleapis.com/revoke — best-effort revoke on disconnect
 *   • GET  www.googleapis.com/oauth2/v3/userinfo — read consented email
 *
 * Slice D will add gmail.users.messages.send when the composer ships.
 *
 * Scope is locked to `gmail.send` only. Adding `gmail.modify` / `gmail.readonly`
 * later requires a fresh consent flow and CASA assessment (HOR-105 phase 2).
 */

import type { GoogleTokenResponse } from './types'

// ── Constants ───────────────────────────────────────────────────────────────

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
export const IDENTITY_SCOPES = ['openid', 'email', 'profile']
export const FULL_SCOPE_STRING = [GMAIL_SCOPE, ...IDENTITY_SCOPES].join(' ')

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

// ── Env ─────────────────────────────────────────────────────────────────────

function requireEnv(key: 'GOOGLE_OAUTH_CLIENT_ID' | 'GOOGLE_OAUTH_CLIENT_SECRET' | 'GOOGLE_OAUTH_REDIRECT_URI'): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required env var: ${key}`)
  }
  return value
}

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * Thrown when Google rejects a refresh-token grant with `invalid_grant`,
 * which means the refresh token is no longer valid (user revoked access,
 * password change, 6-month inactivity, etc). Caller flips the integration
 * status to `refresh_revoked` and surfaces a Reconnect CTA.
 */
export class RefreshRevokedError extends Error {
  constructor(detail?: string) {
    super(`Google refresh token revoked${detail ? `: ${detail}` : ''}`)
    this.name = 'RefreshRevokedError'
  }
}

/**
 * Thrown when the agent's Google Workspace admin has blocked third-party
 * app access. Caller flips status to `workspace_admin_blocked`.
 */
export class WorkspaceAdminBlockedError extends Error {
  constructor(detail?: string) {
    super(`Google Workspace admin policy blocked the request${detail ? `: ${detail}` : ''}`)
    this.name = 'WorkspaceAdminBlockedError'
  }
}

// ── Consent URL ─────────────────────────────────────────────────────────────

/**
 * Build the URL we redirect the agent to for Google consent.
 *
 * `access_type=offline` + `prompt=consent` ensures Google returns a
 * refresh_token on every consent (without `prompt=consent` you only get
 * one on first-ever consent, which breaks reconnect flows).
 */
export function buildConsentUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
    redirect_uri: requireEnv('GOOGLE_OAUTH_REDIRECT_URI'),
    response_type: 'code',
    scope: FULL_SCOPE_STRING,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

// ── Token endpoint ──────────────────────────────────────────────────────────

/**
 * Exchange the authorization code returned by Google for an access_token
 * + refresh_token pair. Called from the /callback route exactly once per
 * consent.
 */
export async function exchangeCode(code: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    redirect_uri: requireEnv('GOOGLE_OAUTH_REDIRECT_URI'),
    grant_type: 'authorization_code',
  })

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw classifyGoogleTokenError(res.status, detail)
  }

  const json = (await res.json()) as GoogleTokenResponse
  if (!json.access_token) {
    throw new Error('Google token exchange returned no access_token')
  }
  if (!json.refresh_token) {
    // Should never happen with prompt=consent + access_type=offline, but
    // surface clearly if Google's behaviour changes.
    throw new Error('Google token exchange returned no refresh_token (consent may have been silent)')
  }
  return json
}

/**
 * Refresh an access_token using a stored refresh_token. Called by
 * getValidAccessToken when the in-memory cache is empty or expired.
 */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    grant_type: 'refresh_token',
  })

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw classifyGoogleTokenError(res.status, detail)
  }

  const json = (await res.json()) as GoogleTokenResponse
  if (!json.access_token) {
    throw new Error('Google refresh returned no access_token')
  }
  return json
}

// ── Userinfo (consent: which email did the user authorize?) ─────────────────

export interface GoogleUserinfo {
  sub: string
  email: string
  email_verified: boolean
  name?: string
  picture?: string
}

export async function fetchUserinfo(accessToken: string): Promise<GoogleUserinfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Google userinfo failed (${res.status}): ${detail}`)
  }
  return (await res.json()) as GoogleUserinfo
}

// ── Revoke (best-effort on disconnect) ──────────────────────────────────────

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  // Google's revoke endpoint accepts either the access_token or refresh_token.
  // We use the refresh_token because that's what we have stored.
  await fetch(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => {
    // Best-effort; we proceed even if revoke fails (Google's endpoint can
    // 400 on tokens that are already revoked). The caller has already
    // marked the integration disconnected and deleted the local secret.
  })
}

// ── Error classification ────────────────────────────────────────────────────

/**
 * Map Google's token-endpoint errors to typed errors the orchestrator can
 * branch on. Google returns JSON like:
 *   { "error": "invalid_grant", "error_description": "..." }
 */
function classifyGoogleTokenError(status: number, body: string): Error {
  let parsed: { error?: string; error_description?: string } = {}
  try {
    parsed = JSON.parse(body)
  } catch {
    // Non-JSON; fall through to status-based mapping
  }

  const code = parsed.error ?? ''
  const description = parsed.error_description ?? body

  if (code === 'invalid_grant') {
    return new RefreshRevokedError(description)
  }
  // Google sometimes surfaces admin policy blocks as 403 with `admin_policy_enforced`
  // in error_description. The exact code/wording can vary; pattern-match defensively.
  if (
    status === 403 &&
    /admin_policy|admin policy|disabled by/i.test(description)
  ) {
    return new WorkspaceAdminBlockedError(description)
  }
  return new Error(`Google token endpoint ${status}: ${code || description}`)
}
