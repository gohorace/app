import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ActivityList } from '@/components/dashboard/activity-list'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

export default async function ActivityPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent) redirect('/signup')

  const { data: items } = await supabase
    .from('notification_log')
    .select('id, type, contact_id, title, body, url, sent_at, read_at')
    .eq('agent_id', agent.id)
    .not('title', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(PAGE_SIZE + 1)

  const hasMore = (items?.length ?? 0) > PAGE_SIZE
  const initialItems = hasMore ? items!.slice(0, PAGE_SIZE) : (items ?? [])
  const initialCursor = hasMore ? initialItems[initialItems.length - 1].sent_at : null

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#F5F0E8' }}>
      <ActivityList
        initialItems={initialItems}
        initialCursor={initialCursor}
      />
    </div>
  )
}
