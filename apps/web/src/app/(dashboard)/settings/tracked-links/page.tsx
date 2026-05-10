import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TrackedLinksSettings } from '@/components/settings/tracked-links-settings'

export default async function TrackedLinksSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const { data: settings } = agent
    ? await admin
        .from('agent_settings')
        .select('website_url')
        .eq('agent_id', agent.id)
        .maybeSingle()
    : { data: null }

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <TrackedLinksSettings defaultUrl={settings?.website_url ?? null} />
    </div>
  )
}
