import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProfileSettings } from '@/components/settings/profile-settings'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  // Typed query for the columns in database.types.ts.
  const { data: agent } = await admin
    .from('agents')
    .select('id, first_name, last_name, workspace_id, avatar_url')
    .eq('user_id', user!.id)
    .maybeSingle()

  // HOR-203: seat_type isn't in generated types yet — fetch it separately.
  const { data: seatRow } = agent
    ? await admin
        .from('agents')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select('seat_type' as any)
        .eq('id', agent.id)
        .maybeSingle()
    : { data: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seatType: 'agent' | 'support' =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((seatRow as any)?.seat_type ?? 'agent') as 'agent' | 'support'

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
        seatType={seatType}
      />
    </div>
  )
}
