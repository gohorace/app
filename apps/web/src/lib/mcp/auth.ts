import { createHash, randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const TOKEN_PREFIX = 'hor_'

export interface McpAuthContext {
  workspaceId: string
  agentId: string
}

export function mintToken(): { plaintext: string; hash: string } {
  const plaintext = TOKEN_PREFIX + randomBytes(24).toString('base64url')
  const hash = hashToken(plaintext)
  return { plaintext, hash }
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
