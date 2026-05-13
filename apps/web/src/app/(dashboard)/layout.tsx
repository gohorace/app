import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
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
    .select('id, workspace_id, first_name, last_name, avatar_url')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent || !agent.workspace_id) {
    // User has no workspace yet — send to onboarding
    redirect('/signup')
  }

  // Get workspace name + subscription state (trial countdown reads current_period_end)
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('name, snippet_key, subscription_status, current_period_end')
    .eq('id', agent.workspace_id)
    .maybeSingle()

  requireActiveSubscription(workspace?.subscription_status)

  const workspaceName = workspace?.name ?? 'My Agency'

  // Attention count for the bell badge (admin client bypasses RLS for read-only count).
  // V1 definition: contacts with score >= 50. Will expand to include unhandled Worth-watching /
  // Newly-known prompts when those surfaces ship.
  const admin = createAdminClient()
  const { count: attentionCount } = await admin
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agent.id)
    .is('deleted_at', null)
    .gte('score', 50)

  const trialDaysLeft = computeTrialDaysLeft(
    workspace?.subscription_status,
    workspace?.current_period_end,
  )

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:flex">
        <Sidebar
          orgName={workspaceName}
          agentFirstName={agent.first_name}
          agentLastName={agent.last_name}
          avatarUrl={agent.avatar_url}
          attentionCount={attentionCount ?? 0}
          trialDaysLeft={trialDaysLeft}
        />
      </div>

      {/* Main content — overflow hidden here; each page manages its own scroll */}
      <main className="flex-1 overflow-hidden flex flex-col h-full">
        {children}
      </main>

      {/* Mobile bottom tab bar — hidden on desktop */}
      <div className="md:hidden">
        <MobileNav />
      </div>
    </div>
  )
}

function computeTrialDaysLeft(
  status: string | null | undefined,
  currentPeriodEnd: string | null | undefined,
): number | null {
  if (status !== 'trialing' || !currentPeriodEnd) return null
  const end = new Date(currentPeriodEnd).getTime()
  if (Number.isNaN(end)) return null
  const days = Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24))
  return Math.max(0, days)
}
