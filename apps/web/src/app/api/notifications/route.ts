import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

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

  const cursor = req.nextUrl.searchParams.get('cursor')

  let q = supabase
    .from('notification_log')
    .select('id, type, contact_id, title, body, url, sent_at, read_at')
    .eq('agent_id', agent.id)
    .not('title', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(PAGE_SIZE + 1)

  if (cursor) {
    q = q.lt('sent_at', cursor)
  }

  const { data, error } = await q
  if (error) {
    console.error('[activity] list failed:', error)
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 })
  }

  const hasMore = (data?.length ?? 0) > PAGE_SIZE
  const items = hasMore ? data!.slice(0, PAGE_SIZE) : (data ?? [])
  const nextCursor = hasMore ? items[items.length - 1].sent_at : null

  return NextResponse.json({ items, nextCursor })
}
