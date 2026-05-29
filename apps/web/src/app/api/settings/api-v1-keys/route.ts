/**
 * HOR-322 · Agency API key management (admin-only, workspace-scoped).
 *
 * GET  — list the agency's hra_live_ keys (masked value + last-used + IP).
 * POST — mint a new key; the plaintext is returned ONCE and never again.
 *
 * These are dashboard (session-authed) routes, distinct from the /api/v1 surface
 * and from the user-scoped MCP /api/settings/api-tokens route.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'
import { mintApiV1Key, maskApiV1Key } from '@/lib/api-v1/keys'

const createSchema = z.object({ name: z.string().min(1).max(80).trim() })

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createApiV1Db()
  const ctx = await resolveAdminContext(db, user.id)
  if (!ctx) return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  if (!ctx.isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const { data, error } = await db
    .from('workspace_api_tokens')
    .select('id, name, key_hint, last_used_at, last_used_ip, revoked_at, created_at')
    .eq('workspace_id', ctx.workspaceId)
    .eq('kind', 'api_v1')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to load keys' }, { status: 500 })

  const keys = (data ?? []).map((k: Record<string, unknown>) => ({
    id: k.id,
    name: k.name,
    masked: maskApiV1Key(k.key_hint as string | null),
    last_used_at: k.last_used_at,
    last_used_ip: k.last_used_ip,
    revoked_at: k.revoked_at,
    created_at: k.created_at,
  }))
  return NextResponse.json({ keys })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Give the key a name.' }, { status: 400 })

  const db = createApiV1Db()
  const ctx = await resolveAdminContext(db, user.id)
  if (!ctx) return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  if (!ctx.isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const { plaintext, hash, hint } = mintApiV1Key()

  const { data: row, error } = await db
    .from('workspace_api_tokens')
    .insert({
      workspace_id: ctx.workspaceId,
      agent_id: ctx.agentId,
      user_id: user.id,
      name: parsed.data.name,
      token_hash: hash,
      kind: 'api_v1',
      key_hint: hint,
    })
    .select('id, name, key_hint, created_at')
    .single()

  if (error || !row) {
    console.error('api_v1 key mint failed:', error)
    return NextResponse.json({ error: 'Failed to mint key' }, { status: 500 })
  }

  // Plaintext shown exactly once.
  return NextResponse.json({
    key: {
      id: row.id,
      name: row.name,
      masked: maskApiV1Key(row.key_hint as string | null),
      created_at: row.created_at,
    },
    plaintext,
  })
}
