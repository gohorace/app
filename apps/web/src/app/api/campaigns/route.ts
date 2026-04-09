import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'No agent found' }, { status: 400 })
  const agentId = agent.id

  // Fetch campaigns with token + click counts
  const { data: campaigns, error } = await admin
    .from('campaigns')
    .select('id, name, description, created_at, campaign_tokens(id, clicked_at)')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = (campaigns ?? []).map((c) => {
    const tokens = c.campaign_tokens ?? []
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      created_at: c.created_at,
      token_count: tokens.length,
      clicked_count: tokens.filter((t) => t.clicked_at !== null).length,
    }
  })

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'No agent found' }, { status: 400 })
  const agentId = agent.id

  let body: { name?: string; description?: string; target_url?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, target_url } = body
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 422 })
  if (!target_url?.trim())
    return NextResponse.json({ error: 'target_url is required' }, { status: 422 })

  const { data: campaign, error } = await admin
    .from('campaigns')
    .insert({ agent_id: agentId, name: name.trim(), description: target_url.trim() })
    .select('id, name, description, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(campaign, { status: 201 })
}
