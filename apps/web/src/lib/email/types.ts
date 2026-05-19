/**
 * Shared types for the tracked-email subsystem (HOR-106).
 *
 * Slice B uses AgentIntegration + IntegrationStatus. Slice D and beyond
 * will pull in EmailSendId / EngagementEventType / EmailSendPayload.
 *
 * These types are hand-maintained because the slice A migration
 * (20260519000001_email_send_v1.sql) is applied to prod but the
 * generated database.types.ts file has not yet been regenerated.
 * When Supabase types regenerate to include agent_integrations / email_sends /
 * agent_email_exclusions, drop the manual rows below in favour of
 * Database['public']['Tables']['<table>']['Row'].
 */

// ── agent_integrations ──────────────────────────────────────────────────────

export type IntegrationProvider = 'gmail'

export type IntegrationStatus =
  | 'connected'
  | 'refresh_revoked'
  | 'workspace_admin_blocked'
  | 'disconnected'

export interface AgentIntegrationRow {
  id: string
  workspace_id: string
  agent_id: string
  provider: IntegrationProvider
  status: IntegrationStatus
  external_account: string
  scope: string
  vault_secret_id: string
  last_refreshed_at: string | null
  last_error: string | null
  connected_at: string
  disconnected_at: string | null
  updated_at: string
}

// ── email_sends (used from slice D onward; defined here for the shared module) ──

export type EmailSendId = string & { readonly __brand: 'EmailSendId' }

export type EmailSendStatus =
  | 'queued'
  | 'sent'
  | 'soft_bounced'
  | 'hard_bounced'
  | 'failed'
  | 'spam_complaint'

export type EmailSendSource = 'ui' | 'mcp' | 'digest_prompt'

export type EngagementEventType =
  | 'email_sent'
  | 'email_opened'
  | 'email_clicked'
  | 'email_bounced'

export interface EmailSendLink {
  url_id: number
  url: string
  label?: string
}

// ── OAuth / Gmail ───────────────────────────────────────────────────────────

/** Decoded payload of the HMAC state cookie set during /connect → /callback. */
export interface OAuthState {
  agent_id: string
  nonce: string
  iat: number  // issued-at epoch seconds
}

/** Response shape from Google's token endpoint. */
export interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
  refresh_token?: string  // present on first consent (with prompt=consent), rare on refresh
  id_token?: string
}

/** Cached access-token entry. In-memory only — never persisted. */
export interface AccessTokenCacheEntry {
  access_token: string
  expires_at: number  // epoch ms
}
