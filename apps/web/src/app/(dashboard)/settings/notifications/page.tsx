import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NotificationsForm } from '@/components/settings/notifications-form'
import { SectionHeading } from '@/components/ui/section-heading'

export default async function NotificationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, email')
    .eq('user_id', user!.id)
    .maybeSingle()

  const { data: settings } = await admin
    .from('agent_settings')
    .select('agent_email, briefing_emails, timezone, daily_briefing_hour, sms_threshold_score, push_alert_mode')
    .eq('agent_id', agent!.id)
    .single()

  // Default briefing recipients: stored list, or fall back to agent email
  const defaultEmails: string[] =
    settings?.briefing_emails?.length
      ? settings.briefing_emails
      : [agent?.email ?? settings?.agent_email ?? ''].filter(Boolean)

  // The dashboard <main> is `overflow-hidden h-full` and delegates scrolling
  // to each page (see (dashboard)/layout.tsx). Without an own scroll container
  // the form is clipped and "Save settings" is unreachable (HOR-297). Mirror
  // the profile settings page's `flex-1 overflow-y-auto` wrapper.
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-6 md:p-8 max-w-lg space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Alerts & briefing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure push notifications and your daily email round-up
          </p>
        </div>
        <NotificationsForm
          initial={{
            push_alert_mode:     (settings?.push_alert_mode as 'threshold' | 'all' | 'hourly_digest') ?? 'threshold',
            alert_threshold:      settings?.sms_threshold_score  ?? 50,
            briefing_emails:      defaultEmails,
            timezone:             settings?.timezone             ?? 'Australia/Sydney',
            daily_briefing_hour:  settings?.daily_briefing_hour  ?? 17,
          }}
        />
      </div>
    </div>
  )
}
