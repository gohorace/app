import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import { mintToken } from '@/lib/mcp/auth'

const createSchema = z.object({
  name: z.string().min(1).max(80).trim(),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('workspace_api_tokens')
    .select('id, name, last_used_at, revoked_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to load tokens' }, { status: 500 })
  return NextResponse.json({ tokens: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })

  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  const { plaintext, hash } = mintToken()

  const { data: row, error } = await admin
    .from('workspace_api_tokens')
    .insert({
      workspace_id: agent.workspace_id,
      agent_id: agent.id,
      user_id: user.id,
      name: parsed.data.name,
      token_hash: hash,
    })
    .select('id, name, created_at')
    .single()

  if (error || !row) {
    console.error('Token mint failed:', error)
    return NextResponse.json({ error: 'Failed to mint token' }, { status: 500 })
  }

  return NextResponse.json({
    token: { id: row.id, name: row.name, created_at: row.created_at },
    plaintext,
  })
}
