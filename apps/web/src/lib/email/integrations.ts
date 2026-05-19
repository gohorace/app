/**
 * Agent ↔ Gmail integration orchestrator.
 *
 * Single entry points used by routes (connect/callback/disconnect) and by
 * slice D's send pipeline (`getValidAccessToken`). Holds:
 *
 *   - In-memory access-token cache (per-agent, never persisted)
 *   - State-cookie sign/verify (CSRF guard for the consent redirect)
 *   - Status-flip helpers when Google reports refresh_revoked /
 *     workspace_admin_blocked
 *
 * All DB writes use the admin client; this module must be called from
 * server-only contexts (route handlers, server actions, MCP tools).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildConsentUrl,
  exchangeCode,
  fetchUserinfo,
  refreshAccessToken,
  revokeRefreshToken,
  RefreshRevokedError,
  WorkspaceAdminBlockedError,
  FULL_SCOPE_STRING,
} from './gmail'
import {
  storeIntegrationSecret,
  readIntegrationSecret,
  deleteIntegrationSecret,
} from './vault'
import type {
  AccessTokenCacheEntry,
  AgentIntegrationRow,
  IntegrationStatus,
  OAuthState,
} from './types'

// ── State cookie (CSRF + agent binding for consent redirect) ────────────────

const STATE_COOKIE_NAME = 'horace_oauth_state'
const STATE_TTL_SECONDS = 600 // 10 minutes

function stateSecret(): string {
  // Reuse the unsubscribe secret pattern: dedicated env or service-role fallback.
  return process.env.OAUTH_STATE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY!
}

/**
 * Mint a state string that binds the consent redirect to this agent and
 * a fresh nonce. Returned as `<base64url-payload>.<sig>`.
 */
export function signState(agentId: string): string {
  const payload: OAuthState = {
    agent_id: agentId,
    nonce: randomBytes(16).toString('base64url'),
    iat: Math.floor(Date.now() / 1000),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', stateSecret())
    .update(encoded)
    .digest('base64url')
    .slice(0, 32)
  return `${encoded}.${sig}`
}

/**
 * Verify a state string against agent identity + TTL. Returns the decoded
 * OAuthState on success; null on any failure (signature mismatch, expired,
 * malformed).
 */
export function verifyState(state: string): OAuthState | null {
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const [encoded, sig] = parts

  const expected = createHmac('sha256', stateSecret())
    .update(encoded)
    .digest('base64url')
    .slice(0, 32)
  if (expected.length !== sig.length) return null
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null

  let decoded: OAuthState
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OAuthState
  } catch {
    return null
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - decoded.iat
  if (ageSeconds < 0 || ageSeconds > STATE_TTL_SECONDS) return null
  if (!decoded.agent_id) return null
  return decoded
}

export { STATE_COOKIE_NAME, STATE_TTL_SECONDS }

// ── Access-token cache (in-process only) ────────────────────────────────────

const accessTokenCache = new Map<string, AccessTokenCacheEntry>()
const CACHE_SAFETY_MS = 60_000 // refresh 60s before actual expiry to avoid edge races

function getCached(agentId: string): string | null {
  const entry = accessTokenCache.get(agentId)
  if (!entry) return null
  if (entry.expires_at <= Date.now() + CACHE_SAFETY_MS) {
    accessTokenCache.delete(agentId)
    return null
  }
  return entry.access_token
}

function setCached(agentId: string, accessToken: string, expiresInSeconds: number) {
  accessTokenCache.set(agentId, {
    access_token: accessToken,
    expires_at: Date.now() + expiresInSeconds * 1000,
  })
}

function clearCached(agentId: string) {
  accessTokenCache.delete(agentId)
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the OAuth flow. Returns the Google consent URL + the state string
 * the route handler should set as an HttpOnly cookie.
 */
export function buildGmailConsentRedirect(agentId: string): {
  url: string
  state: string
} {
  const state = signState(agentId)
  return { url: buildConsentUrl(state), state }
}

/**
 * Complete the OAuth flow. Called from /api/integrations/gmail/callback after
 * Google bounces back with `?code=…&state=…`. Validates state, exchanges the
 * code, stores refresh_token in Vault, upserts agent_integrations row.
 *
 * Returns the upserted row. Throws RefreshRevokedError / WorkspaceAdminBlockedError
 * if Google rejects the exchange (caller renders an explanatory page rather
 * than the generic /settings/integrations success view).
 */
export async function completeGmailConsent(
  admin: SupabaseClient,
  agentId: string,
  workspaceId: string,
  code: string
): Promise<AgentIntegrationRow> {
  const tokens = await exchangeCode(code)
  if (!tokens.refresh_token) {
    throw new Error('exchangeCode returned no refresh_token (caller should retry consent)')
  }

  // Resolve the agent's Google address so the UI can show "Connected as foo@example.com".
  const userinfo = await fetchUserinfo(tokens.access_token)

  // If this agent has a prior agent_integrations row (e.g. reconnect after disconnect),
  // clean up the old vault secret first to avoid orphans.
  const { data: existing } = await admin
    .from('agent_integrations')
    .select('id, vault_secret_id')
    .eq('agent_id', agentId)
    .eq('provider', 'gmail')
    .maybeSingle()

  if (existing?.vault_secret_id) {
    await deleteIntegrationSecret(admin, existing.vault_secret_id).catch(() => {
      // Best-effort; an orphan vault row is recoverable manually.
    })
  }

  const newSecretId = await storeIntegrationSecret(
    admin,
    tokens.refresh_token,
    `gmail_refresh_${agentId}`
  )

  // Cache the just-issued access token so the first send/refresh doesn't
  // round-trip back to Google.
  setCached(agentId, tokens.access_token, tokens.expires_in)

  const upsertPayload = {
    agent_id: agentId,
    workspace_id: workspaceId,
    provider: 'gmail' as const,
    status: 'connected' as const,
    external_account: userinfo.email,
    scope: tokens.scope ?? FULL_SCOPE_STRING,
    vault_secret_id: newSecretId,
    last_refreshed_at: new Date().toISOString(),
    last_error: null,
    connected_at: new Date().toISOString(),
    disconnected_at: null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await admin
    .from('agent_integrations')
    .upsert(upsertPayload, { onConflict: 'agent_id,provider' })
    .select(
      'id, workspace_id, agent_id, provider, status, external_account, scope, vault_secret_id, last_refreshed_at, last_error, connected_at, disconnected_at, updated_at'
    )
    .single()

  if (error || !data) {
    throw new Error(`agent_integrations upsert failed: ${error?.message ?? 'no row returned'}`)
  }
  return data as AgentIntegrationRow
}

/**
 * Disconnect the integration: flip status to `disconnected`, delete the
 * vault secret, and best-effort revoke the refresh_token with Google.
 * The row is retained for history.
 */
export async function disconnectGmail(
  admin: SupabaseClient,
  agentId: string
): Promise<void> {
  const { data: row } = await admin
    .from('agent_integrations')
    .select('id, vault_secret_id')
    .eq('agent_id', agentId)
    .eq('provider', 'gmail')
    .maybeSingle()

  if (!row) return // already disconnected or never connected

  const refreshToken = row.vault_secret_id
    ? await readIntegrationSecret(admin, row.vault_secret_id).catch(() => null)
    : null

  await admin
    .from('agent_integrations')
    .update({
      status: 'disconnected' as const,
      disconnected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)

  if (row.vault_secret_id) {
    await deleteIntegrationSecret(admin, row.vault_secret_id).catch(() => {
      // tolerate; secret may already be gone
    })
  }

  if (refreshToken) {
    await revokeRefreshToken(refreshToken)
  }

  clearCached(agentId)
}

/**
 * Single source of truth for "give me a Gmail access token for this agent".
 * Used by slice D's send pipeline and the future MCP tool.
 *
 * Flow:
 *   1. Return from in-process cache if still fresh
 *   2. Otherwise load the agent_integrations row + refresh_token from Vault
 *   3. Call Google's refresh endpoint
 *   4. On invalid_grant → flip status to refresh_revoked, throw RefreshRevokedError
 *   5. On admin_policy_enforced → flip status to workspace_admin_blocked, throw WorkspaceAdminBlockedError
 *   6. On success → cache and return
 */
export async function getValidAccessToken(
  admin: SupabaseClient,
  agentId: string
): Promise<string> {
  const cached = getCached(agentId)
  if (cached) return cached

  const { data: row, error } = await admin
    .from('agent_integrations')
    .select('id, status, vault_secret_id')
    .eq('agent_id', agentId)
    .eq('provider', 'gmail')
    .maybeSingle()

  if (error) throw new Error(`agent_integrations load failed: ${error.message}`)
  if (!row) throw new Error('No Gmail integration for this agent')
  if (row.status !== 'connected') {
    throw new Error(`Gmail integration status: ${row.status}`)
  }

  const refreshToken = await readIntegrationSecret(admin, row.vault_secret_id)
  if (!refreshToken) {
    // Vault row missing; treat as revoked.
    await flipStatus(admin, row.id, 'refresh_revoked', 'vault secret missing')
    throw new RefreshRevokedError('vault secret missing')
  }

  try {
    const tokens = await refreshAccessToken(refreshToken)

    // If Google rotated the refresh_token (rare), persist the new one.
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      const newSecretId = await storeIntegrationSecret(
        admin,
        tokens.refresh_token,
        `gmail_refresh_${agentId}`
      )
      await admin
        .from('agent_integrations')
        .update({
          vault_secret_id: newSecretId,
          last_refreshed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      // Delete the old secret only after the new one is wired up.
      await deleteIntegrationSecret(admin, row.vault_secret_id).catch(() => {})
    } else {
      await admin
        .from('agent_integrations')
        .update({
          last_refreshed_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
    }

    setCached(agentId, tokens.access_token, tokens.expires_in)
    return tokens.access_token
  } catch (err) {
    if (err instanceof RefreshRevokedError) {
      await flipStatus(admin, row.id, 'refresh_revoked', err.message)
      throw err
    }
    if (err instanceof WorkspaceAdminBlockedError) {
      await flipStatus(admin, row.id, 'workspace_admin_blocked', err.message)
      throw err
    }
    // Unknown error: don't flip status (could be transient network); just propagate.
    throw err
  }
}

async function flipStatus(
  admin: SupabaseClient,
  integrationId: string,
  status: IntegrationStatus,
  error: string
): Promise<void> {
  await admin
    .from('agent_integrations')
    .update({
      status,
      last_error: error,
      updated_at: new Date().toISOString(),
    })
    .eq('id', integrationId)
}

// ── Test hooks (exported only for unit tests) ───────────────────────────────

/** @internal — exported only so unit tests can poison the cache deterministically. */
export const __testing = {
  clearCache: () => accessTokenCache.clear(),
}
