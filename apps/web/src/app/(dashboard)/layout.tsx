import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Sidebar } from '@/components/dashboard/sidebar'
import { MobileNav } from '@/components/dashboard/mobile-nav'
import { PairingOverlay } from '@/components/dashboard/pairing-overlay'
import { NotificationsSlideOver } from '@/components/notifications/slide-over'
import { CompanionProvider } from '@/components/companion/companion-context'
import { CompanionMount } from '@/components/companion/companion-mount'
import { ComposerDockProvider } from '@/components/email/composer-dock-context'
import { ComposerDockMount } from '@/components/email/composer-dock-mount'
import { FeaturebaseMessenger } from '@/components/featurebase/featurebase-provider'
import { signFeaturebaseJwt } from '@/lib/featurebase/jwt'
import { fetchAttentionCount } from '@/lib/notifications/attention-count'
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

  // Attention count for the sidebar bell badge and the BellButton in
  // page headers. V1 definition lives in `lib/notifications/attention-count.ts`
  // — high-intent contacts (score >= 50) + unread notification_log entries
  // with display copy. Slice B will broaden the unread half once
  // moment_type lands.
  const admin = createAdminClient()
  const attentionCount = await fetchAttentionCount(admin, agent.id)

  const trialDaysLeft = computeTrialDaysLeft(
    workspace?.subscription_status,
    workspace?.current_period_end,
  )

  // Featurebase identity — signed server-side so messenger conversations
  // attribute to this agent. Returns null (→ anonymous) until
  // FEATUREBASE_JWT_SECRET is configured. Names may be blank during onboarding;
  // `trim() || undefined` keeps the claim out of the JWT when so.
  const featurebaseJwt =
    signFeaturebaseJwt({
      userId: user.id,
      email: user.email,
      name: `${agent.first_name ?? ''} ${agent.last_name ?? ''}`.trim() || undefined,
      profilePicture: agent.avatar_url ?? undefined,
    }) ?? undefined

  return (
    <FeaturebaseMessenger featurebaseJwt={featurebaseJwt}>
    <CompanionProvider>
     <ComposerDockProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Desktop sidebar — hidden on mobile. Collapse pref lives client-side
          * in `useSidebarPref` (localStorage). attentionCount is still fetched
          * for the bell-button in page topbars and the notifications stream. */}
        <div className="hidden md:flex">
          <Sidebar
            orgName={workspaceName}
            agentFirstName={agent.first_name}
            agentLastName={agent.last_name}
            avatarUrl={agent.avatar_url}
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

        {/* HOR-165 — iOS PWA standalone fallback. Renders the push
          * permission prompt only if a pairing is in flight AND the
          * page is running in standalone display mode. Inert in all
          * other contexts. */}
        <PairingOverlay />

        {/* Notifications slide-over — full-width on mobile, 420px
          * right-anchored on desktop. Hash-driven (`#notifications`).
          * The bell button in each page's topbar toggles the hash. */}
        <NotificationsSlideOver />

        {/* Horace companion — global drawer + Quill trigger. Pages call
          * `useCompanion().openCompanion({...})` from any Ask Horace CTA.
          * v2-M2 (HOR-243). */}
        <CompanionMount />

        {/* Tracked-email composer dock — global modeless surface. Entry
          * points call `useComposerDock().openComposer({...})`. HOR-354. */}
        <ComposerDockMount />
      </div>
     </ComposerDockProvider>
    </CompanionProvider>
    </FeaturebaseMessenger>
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
