/**
 * Site-probe shared types + URL / error helpers.
 *
 * Lives here rather than in route.ts because Next.js 14 App Router only
 * permits a fixed set of named exports from a `route.ts` file (the HTTP
 * verbs + a handful of config exports like `runtime`). Anything else
 * — type aliases, helper functions, test-exported utilities — fails the
 * type check with "X is not a valid Route export field".
 *
 * Both the route handler and the unit tests import from here. The
 * Turn 2 client (`turn-2-script.tsx`) also pulls SiteProbeResponse
 * and CmsKind from this module for fetch-call typing.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type CmsKind =
  | 'wordpress'
  | 'wix'
  | 'squarespace'
  | 'domain_portal'
  | 'rea_portal'
  | 'shopify'
  | 'webflow'
  | 'custom'
  | 'unknown'

export type SiteProbeFailReason = 'unreachable' | 'blocked' | 'parse' | 'timeout'

export type SiteProbeResponse =
  | { ok: true; finalUrl: string; host: string; listings: number; cms: CmsKind }
  | { ok: false; reason: SiteProbeFailReason }

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Normalise an agent-typed URL into a safe `URL` for fetching. Returns
 * null for anything we shouldn't probe — including private network
 * ranges (SSRF guard) and non-http(s) schemes.
 */
export function normaliseUrl(input: string): URL | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // Only prepend https:// when the input has no scheme at all. If the
  // agent typed file:// / ftp:// / javascript:, we keep the scheme so
  // the protocol check below can reject it explicitly — otherwise
  // "https://file:///etc/passwd" parses as host=file, which is sneaky.
  const hasAnyScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  const withScheme = hasAnyScheme ? trimmed : `https://${trimmed}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()
  // Reject LANs and internal networks even at validation time, before
  // we ever issue the outbound fetch. Belt-and-braces against SSRF.
  if (
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.endsWith('.local') ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)
  ) {
    return null
  }
  return u
}

/**
 * Map a thrown fetch error onto our discriminated failure reason.
 *
 *   • AbortError              → 'timeout'  (AbortSignal.timeout fired)
 *   • BlockedError            → 'blocked'  (route.ts throws this for >= 400)
 *   • TypeError with ENOTFOUND / ECONNREFUSED / EAI_AGAIN in .cause
 *                              → 'unreachable' (DNS or connect failure)
 *   • anything else           → 'unreachable' (default)
 */
export function classifyError(err: unknown): SiteProbeFailReason {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; code?: string; cause?: { code?: string } }
    if (e.name === 'AbortError') return 'timeout'
    if (e.name === 'BlockedError') return 'blocked'
    // node's undici surfaces DNS/connect failures as TypeError with a
    // .cause.code like ENOTFOUND / ECONNREFUSED — call that unreachable.
    const code = e.code ?? e.cause?.code
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN') {
      return 'unreachable'
    }
  }
  return 'unreachable'
}
