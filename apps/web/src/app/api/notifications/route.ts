import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchStreamMoments } from '@/lib/notifications/fetch'

export const dynamic = 'force-dynamic'

/**
 * Notifications stream feed. Returns enriched `StreamMoment[]` ready
 * for `<NotificationStream items=…>` — same adapter pipeline the page
 * uses for SSR, just over the wire.
 *
 * Used by the desktop slide-over panel for client-side fetch + paging.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Agent timezone — used for bucket boundaries + time-ago formatting.
  const { data: settings } = await supabase
    .from('agent_settings')
    .select('timezone')
    .eq('agent_id', agent.id)
    .maybeSingle()

  const cursor = req.nextUrl.searchParams.get('cursor')

  try {
    const result = await fetchStreamMoments({
      supabase,
      agentId: agent.id,
      cursor: cursor ?? undefined,
      tz: settings?.timezone ?? null,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[notifications] list failed:', err)
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 })
  }
}
