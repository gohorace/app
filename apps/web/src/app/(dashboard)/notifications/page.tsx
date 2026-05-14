import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NotificationsPageClient } from '@/components/notifications/notifications-page-client'
import { buildScenario, type FixtureScenario } from '@/components/notifications/__fixtures__'
import { fetchStreamMoments } from '@/lib/notifications/fetch'

// Server component — always fresh. Mirrors the digest's pattern.
//
// `?demo=1[&state=…]` — design-review affordance, gated on VERCEL_ENV so
// production deploys never serve fixture data. Mirrors the same flag on
// the digest page. Valid `state` values: default, unread, caught,
// resolved, empty.
export const dynamic = 'force-dynamic'

const VALID_STATES = new Set<FixtureScenario>(['default', 'unread', 'caught', 'resolved', 'empty'])

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: { demo?: string; state?: string }
}) {
  const allowDemo = process.env.VERCEL_ENV !== 'production'

  if (allowDemo && searchParams.demo === '1') {
    const rawState = (searchParams.state ?? 'default') as FixtureScenario
    const state: FixtureScenario = VALID_STATES.has(rawState) ? rawState : 'default'
    const { items } = buildScenario(state)
    return (
      <div className="flex flex-col h-full overflow-hidden" style={{ background: '#F5F0E8' }}>
        <NotificationsPageClient initialItems={items} />
      </div>
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent) redirect('/signup')

  const { data: settings } = await supabase
    .from('agent_settings')
    .select('timezone')
    .eq('agent_id', agent.id)
    .maybeSingle()

  const { items } = await fetchStreamMoments({
    supabase,
    agentId: agent.id,
    tz: settings?.timezone ?? null,
  })

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#F5F0E8' }}>
      <NotificationsPageClient initialItems={items} />
    </div>
  )
}
