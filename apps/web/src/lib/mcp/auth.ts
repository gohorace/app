import { createHash, randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const TOKEN_PREFIX = 'hor_'
const REFRESH_TOKEN_PREFIX = 'hor_rt_'

export interface McpAuthContext {
  workspaceId: string
  agentId: string
}

export function mintToken(): { plaintext: string; hash: string } {
  const plaintext = TOKEN_PREFIX + randomBytes(24).toString('base64url')
  const hash = hashToken(plaintext)
  return { plaintext, hash }
}

// Refresh tokens are stored (hashed) in oauth_refresh_tokens, not
// workspace_api_tokens, so they never resolve as bearer access tokens even
// though they share the `hor_` stem.
export function mintRefreshToken(): { plaintext: string; hash: string } {
  const plaintext = REFRESH_TOKEN_PREFIX + randomBytes(32).toString('base64url')
  return { plaintext, hash: hashToken(plaintext) }
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

export function extractBearer(headers: Headers): string | null {
  const auth = headers.get('authorization') ?? headers.get('Authorization')
  if (!auth) return null
  const match = /^Bearer\s+(.+)$/.exec(auth.trim())
  return match ? match[1].trim() : null
}

export async function authenticateRequest(req: Request): Promise<McpAuthContext | null> {
  const token = extractBearer(req.headers)
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('resolve_api_token', {
    p_token_hash: hashToken(token),
  })
  if (error || !data || data.length === 0) return null

  return {
    workspaceId: data[0].workspace_id,
    agentId: data[0].agent_id,
  }
}
