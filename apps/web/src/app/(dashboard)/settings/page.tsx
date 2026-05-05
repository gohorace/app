import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProfileSettings } from '@/components/settings/profile-settings'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, first_name, last_name, workspace_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const { data: workspace } = agent?.workspace_id
    ? await admin
        .from('workspaces')
        .select('name')
        .eq('id', agent.workspace_id)
        .maybeSingle()
    : { data: null }

  return (
    <ProfileSettings
      firstName={agent?.first_name ?? null}
      lastName={agent?.last_name ?? null}
      email={user?.email ?? null}
      workspaceName={workspace?.name ?? 'My Agency'}
    />
  )
}
