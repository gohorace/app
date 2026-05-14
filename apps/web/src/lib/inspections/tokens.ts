/**
 * Doorstep public-token helpers.
 *
 * Tokens live in the URL path: `https://gohorace.com/i/<token>`. They are
 * 8-character base62 strings drawn from the existing `generateShortCode`
 * alphabet (excludes the ambiguous `O` / `l` characters), giving
 * ~218 trillion combinations — enumeration-resistant without an extra
 * server round-trip on every public capture page load.
 *
 * Same shape and provenance as the `/c/<token>` tracked-link codes
 * (see lib/outreach/links.ts). One generator, one alphabet, one length —
 * keep them aligned so future readers don't second-guess which surface
 * a loose code came from.
 */

import { generateShortCode } from '@/lib/outreach/links'

export const INSPECTION_TOKEN_LENGTH = 8

/**
 * Generate a fresh public capture token. Caller is responsible for
 * collision-checking via the UNIQUE constraint on `inspections.token` —
 * at 60^8 combos and current expected volumes, an in-memory retry on
 * insert is the cheaper path than a pre-flight existence check.
 */
export function generate(): string {
  return generateShortCode(INSPECTION_TOKEN_LENGTH)
}

/**
 * Cheap structural check before hitting the database. Useful for the
 * public capture endpoint's 404 fast-path on obviously-malformed tokens
 * (random scanners, bots, copy-paste errors). DB lookup is still the
 * authoritative answer for "does this token exist?".
 */
export function isWellFormed(token: string | null | undefined): boolean {
  if (!token || token.length !== INSPECTION_TOKEN_LENGTH) return false
  // Same 60-char alphabet as generateShortCode in lib/outreach/links.ts:
  // digits + A-Z (minus O) + a-z (minus l).
  return /^[0-9A-NP-Za-km-z]{8}$/.test(token)
}
