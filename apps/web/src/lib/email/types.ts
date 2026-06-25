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
  | 'scheduled' // HOR-357 — set when scheduled_at is in the future; the cron worker flips it to 'queued'/'sent'
  | 'sent'
  | 'soft_bounced'
  | 'hard_bounced'
  | 'failed'
  | 'spam_complaint'

/**
 * Where a send originated. HOR-356 extended the UI surfaces from a bare `ui`
 * to the three composer-dock entry points so per-surface attribution survives
 * into `email_sends.source`. Keep in sync with the CHECK constraint on
 * `email_sends.source` and `mapToOutreachSource()` in `send.ts`.
 */
export type EmailSendSource =
  | 'ui'
  | 'mcp'
  | 'digest_prompt'
  | 'stream'
  | 'contact'
  | 'companion'

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

/**
 * Wire shape for POST /api/email/send.
 * Designed MCP-first: the same shape is sent by the UI composer and by a
 * future `send_tracked_email` MCP tool.
 */
export interface EmailSendPayload {
  contact_id: string
  to_email?: string                                  // override; defaults to contact.email
  subject: string                                    // 1..200
  body_html: string                                  // TipTap output, sanitized server-side
  body_text?: string                                 // server-derives from html if absent
  tracked?: boolean                                  // default true
  links?: Array<{ url: string; label?: string }>    // optional pre-annotation
  source?: EmailSendSource                           // server defaults from auth context
  scheduled_at?: string                              // HOR-357 — ISO; when set & future, the send is deferred
}

export interface EmailSendResult {
  email_send_id: string
  gmail_message_id: string
  gmail_thread_id: string
}

export type EmailSendErrorCode =
  | 'no_integration'
  | 'token_revoked'
  | 'recipient_excluded'
  | 'rate_limited'
  | 'send_failed'
  | 'invalid_input'

export interface EmailSendErrorBody {
  error: string
  code: EmailSendErrorCode
  detail?: unknown
}

// ── Insight & Content sources (composer dock V3 — Outreach Review re-skin) ──

/** Source class shown in the dock's Insight & Content panel.
 *  `sold` is populated today from the signal-draft recent-sold pretext.
 *  `listings` and `reports` are reserved for HOR-383 (Site Content in Outreach)
 *  — the type union exists so rows light up automatically when the crawler lands. */
export type ContentSourceType = 'listings' | 'sold' | 'reports'

/** Relevance tag rendered on each source row.
 *  `relevant` = Horace predicts this content is useful for the draft.
 *  `viewed` = the prospect actually viewed it on site (HOR-383 only). */
export type RelevanceTag = 'viewed' | 'relevant'

/** One alternative the agent can swap into the active sold row. */
export interface ContentSourceAlt {
  /** Stable id for the alt (e.g. property id). Used as React key + popover state. */
  id: string
  /** Display label shown in the swap popover, e.g. "8 Gurner St · sold $1.98M". */
  label: string
  /** Text to find-replace in the body when picked (street + suburb). */
  address: string
  /** Text to find-replace in the body when picked (price string). */
  price: string
}

/** One row in the Insight & Content panel. */
export interface ContentSource {
  /** Stable id (typically the source url or a synthetic key). */
  id: string
  type: ContentSourceType
  /** Display label, e.g. "Sold — 14 Renny St, Paddington · $2.34M". */
  label: string
  /** Optional outbound link for the source. */
  url?: string
  tag: RelevanceTag
  /** Address currently embedded in the draft (sold rows only). */
  address?: string
  /** Price currently embedded in the draft (sold rows only). */
  price?: string
  /** When present, the row shows a "Swap" affordance with these alts. */
  alts?: ContentSourceAlt[]
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
