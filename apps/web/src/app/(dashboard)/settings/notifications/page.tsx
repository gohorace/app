import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NotificationsForm } from '@/components/settings/notifications-form'

export default async function NotificationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  const { data: settings } = await admin
    .from('agent_settings')
    .select('agent_email, timezone, daily_briefing_hour, sms_threshold_score')
    .eq('agent_id', agent!.id)
    .single()

  return (
    <div className="p-6 md:p-8 max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Alerts & briefing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your daily brief and prospect alerts
        </p>
      </div>
      <NotificationsForm
        initial={{
          agent_email:          settings?.agent_email          ?? '',
          timezone:             settings?.timezone             ?? 'Australia/Sydney',
          daily_briefing_hour:  settings?.daily_briefing_hour  ?? 17,
          alert_threshold:      settings?.sms_threshold_score  ?? 50,
        }}
      />
    </div>
  )
}
