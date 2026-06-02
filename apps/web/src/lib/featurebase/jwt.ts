import { createHmac } from 'crypto'

/**
 * Featurebase identity-verification JWT (server-side only).
 *
 * Featurebase ties messenger conversations to a real contact via an HS256
 * JWT signed with the workspace's private key. We mint it on the server and
 * hand it to the client provider as `featurebaseJwt` — the secret never
 * reaches the browser.
 *
 * Secret lives in `FEATUREBASE_JWT_SECRET` (dashboard → Settings → Access &
 * Security → Security). When it's unset we return null and the messenger
 * runs anonymously — still fully functional, just unattributed.
 *
 * Hand-rolled rather than pulling in `jsonwebtoken`: the codebase already
 * signs its tokens with node `crypto` (see lib/email/tokens.ts, lib/mcp),
 * and a bare HS256 JWT is three base64url segments.
 */

export interface FeaturebaseIdentity {
  /** Stable Featurebase contact id — we use the Supabase auth user id. */
  userId: string
  email?: string
  name?: string
  /** Maps to the Featurebase contact avatar. */
  profilePicture?: string
}

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

/**
 * Returns a signed HS256 JWT carrying the agent's identity, or `null` when
 * `FEATUREBASE_JWT_SECRET` is unset (→ anonymous messenger).
 */
export function signFeaturebaseJwt(identity: FeaturebaseIdentity): string | null {
  const secret = process.env.FEATUREBASE_JWT_SECRET
  if (!secret) return null

  // Drop undefined claims so we never sign `email: undefined` etc.
  const payload: Record<string, unknown> = { userId: identity.userId }
  if (identity.email) payload.email = identity.email
  if (identity.name) payload.name = identity.name
  if (identity.profilePicture) payload.profilePicture = identity.profilePicture

  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')

  return `${header}.${body}.${signature}`
}
