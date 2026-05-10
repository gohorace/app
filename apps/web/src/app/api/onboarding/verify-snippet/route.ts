import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent?.workspace_id) {
    return NextResponse.json({ verified: false, eventCount: 0 })
  }

  const { count, error } = await admin
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', agent.workspace_id)

  if (error) {
    console.error('[verify-snippet]', error)
    return NextResponse.json({ verified: false, eventCount: 0 })
  }

  const eventCount = count ?? 0
  return NextResponse.json({ verified: eventCount > 0, eventCount })
}
