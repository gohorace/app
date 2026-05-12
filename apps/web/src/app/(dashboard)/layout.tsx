import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/dashboard/sidebar'
import { MobileNav } from '@/components/dashboard/mobile-nav'
import { requireActiveSubscription } from '@/lib/billing/gate'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get agent record for this user (includes workspace_id)
  const { data: agent } = await supabase
    .from('agents')
    .select('id, workspace_id, first_name, last_name')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent || !agent.workspace_id) {
    // User has no workspace yet — send to onboarding
    redirect('/signup')
  }

  // Get workspace name + subscription state
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('name, snippet_key, subscription_status')
    .eq('id', agent.workspace_id)
    .maybeSingle()

  requireActiveSubscription(workspace?.subscription_status)

  const workspaceName = workspace?.name ?? 'My Agency'

  const { count: unreadActivity } = await supabase
    .from('notification_log')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agent.id)
    .is('read_at', null)
    .not('title', 'is', null)

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:flex">
        <Sidebar
          orgName={workspaceName}
          agentFirstName={agent.first_name}
          agentLastName={agent.last_name}
          unreadActivity={unreadActivity ?? 0}
        />
      </div>

      {/* Main content — overflow hidden here; each page manages its own scroll */}
      <main className="flex-1 overflow-hidden flex flex-col h-full">
        {children}
      </main>

      {/* Mobile bottom tab bar — hidden on desktop */}
      <div className="md:hidden">
        <MobileNav unreadActivity={unreadActivity ?? 0} />
      </div>
    </div>
  )
}
