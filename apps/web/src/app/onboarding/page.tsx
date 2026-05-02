import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: workspace } = agent?.workspace_id
    ? await admin
        .from('workspaces')
        .select('snippet_key')
        .eq('id', agent.workspace_id)
        .maybeSingle()
    : { data: null }

  const snippetKey = workspace?.snippet_key ?? ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.com'

  return <OnboardingWizard snippetKey={snippetKey} appUrl={appUrl} />
}
