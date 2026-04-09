import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NewCampaignForm } from './new-campaign-form'

export default async function NewCampaignPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const agentId = agent!.id

  const { data: contacts } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email, phone')
    .eq('agent_id', agentId)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .limit(2000)

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New campaign</h1>
        <p className="text-muted-foreground">
          Set a target URL, pick your contacts, and generate personalised tracked links.
        </p>
      </div>
      <NewCampaignForm contacts={contacts ?? []} />
    </div>
  )
}
