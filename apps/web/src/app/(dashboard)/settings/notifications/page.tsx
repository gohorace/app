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
    .select('agent_email, briefing_emails, timezone, daily_briefing_hour, push_alert_mode')
    .eq('agent_id', agent!.id)
    .single()

  const defaultEmails: string[] =
    settings?.briefing_emails?.length
      ? settings.briefing_emails
      : [agent?.email ?? settings?.agent_email ?? ''].filter(Boolean)

  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8 max-w-[660px] space-y-5">
        <SectionHeading
          title="Alerts & briefing"
          description="When Horace pings your phone, and the daily email round-up."
        />
        <NotificationsForm
          initial={{
            push_alert_mode:     (settings?.push_alert_mode as 'threshold' | 'all' | 'hourly_digest') ?? 'threshold',
            briefing_emails:      defaultEmails,
            timezone:             settings?.timezone             ?? 'Australia/Sydney',
            daily_briefing_hour:  settings?.daily_briefing_hour  ?? 17,
          }}
        />
      </div>
    </div>
  )
}
