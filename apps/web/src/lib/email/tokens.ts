/**
 * HMAC-signed tokens for email pixel + click tracking (HOR-106 slice C).
 *
 * Format: `v1.<idHex>.<urlIdx>.<sig>`
 *   - idHex:   email_sends.id with hyphens stripped (32 hex chars).
 *              Full id (not a prefix) so the route handler can do an
 *              O(1) primary-key lookup. Cost: ~20 extra chars in the URL.
 *   - urlIdx:  'p' for the pixel; decimal integer for an entry in
 *              email_sends.links[].url_id.
 *   - sig:     first 16 chars of base64url(HMAC-SHA256(secret, `<idHex>.<urlIdx>`)).
 *              96 bits of entropy — plenty for a single-recipient link.
 *
 * The `v1.` prefix lets a future secret rotation run two secrets in parallel
 * (sign with `v2.`, verify both during the cutover, retire `v1.` once
 * pre-rotation emails age out).
 *
 * The HMAC binds to the exact idHex + urlIdx string, so a token for one
 * send can never be replayed against another send.
 */

import { createHmac, timingSafeEqual } from 'crypto'

const TOKEN_VERSION = 'v1'
const SIG_LENGTH = 16
const ID_HEX_LENGTH = 32

function trackingSecret(): string {
  // Prefer a dedicated secret; fall back to the service-role key so the
  // tracking endpoints don't go dark if EMAIL_TRACKING_SECRET is briefly
  // unset. Rotating either invalidates all in-flight tokens, which is
  // exactly the kill-switch behaviour we want.
  return process.env.EMAIL_TRACKING_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY!
}

// ── Encode / decode the id portion ──────────────────────────────────────────

/** Strip hyphens from a uuid. Returns 32 hex chars. */
export function sendIdToHex(sendId: string): string {
  return sendId.replace(/-/g, '')
}

/** Reconstruct a uuid (with hyphens) from a 32-hex-char id. Returns null if malformed. */
export function hexToSendId(hex: string): string | null {
  if (hex.length !== ID_HEX_LENGTH) return null
  if (!/^[0-9a-f]+$/.test(hex)) return null
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// ── Sign ────────────────────────────────────────────────────────────────────

function computeSig(idHex: string, urlIdxStr: string): string {
  return createHmac('sha256', trackingSecret())
    .update(`${idHex}.${urlIdxStr}`)
    .digest('base64url')
    .slice(0, SIG_LENGTH)
}

export function signPixelToken(sendId: string): string {
  const idHex = sendIdToHex(sendId)
  const sig = computeSig(idHex, 'p')
  return `${TOKEN_VERSION}.${idHex}.p.${sig}`
}

export function signClickToken(sendId: string, urlIdx: number): string {
  if (!Number.isInteger(urlIdx) || urlIdx < 0) {
    throw new Error(`signClickToken: urlIdx must be a non-negative integer (got ${urlIdx})`)
  }
  const idHex = sendIdToHex(sendId)
  const urlIdxStr = String(urlIdx)
  const sig = computeSig(idHex, urlIdxStr)
  return `${TOKEN_VERSION}.${idHex}.${urlIdxStr}.${sig}`
}

// ── Verify ──────────────────────────────────────────────────────────────────

export interface ParsedToken {
  /** uuid form with hyphens, ready to .eq('id', sendId) on email_sends. */
  sendId: string
  /** 'p' for the pixel; non-negative integer for a click into links[urlIdx]. */
  urlIdx: 'p' | number
}

/**
 * Parse + verify a token. Returns the decoded payload on success, null on any
 * failure (malformed, wrong version, bad sig). Constant-time signature compare.
 */
export function verifyToken(rawToken: string): ParsedToken | null {
  if (!rawToken) return null
  const parts = rawToken.split('.')
  if (parts.length !== 4) return null

  const [version, idHex, urlIdxStr, sig] = parts
  if (version !== TOKEN_VERSION) return null
  if (idHex.length !== ID_HEX_LENGTH || !/^[0-9a-f]+$/.test(idHex)) return null
  if (sig.length !== SIG_LENGTH) return null

  const expected = computeSig(idHex, urlIdxStr)
  // Lengths are both SIG_LENGTH at this point; still guard before timingSafeEqual.
  if (expected.length !== sig.length) return null
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null

  let urlIdx: 'p' | number
  if (urlIdxStr === 'p') {
    urlIdx = 'p'
  } else {
    // Reject leading zeros + non-decimal to make verification round-trip exact.
    if (!/^(0|[1-9][0-9]{0,2})$/.test(urlIdxStr)) return null
    urlIdx = Number(urlIdxStr)
  }

  const sendId = hexToSendId(idHex)
  if (!sendId) return null

  return { sendId, urlIdx }
}
