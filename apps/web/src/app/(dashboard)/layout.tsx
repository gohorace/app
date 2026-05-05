import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/dashboard/sidebar'
import { MobileNav } from '@/components/dashboard/mobile-nav'

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

  // Get workspace name
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('name, snippet_key')
    .eq('id', agent.workspace_id)
    .maybeSingle()

  const workspaceName = workspace?.name ?? 'My Agency'

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:flex">
        <Sidebar
          orgName={workspaceName}
          agentFirstName={agent.first_name}
          agentLastName={agent.last_name}
        />
      </div>

      {/* Main content — bottom padding on mobile to clear tab bar */}
      <main className="flex-1 overflow-y-auto p-0 pb-[env(safe-area-inset-bottom)] md:pb-0">
        <div className="pb-20 md:pb-0">
          {children}
        </div>
      </main>

      {/* Mobile bottom tab bar — hidden on desktop */}
      <div className="md:hidden">
        <MobileNav />
      </div>
    </div>
  )
}
