import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export const AUTH_CODE_TTL_SECONDS = 600          // 10 minutes
// Short-lived now that refresh tokens exist: a leaked access token is only
// useful for an hour, and revocation (clearing the row) actually bites.
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60   // 1 hour
// Long-lived but rotated on every use, and reissued (sliding) on each refresh
// — so an actively-used connector never expires, an abandoned one does.
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365  // 1 year
export const DEFAULT_SCOPE = 'mcp'

/**
 * Generate a public client identifier. Not a secret on its own — just an
 * opaque random string used to look up the client.
 */
export function generateClientId(): string {
  return 'mcp_' + randomBytes(16).toString('base64url')
}

/**
 * Short-lived authorization code (used once at /oauth/token). Stored in
 * plaintext in the codes table (acceptable: TTL is minutes, table RLS is
 * service-role only, codes are single-use).
 */
export function generateAuthCode(): string {
  return 'code_' + randomBytes(24).toString('base64url')
}

export function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url')
}

/**
 * PKCE verification (RFC 7636 §4.6). The client provided a code_challenge at
 * authorize time; at token time it must hand us the code_verifier whose
 * SHA-256 base64url-encoded equals the stored challenge.
 */
export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== 'S256') return false
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false
  const expected = sha256Base64Url(verifier)
  if (expected.length !== challenge.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(challenge))
  } catch {
    return false
  }
}

/**
 * Validate a registration redirect_uri. We require absolute http(s) URIs.
 * Loopback (http://localhost / 127.0.0.1) is allowed for desktop clients
 * per the OAuth 2.1 best-practice draft.
 */
export function isValidRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri)
    if (u.protocol === 'https:') return true
    if (u.protocol === 'http:') {
      const h = u.hostname
      return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
    }
    return false
  } catch {
    return false
  }
}
