import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProfileSettings } from '@/components/settings/profile-settings'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, first_name, last_name, workspace_id, avatar_url')
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
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <ProfileSettings
        agentId={agent?.id ?? null}
        firstName={agent?.first_name ?? null}
        lastName={agent?.last_name ?? null}
        email={user?.email ?? null}
        avatarUrl={agent?.avatar_url ?? null}
        workspaceName={workspace?.name ?? 'My Agency'}
      />
    </div>
  )
}
