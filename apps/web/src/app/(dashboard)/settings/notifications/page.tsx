import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Bell } from 'lucide-react'
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
    .select('sms_enabled, agent_phone, sms_threshold_score, agent_email, weekly_briefing_day')
    .eq('agent_id', agent!.id)
    .single()

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground">Configure SMS alerts and weekly email briefings</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Notification settings
          </CardTitle>
          <CardDescription>
            Requires Twilio (SMS) and Resend (email) to be configured in your environment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationsForm
            initial={{
              sms_enabled: settings?.sms_enabled ?? false,
              agent_phone: settings?.agent_phone ?? null,
              sms_threshold_score: settings?.sms_threshold_score ?? 50,
              agent_email: settings?.agent_email ?? null,
              weekly_briefing_day: settings?.weekly_briefing_day ?? 1,
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
