import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAttentionCount } from '@/lib/notifications/attention-count'
import { SupportView } from '@/components/support/support-view'

// /support — v2 help hub (HOR-251). Replaces the v2-M1 stub.
// Ask Horace CTA, "Start here" hero, guides + talk-to-a-human grid,
// moss status strip. Static config in lib/support/status.ts (live feed
// is HOR-261 / v2-D8).
export const dynamic = 'force-dynamic'

export default async function SupportPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent) redirect('/signup')

  const admin = createAdminClient()
  const attentionCount = await fetchAttentionCount(admin, agent.id)

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#F5F0E8' }}>
      <SupportView attentionCount={attentionCount} />
    </div>
  )
}
