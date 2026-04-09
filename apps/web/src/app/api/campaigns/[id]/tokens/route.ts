import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateCampaignTokens } from '@/lib/campaigns/token'

export async function POST(
  request: NextRequest,
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
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, description')
    .eq('id', params.id)
    .eq('agent_id', agentId)
    .maybeSingle()

  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  let body: { contact_ids?: string[]; target_url?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { contact_ids, target_url } = body
  if (!contact_ids || contact_ids.length === 0) {
    return NextResponse.json({ error: 'contact_ids is required' }, { status: 422 })
  }

  const resolvedUrl = target_url ?? campaign.description ?? ''
  if (!resolvedUrl) {
    return NextResponse.json({ error: 'target_url is required' }, { status: 422 })
  }

  try {
    const results = await generateCampaignTokens(admin, agentId, params.id, contact_ids, resolvedUrl)
    return NextResponse.json({ generated: results.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
