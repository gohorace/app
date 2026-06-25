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
  /**
   * The agent the email is sent AS — the vendor-facing / Gmail identity and the
   * value written to email_sends.agent_id. For a Support seat acting on behalf of
   * a linked agent this is the LINKED agent (resolved + authorized by the caller),
   * not the support seat. For a normal agent it's themselves.
   */
  agentId: string
  workspaceId: string
  /**
   * HOR-378: the human who actually performed the send. Differs from the agent's
   * owning user when a Support seat sends on behalf of a linked agent. Null on the
   * MCP path (the bearer token IS the agent). Never collapsed into agentId.
   */
  actingUserId?: string | null
  /** Where the request came from. Defaults to 'ui'. */
  source?: EmailSendSource
}

/** Result of parking a scheduled send (HOR-357) — no Gmail ids yet. */
export interface ScheduledEmailResult {
  email_send_id: string
  scheduled_at: string
}

export async function sendTrackedEmail(
  ctx: SendTrackedEmailContext,
  payloadIn: EmailSendPayload,
): Promise<EmailSendResult> {
  const payload = normalizePayload(payloadIn)
  const contactRow = await resolveRecipientContact(ctx, payload)
  const emailSendId = await insertEmailSendRow(ctx, contactRow.id, payload, 'queued', null)
  return dispatchSend(ctx, emailSendId, contactRow.id, payload)
}

/**
 * Schedule a tracked email for later delivery (HOR-357). Runs the same
 * validation + exclusion + ownership front-matter as an immediate send, then
 * parks a `status='scheduled'` row with `scheduled_at`. The pg_cron worker
 * (`/api/cron/process-scheduled-emails`) later claims the row and calls
 * `dispatchScheduledRow`, which routes through the exact same `dispatchSend`
 * core — so a scheduled send is identical to an immediate one, just deferred.
 *
 * Exclusion is re-checked at dispatch time too: an unsubscribe between
 * scheduling and firing must still block the send.
 */
export async function scheduleTrackedEmail(
  ctx: SendTrackedEmailContext,
  payloadIn: EmailSendPayload,
  scheduledAtIso: string,
): Promise<ScheduledEmailResult> {
  const at = new Date(scheduledAtIso)
  if (Number.isNaN(at.getTime())) {
    throw new SendTrackedEmailError('invalid_input', 400, 'scheduled_at must be an ISO timestamp')
  }
  if (at.getTime() <= Date.now()) {
    throw new SendTrackedEmailError('invalid_input', 400, 'scheduled_at must be in the future')
  }
  const payload = normalizePayload(payloadIn)
  const contactRow = await resolveRecipientContact(ctx, payload)
  const emailSendId = await insertEmailSendRow(ctx, contactRow.id, payload, 'scheduled', at.toISOString())
  return { email_send_id: emailSendId, scheduled_at: at.toISOString() }
}

/** A contact resolved + authorized for a send. */
interface ResolvedContact {
  id: string
  email: string | null
  agent_id: string | null
  owner_agent_id: string | null
}

/**
 * Shared front-matter for send + schedule: exclusion check (steps 3) then
 * contact load + ownership (step 4). Throws SendTrackedEmailError on any gate.
 */
async function resolveRecipientContact(
  ctx: SendTrackedEmailContext,
  payload: NormalizedPayload,
): Promise<ResolvedContact> {
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
  const contactRow = contact as ResolvedContact
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
  return contactRow
}

/**
 * Insert the email_sends row. `status` is 'queued' for an immediate send (the
 * dispatcher flips it to 'sent') or 'scheduled' for a deferred one.
 */
async function insertEmailSendRow(
  ctx: SendTrackedEmailContext,
  contactId: string,
  payload: NormalizedPayload,
  status: 'queued' | 'scheduled',
  scheduledAt: string | null,
): Promise<string> {
  const { data: insertedRow, error: insertErr } = await ctx.admin
    .from('email_sends')
    .insert({
      workspace_id: ctx.workspaceId,
      agent_id: ctx.agentId,
      contact_id: contactId,
      to_email: payload.toEmail,
      subject: payload.subject,
      body_html: payload.bodyHtml,
      body_text: payload.bodyText,
      tracked: payload.tracked,
      provider: 'gmail',
      status,
      scheduled_at: scheduledAt,
      links: [],
      source: ctx.source ?? 'ui',
      // HOR-378: acting_user_id isn't in the generated types yet (regen deferred).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ acting_user_id: ctx.actingUserId ?? null } as any),
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
  return (insertedRow as { id: string }).id
}

/**
 * Dispatch an already-inserted email_sends row through Gmail (steps 5–13):
 * resolve token + sender, rewrite + pixel, build MIME, send-with-retry, mark
 * sent, dual-write outreach_log + emit the event. Shared by the immediate
 * path (`sendTrackedEmail`) and the scheduled worker (`dispatchScheduledRow`)
 * so a deferred send reuses the exact same logic without a second row.
 *
 * Ordering note (HOR-357): token/sender resolution now happens *after* the
 * row insert (it used to precede it). On a token-revoked failure the queued
 * row therefore persists — which matches how transient Gmail failures already
 * leave a retryable 'queued' row.
 */
async function dispatchSend(
  ctx: SendTrackedEmailContext,
  emailSendId: string,
  contactId: string,
  payload: NormalizedPayload,
): Promise<EmailSendResult> {
  // ── Step 5: get a valid access token ──────────────────────────────────────
  let accessToken: string
  try {
    accessToken = await getValidAccessToken(ctx.admin, ctx.agentId)
  } catch (err) {
    if (err instanceof RefreshRevokedError) {
      await markSendStatus(ctx.admin, emailSendId, 'failed', 'auth', 'Gmail connection revoked')
      throw new SendTrackedEmailError(
        'token_revoked',
        409,
        'Gmail connection has been revoked. Reconnect from Settings → Integrations.',
      )
    }
    if (err instanceof WorkspaceAdminBlockedError) {
      await markSendStatus(ctx.admin, emailSendId, 'failed', 'auth', 'Workspace admin blocked app access')
      throw new SendTrackedEmailError(
        'token_revoked',
        409,
        'Google Workspace admin has blocked third-party app access.',
      )
    }
    if (err instanceof Error && /No Gmail integration/i.test(err.message)) {
      await markSendStatus(ctx.admin, emailSendId, 'failed', 'no_integration', 'No Gmail integration')
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

  // Sender display name — sourced from the agent's Horace profile, NOT the
  // Google account name. Decoupled deliberately so the From name is stable
  // across a Gmail reconnect/swap and stays under Horace's control. Falls back
  // to the bare address when the agent has no name on file.
  const { data: agentRow } = await ctx.admin
    .from('agents')
    .select('first_name, last_name')
    .eq('id', ctx.agentId)
    .maybeSingle()
  const fromHeader = formatFromHeader(agentRow as AgentNameRow | null, fromAddress)

  const contactRow = { id: contactId }

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
    from: fromHeader,
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

// ── Scheduled-send worker (HOR-357) ───────────────────────────────────────────

/** A due scheduled row, as loaded by the cron worker. */
export interface DueScheduledRow {
  id: string
  agent_id: string
  workspace_id: string
  contact_id: string | null
  to_email: string
  subject: string
  body_html: string
  body_text: string | null
  tracked: boolean
  source: EmailSendSource
}

/**
 * Dispatch one due scheduled row. Re-runs the recipient guard (an unsubscribe
 * since scheduling must still block) and routes through the shared
 * `dispatchSend`. Claims the row optimistically (`scheduled → queued`) so a
 * double-tick of the cron can't send twice. Returns the send result, or
 * throws SendTrackedEmailError on a hard failure (the worker logs + continues).
 */
export async function dispatchScheduledRow(
  admin: SupabaseClient,
  row: DueScheduledRow,
): Promise<EmailSendResult> {
  // Optimistic claim — only the tick that flips scheduled→queued proceeds.
  const { data: claimed } = await admin
    .from('email_sends')
    .update({ status: 'queued', updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle()
  if (!claimed) {
    throw new SendTrackedEmailError('invalid_input', 409, `Row ${row.id} already claimed`)
  }

  const ctx: SendTrackedEmailContext = {
    admin,
    agentId: row.agent_id,
    workspaceId: row.workspace_id,
    source: row.source,
  }
  if (!row.contact_id) {
    await markSendStatus(admin, row.id, 'failed', 'invalid_input', 'scheduled row missing contact_id')
    throw new SendTrackedEmailError('invalid_input', 400, `Row ${row.id} has no contact_id`)
  }

  const payload: NormalizedPayload = {
    contactId: row.contact_id,
    toEmail: row.to_email,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text ?? derivePlainText(row.body_html),
    tracked: row.tracked,
  }

  // Re-check the recipient guard at fire time.
  await resolveRecipientContact(ctx, payload)

  return dispatchSend(ctx, row.id, row.contact_id, payload)
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
  // Allowlist covers TipTap StarterKit + Link extension output PLUS the
  // styled email-signature block (HOR-xxx): `<img>` for the agent's logo and
  // a constrained set of inline styles on `p`/`span`/`div`/`img` so the
  // signature keeps its layout. `<img>` is locked to http/https schemes
  // (no `cid:`, no `data:`, no `javascript:`).
  const cleanHtml = sanitizeHtml(rawHtml, {
    allowedTags: [
      'p', 'br', 'span', 'div',
      'b', 'strong', 'i', 'em', 'u',
      'a',
      'img',
      'ul', 'ol', 'li',
      'blockquote', 'code',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'style'],
      p: ['style'],
      span: ['style'],
      div: ['style'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
      a: ['http', 'https', 'mailto', 'tel'],
      img: ['http', 'https'],
    },
    allowedStyles: {
      '*': {
        color: [/^#(?:[0-9a-f]{3}){1,2}$/i, /^rgb\(/i, /^rgba\(/i, /^[a-z\-]+$/i],
        'font-weight': [/^(?:bold|normal|\d{3})$/i],
        'font-style': [/^(?:italic|normal)$/i],
        'text-decoration': [/^(?:underline|none)$/i],
        margin: [/^[0-9 .pxem%-]+$/i],
        'max-height': [/^[0-9.]+(?:px|em|%)$/i],
        'max-width': [/^[0-9.]+(?:px|em|%)$/i],
        height: [/^[0-9.]+(?:px|em|%)$/i],
        width: [/^[0-9.]+(?:px|em|%)$/i],
        display: [/^(?:block|inline|inline-block)$/i],
      },
    },
    disallowedTagsMode: 'discard',
    // Strip on* event handlers (allowedAttributes is an explicit whitelist
    // so anything not listed — class, data-*, on* — is dropped).
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

interface AgentNameRow {
  first_name?: string | null
  last_name?: string | null
}

/**
 * Build the `From` header value from the agent's Horace name + verified Gmail
 * address. Returns `Display Name <email>` when a name exists, else the bare
 * address. The display name is quoted if it contains RFC 5322 specials
 * (e.g. a comma in "Smith, John"); non-ASCII is handled downstream by
 * mime.ts → encodeAddressHeader (RFC 2047).
 */
function formatFromHeader(agent: AgentNameRow | null, email: string): string {
  const name = [agent?.first_name, agent?.last_name]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ')
  if (!name) return email
  // RFC 5322 specials that force a quoted-string display name.
  const display = /[()<>@,;:\\".[\]]/.test(name)
    ? `"${name.replace(/(["\\])/g, '\\$1')}"`
    : name
  return `${display} <${email}>`
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
  // outreach_log enum is ('mcp', 'ui', 'auto'). Only 'mcp' maps through; every
  // UI surface — including the composer-dock entry points (stream/contact/
  // companion) and digest_prompt — collapses to 'ui'. Per-surface attribution
  // lives on email_sends.source; outreach_log stays coarse. (HOR-356)
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
