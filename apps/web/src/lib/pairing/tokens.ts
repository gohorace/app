/**
 * HOR-56 mobile pair tokens — mint and hash helpers.
 *
 * Tokens are minted as `pair_` + 32 random bytes (base64url). The raw
 * token is returned to the desktop once (to build the QR/SMS link)
 * and never persisted. Only sha256(raw_token) is stored on the
 * `pairing_tokens` row, mirroring the workspace_invites pattern at
 * apps/web/src/app/api/workspaces/[id]/invites/route.ts.
 *
 * Pure module — no DB, no Supabase, no env. Safe to import from both
 * server and edge runtimes, and trivially unit-testable.
 */

import { createHash, randomBytes } from 'crypto'

export const TOKEN_PREFIX = 'pair_'

/**
 * The signed token row TTL — also encoded into the cookie/localStorage
 * timeouts on the phone-install page. The handoff spec fixed this at
 * 15 minutes.
 */
export const TOKEN_TTL_SECONDS = 15 * 60

/**
 * Mint a fresh pairing token. Returns the plaintext (handed to the
 * desktop client once) and its sha256 hex digest (persisted on the
 * `pairing_tokens` row).
 */
export function mintPairingToken(): { plaintext: string; hash: string } {
  const plaintext = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  const hash = hashPairingToken(plaintext)
  return { plaintext, hash }
}

/**
 * Hash a previously-minted token for DB lookup. Deterministic — the
 * same plaintext always hashes to the same digest.
 */
export function hashPairingToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

/**
 * Loose sanity check on shape. Doesn't authenticate — that's what
 * the hash lookup does. Useful as an early-out before hitting the DB.
 */
export function looksLikePairingToken(value: string): boolean {
  if (!value.startsWith(TOKEN_PREFIX)) return false
  const body = value.slice(TOKEN_PREFIX.length)
  // base64url of 32 bytes is 43 characters with no padding.
  return /^[A-Za-z0-9_-]{43}$/.test(body)
}
