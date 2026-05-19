/**
 * sendTrackedEmail — the single source-of-truth orchestrator for sending a
 * tracked email through an agent's connected Gmail account.
 *
 * Called from two places:
 *   1. /api/email/send/route.ts (cookie session — UI composer + digest card)
 *   2. The future `send_tracked_email` MCP tool (Bearer auth — Claude etc.)
 *
 * Pipeline (matches HOR-226 spec):
 *   1. Resolve auth → agent_id + workspace_id (done by caller; passed in)
 *   2. Sanitize body_html (DOMPurify, server-side). Derive plain-text from
 *      html if body_text wasn't supplied.
 *   3. is_recipient_excluded(agent_id, to_email) → 403 if true.
 *   4. Load contact, assert ownership.
 *   5. getValidAccessToken(agent_id) → 409 if refresh_revoked.
 *   6. Insert email_sends row with status='queued' (atomic; returns the
 *      email_send_id we'll use for token signing).
 *   7. If tracked=true: rewrite links + inject open pixel.
 *   8. Build multipart/alternative MIME with List-Unsubscribe header.
 *   9. POST gmail.users.messages.send with { raw: base64url(mime) }.
 *  10. On 200: update email_sends → sent, insert outreach_log, emit_email_event.
 *  11. On 401: refresh once and retry. Second 401 → flip refresh_revoked.
 *  12. On 403 quota: 429.
 *  13. Any other failure: leave queued, error_message stored, slice G retries.
 */

import sanitizeHtml from 'sanitize-html'
import { convert as htmlToText } from 'html-to-text'
import type { SupabaseClient } from '@supabase/supabase-js'

import { getValidAccessToken } from './integrations'
import {
  RefreshRevokedError,
  WorkspaceAdminBlockedError,
} from './gmail'
import { rewriteAndInjectPixel } from './rewrite'
import { buildMimeMessage } from './mime'
import { unsubscribeUrl } from '@/lib/outreach/unsubscribe'
import { getAppUrl } from '@/lib/url'
import type {
  EmailSendPayload,
  EmailSendResult,
  EmailSendSource,
  EmailSendLink,
} from './types'

const GMAIL_SEND_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

// ── Public error class ──────────────────────────────────────────────────────

type SendErrorCode =
  | 'no_integration'
  | 'token_revoked'
  | 'recipient_excluded'
  | 'rate_limited'
  | 'send_failed'
  | 'invalid_input'

export class SendTrackedEmailError extends Error {
  readonly code: SendErrorCode
  readonly status: number
  readonly detail?: unknown

  constructor(
    code: SendErrorCode,
    status: number,
    message: string,
    detail?: unknown,
  ) {
    super(message)
    this.name = 'SendTrackedEmailError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

// ── Public orchestrator ─────────────────────────────────────────────────────

export interface SendTrackedEmailContext {
  /** Admin client (service-role). All writes go through this — RLS is bypassed deliberately. */
  admin: SupabaseClient
  agentId: string
  workspaceId: string
  /** Where the request came from. Defaults to 'ui'. */
  source?: EmailSendSource
}

export async function sendTrackedEmail(
  ctx: SendTrackedEmailContext,
  payloadIn: EmailSendPayload,
): Promise<EmailSendResult> {
  // ── Step 2: validate + sanitize ───────────────────────────────────────────
  const payload = normalizePayload(payloadIn)

  // ── Step 3: exclusion check ───────────────────────────────────────────────
  // RPC cast: slice A's RPCs aren't in the generated Database type yet.
  // Drop the casts once database.types.ts is regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: excludedRow } = await (ctx.admin.rpc as any)('is_recipient_excluded', {
    p_agent_id: ctx.agentId,
    p_email: payload.toEmail,
  })
  // RPC returns table(excluded boolean, reason text); first row is the result.
  const excludedRows = (excludedRow ?? []) as Array<{ excluded?: boolean; reason?: string | null }>
  const excluded = excludedRows[0] ?? null
  if (excluded?.excluded === true) {
    throw new SendTrackedEmailError(
      'recipient_excluded',
      403,
      'Recipient is on the agent exclusion list or has unsubscribed.',
      { reason: excluded.reason ?? null },
    )
  }

  // ── Step 4: load contact + ownership check ────────────────────────────────
  const { data: contact } = await ctx.admin
    .from('contacts')
    .select('id, email, agent_id, owner_agent_id')
    .eq('id', payload.contactId)
    .maybeSingle()

  if (!contact) {
    throw new SendTrackedEmailError(
      'invalid_input',
      400,
      `Contact ${payload.contactId} not found.`,
    )
  }
  // Phase 1 dual-write: ownership is either column.
  const contactRow = contact as {
    id: string
    email: string | null
    agent_id: string | null
    owner_agent_id: string | null
  }
  if (
    contactRow.agent_id !== ctx.agentId &&
    contactRow.owner_agent_id !== ctx.agentId
  ) {
    throw new SendTrackedEmailError(
      'invalid_input',
      400,
      'Contact is not owned by this agent.',
    )
  }

  // ── Step 5: get a valid access token ──────────────────────────────────────
  let accessToken: string
  try {
    accessToken = await getValidAccessToken(ctx.admin, ctx.agentId)
  } catch (err) {
    if (err instanceof RefreshRevokedError) {
      throw new SendTrackedEmailError(
        'token_revoked',
        409,
        'Gmail connection has been revoked. Reconnect from Settings → Integrations.',
      )
    }
    if (err instanceof WorkspaceAdminBlockedError) {
      throw new SendTrackedEmailError(
        'token_revoked',
        409,
        'Google Workspace admin has blocked third-party app access.',
      )
    }
    if (err instanceof Error && /No Gmail integration/i.test(err.message)) {
      throw new SendTrackedEmailError(
        'no_integration',
        403,
        'No Gmail integration is connected for this agent.',
      )
    }
    throw err
  }

  // Resolve agent's verified Gmail address for the From header.
  const { data: integrationRow } = await ctx.admin
    .from('agent_integrations')
    .select('external_account')
    .eq('agent_id', ctx.agentId)
    .eq('provider', 'gmail')
    .eq('status', 'connected')
    .maybeSingle()
  const fromAddress = (integrationRow as { external_account?: string } | null)
    ?.external_account
  if (!fromAddress) {
    throw new SendTrackedEmailError(
      'no_integration',
      403,
      'Connected Gmail integration is missing its sender address.',
    )
  }

  // ── Step 6: pre-insert email_sends with status='queued' ───────────────────
  const { data: insertedRow, error: insertErr } = await ctx.admin
    .from('email_sends')
    .insert({
      workspace_id: ctx.workspaceId,
      agent_id: ctx.agentId,
      contact_id: contactRow.id,
      to_email: payload.toEmail,
      subject: payload.subject,
      body_html: payload.bodyHtml,
      body_text: payload.bodyText,
      tracked: payload.tracked,
      provider: 'gmail',
      status: 'queued',
      links: [],
      source: ctx.source ?? 'ui',
    })
    .select('id')
    .single()

  if (insertErr || !insertedRow) {
    throw new SendTrackedEmailError(
      'send_failed',
      502,
      `email_sends insert failed: ${insertErr?.message ?? 'no row returned'}`,
    )
  }
  const emailSendId = (insertedRow as { id: string }).id

  // ── Step 7: rewrite links + inject pixel (if tracked) ─────────────────────
  let finalHtml = payload.bodyHtml
  let links: EmailSendLink[] = []
  if (payload.tracked) {
    const out = rewriteAndInjectPixel({
      emailSendId,
      bodyHtml: payload.bodyHtml,
    })
    finalHtml = out.bodyHtml
    links = out.links
  }

  // ── Step 8: build MIME ────────────────────────────────────────────────────
  const appUrl = getAppUrl()
  const unsubUrl = unsubscribeUrl(appUrl, contactRow.id)
  const listUnsubscribe = `<${unsubUrl}>, <mailto:unsubscribe@gohorace.com>`

  const mime = buildMimeMessage({
    from: fromAddress,
    to: payload.toEmail,
    subject: payload.subject,
    text: payload.bodyText,
    html: finalHtml,
    headers: {
      'List-Unsubscribe': listUnsubscribe,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  })

  // ── Step 9–11: call Gmail; refresh-and-retry on 401 ───────────────────────
  let gmailRes = await callGmailSend(accessToken, mime.rawBase64Url)

  if (gmailRes.status === 401) {
    // Token was valid when getValidAccessToken returned, but Google now
    // rejects it. Force a refresh by clearing cache and retry once.
    try {
      accessToken = await getValidAccessToken(ctx.admin, ctx.agentId)
    } catch {
      // Refresh failed (typically RefreshRevokedError) — caller flipped the
      // integration status; surface as token_revoked.
      await markSendStatus(ctx.admin, emailSendId, 'failed', 'auth', '401 from Gmail; refresh revoked')
      throw new SendTrackedEmailError(
        'token_revoked',
        409,
        'Gmail rejected the access token; reconnect from Settings → Integrations.',
      )
    }
    gmailRes = await callGmailSend(accessToken, mime.rawBase64Url)
  }

  if (gmailRes.status === 403 && /(quota|daily user message limit)/i.test(gmailRes.bodyText)) {
    await markSendStatus(
      ctx.admin,
      emailSendId,
      'queued',
      'gmail_quota',
      gmailRes.bodyText.slice(0, 500),
    )
    throw new SendTrackedEmailError(
      'rate_limited',
      429,
      'Gmail daily quota exceeded for this account.',
    )
  }

  if (gmailRes.status === 429) {
    await markSendStatus(
      ctx.admin,
      emailSendId,
      'queued',
      'gmail_rate_limit',
      gmailRes.bodyText.slice(0, 500),
    )
    throw new SendTrackedEmailError(
      'rate_limited',
      429,
      'Gmail rate-limited the send; will retry.',
    )
  }

  if (!gmailRes.ok) {
    await markSendStatus(
      ctx.admin,
      emailSendId,
      'queued',
      `gmail_${gmailRes.status}`,
      gmailRes.bodyText.slice(0, 500),
    )
    throw new SendTrackedEmailError(
      'send_failed',
      502,
      `Gmail send failed (${gmailRes.status}).`,
      { responseBody: gmailRes.bodyText.slice(0, 500) },
    )
  }

  // ── Success path ──────────────────────────────────────────────────────────
  const sendBody = gmailRes.body as {
    id: string
    threadId: string
  } | undefined
  if (!sendBody?.id) {
    await markSendStatus(
      ctx.admin,
      emailSendId,
      'failed',
      'no_message_id',
      'Gmail returned success but no message id',
    )
    throw new SendTrackedEmailError(
      'send_failed',
      502,
      'Gmail send succeeded but returned no message id.',
    )
  }

  const nowIso = new Date().toISOString()

  await ctx.admin
    .from('email_sends')
    .update({
      status: 'sent',
      provider_message_id: sendBody.id,
      provider_thread_id: sendBody.threadId,
      sent_at: nowIso,
      links: links as unknown as object,
      updated_at: nowIso,
      error_code: null,
      error_message: null,
    })
    .eq('id', emailSendId)

  // outreach_log dual-write (channel='email', source mapped onto its enum).
  await ctx.admin
    .from('outreach_log')
    .insert({
      agent_id: ctx.agentId,
      contact_id: contactRow.id,
      channel: 'email',
      subject: payload.subject,
      message_preview: derivePreview(payload.bodyText),
      external_id: sendBody.id,
      source: mapToOutreachSource(ctx.source ?? 'ui'),
    })

  // Best-effort event emission. Failures here don't fail the send.
  // RPC cast: emit_email_event isn't in the generated Database type yet.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ctx.admin.rpc as any)('emit_email_event', {
      p_send_id: emailSendId,
      p_event: 'email_sent',
      p_props: { recipient_hash: simpleEmailHash(payload.toEmail) },
    })
  } catch (err) {
    console.error('[sendTrackedEmail] emit_email_event(email_sent) failed:', err)
  }

  return {
    email_send_id: emailSendId,
    gmail_message_id: sendBody.id,
    gmail_thread_id: sendBody.threadId,
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface NormalizedPayload {
  contactId: string
  toEmail: string
  subject: string
  bodyHtml: string
  bodyText: string
  tracked: boolean
}

function normalizePayload(p: EmailSendPayload): NormalizedPayload {
  if (!p.contact_id) {
    throw new SendTrackedEmailError('invalid_input', 400, 'contact_id is required')
  }
  const subject = (p.subject ?? '').trim()
  if (subject.length < 1 || subject.length > 200) {
    throw new SendTrackedEmailError(
      'invalid_input',
      400,
      'subject must be 1–200 characters',
    )
  }
  const rawHtml = (p.body_html ?? '').trim()
  if (!rawHtml) {
    throw new SendTrackedEmailError(
      'invalid_input',
      400,
      'body_html is required',
    )
  }
  // Server-side sanitize. TipTap output is generally safe but paste can
  // smuggle scripts. We use sanitize-html (pure-JS, no jsdom) — the
  // isomorphic-dompurify alternative pulls in jsdom which trips up
  // Next.js's `Collecting page data` step (missing default-stylesheet.css).
  //
  // Allowlist mirrors what TipTap StarterKit + Link extension can emit:
  // basic block + inline marks, lists, links. No tables/images/iframes/etc.
  const cleanHtml = sanitizeHtml(rawHtml, {
    allowedTags: [
      'p', 'br', 'span', 'div',
      'b', 'strong', 'i', 'em', 'u',
      'a',
      'ul', 'ol', 'li',
      'blockquote', 'code',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { a: ['http', 'https', 'mailto', 'tel'] },
    disallowedTagsMode: 'discard',
    // Strip on* event handlers + any style attribute (any non-allowed attr
    // is dropped because allowedAttributes is an explicit whitelist).
  })

  const bodyText = (p.body_text ?? '').trim() || derivePlainText(cleanHtml)

  const toEmail = (p.to_email ?? '').trim()
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    throw new SendTrackedEmailError(
      'invalid_input',
      400,
      'to_email is required and must look like an email address',
    )
  }

  return {
    contactId: p.contact_id,
    toEmail: toEmail.toLowerCase(),
    subject,
    bodyHtml: cleanHtml,
    bodyText,
    tracked: p.tracked !== false,
  }
}

function derivePlainText(html: string): string {
  return htmlToText(html, {
    wordwrap: 78,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: false } },
    ],
  }).trim()
}

function derivePreview(plainText: string): string {
  return plainText.replace(/\s+/g, ' ').trim().slice(0, 160)
}

function mapToOutreachSource(s: EmailSendSource): 'mcp' | 'ui' | 'auto' {
  // outreach_log enum is ('mcp', 'ui', 'auto'); digest_prompt collapses to ui.
  if (s === 'mcp') return 'mcp'
  return 'ui'
}

function simpleEmailHash(email: string): string {
  // Lightweight hash for the events payload — keeps the recipient address
  // out of the events table for the agent's records (the canonical record
  // lives on email_sends.to_email). Not for security; just for the contract.
  let h = 0
  for (let i = 0; i < email.length; i++) {
    h = (h * 31 + email.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

async function markSendStatus(
  admin: SupabaseClient,
  emailSendId: string,
  status: 'queued' | 'sent' | 'failed' | 'soft_bounced' | 'hard_bounced',
  errorCode: string | null,
  errorMessage: string | null,
) {
  await admin
    .from('email_sends')
    .update({
      status,
      error_code: errorCode,
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', emailSendId)
}

interface GmailSendResult {
  status: number
  ok: boolean
  body: unknown
  bodyText: string
}

async function callGmailSend(
  accessToken: string,
  rawBase64Url: string,
): Promise<GmailSendResult> {
  const res = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawBase64Url }),
  })
  const bodyText = await res.text().catch(() => '')
  let body: unknown
  try {
    body = bodyText ? JSON.parse(bodyText) : null
  } catch {
    body = bodyText
  }
  return { status: res.status, ok: res.ok, body, bodyText }
}
