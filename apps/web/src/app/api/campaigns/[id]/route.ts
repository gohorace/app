import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
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

  // Verify campaign belongs to this agent
  const { data: campaign, error: campaignError } = await admin
    .from('campaigns')
    .select('id, name, description, created_at')
    .eq('id', params.id)
    .eq('agent_id', agentId)
    .maybeSingle()

  if (campaignError) return NextResponse.json({ error: campaignError.message }, { status: 500 })
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Fetch tokens with contact info
  const { data: tokens, error: tokensError } = await admin
    .from('campaign_tokens')
    .select('id, token, clicked_at, created_at, contacts(id, first_name, last_name, email, phone)')
    .eq('campaign_id', params.id)
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true })

  if (tokensError) return NextResponse.json({ error: tokensError.message }, { status: 500 })

  return NextResponse.json({ campaign, tokens: tokens ?? [] })
}
