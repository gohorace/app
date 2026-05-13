import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { error } = await supabase
    .from('notification_log')
    .update({ read_at: new Date().toISOString() })
    .eq('agent_id', agent.id)
    .is('read_at', null)
    .not('title', 'is', null)

  if (error) {
    console.error('[activity] mark-all-read failed:', error)
    return NextResponse.json({ error: 'Failed to mark all read' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
