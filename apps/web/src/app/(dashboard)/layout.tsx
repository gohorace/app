import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/dashboard/sidebar'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get org for this user
  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id, orgs(name)')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    // User has no org yet — send to onboarding
    redirect('/signup')
  }

  const orgName = (membership.orgs as { name: string } | null)?.name ?? 'My Agency'

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar orgName={orgName} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
