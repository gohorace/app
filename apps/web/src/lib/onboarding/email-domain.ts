/**
 * Helpers for turning an agent's email into a sensible "your site"
 * suggestion in Turn 2. Generic inbox providers get filtered out — if
 * the agent signed up with gmail.com we have no signal about their
 * agency site and shouldn't pretend otherwise.
 */

const GENERIC_PROVIDERS = new Set<string>([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.com.au',
  'ymail.com',
  'hotmail.com',
  'hotmail.com.au',
  'outlook.com',
  'outlook.com.au',
  'live.com',
  'live.com.au',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'fastmail.com',
  'gmx.com',
  'duck.com',
  'mail.com',
])

/** Extract a host suggestion from the agent's email. Returns null for
 *  generic providers and malformed input — the caller should fall back
 *  to an empty placeholder in that case. */
export function suggestedHostFromEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at < 0 || at === email.length - 1) return null
  const raw = email.slice(at + 1).trim().toLowerCase()
  if (!raw || raw.includes(' ')) return null
  if (GENERIC_PROVIDERS.has(raw)) return null
  // Basic sanity — must look like a host with at least one dot.
  if (!raw.includes('.')) return null
  return raw
}

/** Pre-fill value for the website input. Includes the scheme so the
 *  agent can confirm with one click. */
export function suggestedUrlFromEmail(email: string | null | undefined): string {
  const host = suggestedHostFromEmail(email)
  return host ? `https://${host}` : ''
}
