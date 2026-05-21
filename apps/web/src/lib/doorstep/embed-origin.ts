/**
 * HOR-284: hard origin-lock for the website embed.
 *
 * The embed (embed.js) is an unbranded, pasteable snippet, so the capture
 * endpoint must reject submissions whose browser Origin (or Referer host)
 * isn't one the workspace has authorised — its registered
 * `workspace_settings.snippet_domains` plus any verified Doorstep custom
 * domains. This server-side check is the real gate; CORS stays permissive
 * (no credentials are used), so security does NOT rest on the CORS header.
 *
 * Matching is on the bare, www-stripped, port-stripped hostname so that
 * `https://www.agent.com.au`, `https://agent.com.au:443`, and a stored
 * `agent.com.au` all compare equal.
 */

/** Lowercase bare hostname from a host / URL / origin string; '' if empty/unparseable. */
export function normalizeHost(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  let host = trimmed
  try {
    host = (trimmed.includes('://') ? new URL(trimmed) : new URL(`https://${trimmed}`)).host
  } catch {
    // leave as the raw trimmed value
  }
  host = host.split(':')[0] // strip port
  if (host.startsWith('www.')) host = host.slice(4)
  return host
}

/** The hostname the request claims to come from — Origin first, then Referer. */
export function requestHost(origin: string | null | undefined, referer: string | null | undefined): string {
  return normalizeHost(origin) || normalizeHost(referer)
}

/**
 * True when the request's Origin/Referer host matches one of the workspace's
 * allowed entries. Both sides are normalised to a bare, www-stripped host.
 * An empty `allowed` list rejects everything (hard lock by design — the agent
 * must register their site origin in the WPA before the embed will accept).
 */
export function isAllowedEmbedOrigin(
  origin: string | null | undefined,
  referer: string | null | undefined,
  allowed: string[],
): boolean {
  const host = requestHost(origin, referer)
  if (!host) return false
  const set = new Set(allowed.map(normalizeHost).filter(Boolean))
  return set.has(host)
}
