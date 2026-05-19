/**
 * RFC 5322 + 2045 + 2046 minimal MIME builder for `gmail.users.messages.send`.
 *
 * Gmail's `raw` field accepts a base64url-encoded UTF-8 string of a full MIME
 * message. We build a `multipart/alternative` envelope so receiving clients
 * can choose between plain-text and HTML.
 *
 * Why a hand-rolled builder instead of nodemailer / mailparser:
 *   - We control exactly which headers ship (List-Unsubscribe is mandatory
 *     for Gmail's bulk-sender policy; nodemailer's defaults vary).
 *   - The output is a string; no transport object, no SMTP, no streams.
 *   - Zero dependency footprint beyond Node's `Buffer`.
 *
 * Constraints (Gmail-specific):
 *   - Header `From` MUST match the authenticated account or a verified
 *     send-as alias. The caller pins it to `agent_integrations.external_account`.
 *   - Line endings: CRLF (`\r\n`) per RFC 5322 §2.1. Bare LF is rejected by
 *     some MTAs; Gmail accepts both but the standard is CRLF.
 *   - `raw` MUST be **base64url** (RFC 4648 §5), NOT standard base64.
 */

import { randomBytes } from 'crypto'

export interface MimeMessageInput {
  /** Full email address of the sender. Optional display name supported. */
  from: string
  /** Recipient email address. */
  to: string
  /** Subject line (UTF-8). Encoded as RFC 2047 if non-ASCII. */
  subject: string
  /** Plain-text alternative body. */
  text: string
  /** HTML body. */
  html: string
  /**
   * Headers to attach. List-Unsubscribe + List-Unsubscribe-Post are the
   * primary use case here.
   */
  headers?: Record<string, string>
  /**
   * Optional Message-ID. If omitted, a fresh one is generated. Provide a
   * stable one (e.g. on retry) to avoid Gmail creating duplicate messages.
   */
  messageId?: string
  /** Optional In-Reply-To / References values for threading (V1.5). */
  inReplyTo?: string
  references?: string
  /** Optional Date override (defaults to now in RFC 2822 format). */
  date?: Date
}

export interface BuiltMime {
  /** The full RFC 5322 message (CRLF line endings). */
  raw: string
  /** Base64url-encoded form, ready to send as `{ raw }` to Gmail. */
  rawBase64Url: string
  /** The Message-ID actually used (returned to the caller for storage). */
  messageId: string
}

const CRLF = '\r\n'
const MESSAGE_ID_HOST = 'gohorace.com'

/**
 * Build the multipart/alternative MIME message + its base64url form.
 */
export function buildMimeMessage(input: MimeMessageInput): BuiltMime {
  const boundary = `=_horace_${randomBytes(12).toString('hex')}=`
  const messageId = input.messageId ?? generateMessageId()
  const date = formatRfc2822Date(input.date ?? new Date())

  const headers: Record<string, string> = {
    'MIME-Version': '1.0',
    Date: date,
    'Message-ID': messageId,
    From: encodeAddressHeader(input.from),
    To: encodeAddressHeader(input.to),
    Subject: encodeHeaderValue(input.subject),
    'Content-Type': `multipart/alternative; boundary="${boundary}"`,
    ...(input.inReplyTo ? { 'In-Reply-To': input.inReplyTo } : {}),
    ...(input.references ? { References: input.references } : {}),
    ...(input.headers ?? {}),
  }

  const headerBlock = Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join(CRLF)

  // Body parts: text first, then html (last part wins for clients that
  // pick the "richest" type — Gmail / Apple Mail / Outlook all render html).
  const textPart =
    `--${boundary}${CRLF}` +
    `Content-Type: text/plain; charset="UTF-8"${CRLF}` +
    `Content-Transfer-Encoding: 7bit${CRLF}` +
    `${CRLF}` +
    `${normalizeLineEndings(input.text)}`

  const htmlPart =
    `--${boundary}${CRLF}` +
    `Content-Type: text/html; charset="UTF-8"${CRLF}` +
    `Content-Transfer-Encoding: 7bit${CRLF}` +
    `${CRLF}` +
    `${normalizeLineEndings(input.html)}`

  const body =
    textPart + CRLF +
    htmlPart + CRLF +
    `--${boundary}--${CRLF}`

  const raw = headerBlock + CRLF + CRLF + body

  const rawBase64Url = Buffer.from(raw, 'utf8').toString('base64url')

  return { raw, rawBase64Url, messageId }
}

// ── Header helpers ──────────────────────────────────────────────────────────

/**
 * Encode an address header. Accepts either a bare `foo@bar.com` or a
 * `Name <foo@bar.com>` form; encodes the display name with RFC 2047 if
 * it contains non-ASCII or specials.
 */
export function encodeAddressHeader(addr: string): string {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(addr)
  if (!match) {
    // bare address
    return addr.trim()
  }
  const display = match[1].trim()
  const email = match[2].trim()
  if (!display) return email
  return `${encodeHeaderValue(display)} <${email}>`
}

/**
 * RFC 2047 encode a header value if it contains non-ASCII characters. Uses
 * `=?UTF-8?B?<base64>?=` form. ASCII-only strings pass through.
 */
export function encodeHeaderValue(value: string): string {
  // ASCII fast path — anything from 0x20..0x7e that isn't a special.
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value
  }
  const b64 = Buffer.from(value, 'utf8').toString('base64')
  return `=?UTF-8?B?${b64}?=`
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateMessageId(): string {
  return `<${randomBytes(20).toString('hex')}@${MESSAGE_ID_HOST}>`
}

function normalizeLineEndings(text: string): string {
  // Collapse \r\n and \r to \n first, then re-emit as CRLF.
  return text.replace(/\r\n?/g, '\n').replace(/\n/g, CRLF)
}

function formatRfc2822Date(d: Date): string {
  // toUTCString returns "Mon, 19 May 2026 07:43:20 GMT" — close enough to
  // RFC 2822 ("Mon, 19 May 2026 07:43:20 +0000"). Replace `GMT` with `+0000`
  // to match RFC 2822 strictly.
  return d.toUTCString().replace(/\bGMT\b/, '+0000')
}
