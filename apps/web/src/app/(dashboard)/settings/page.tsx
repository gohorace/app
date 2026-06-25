import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProfileSettings } from '@/components/settings/profile-settings'
import { BrandVoiceSettings } from '@/components/settings/brand-voice-settings'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  // Typed query for the columns in database.types.ts.
  const { data: agent } = await admin
    .from('agents')
    .select('id, first_name, last_name, workspace_id, avatar_url, phone')
    .eq('user_id', user!.id)
    .maybeSingle()

  // Time zone is canonical on agent_settings (it also drives the daily
  // briefing); the Profile form edits the same value the Alerts page does.
  // email_signature_html + email_signature_logo_url aren't in database.types.ts
  // yet (regen deferred) — read them via an `any` cast.
  const { data: settings } = agent
    ? await admin
        .from('agent_settings')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select('timezone, brand_voice, email_signature, email_signature_html, email_signature_logo_url' as any)
        .eq('agent_id', agent.id)
        .maybeSingle()
    : { data: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settingsAny = settings as any

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
        phone={agent?.phone ?? null}
        timezone={settingsAny?.timezone ?? null}
        workspaceName={workspace?.name ?? 'My Agency'}
        seatType={seatType}
      />

      {/* Brand voice + signature — powers Horace's email drafting and the
        * composer dock's setup gate. (HOR-356 follow-up) */}
      <div className="border-t border-[var(--border-subtle)]">
        <BrandVoiceSettings
          brandVoice={settingsAny?.brand_voice ?? null}
          emailSignatureHtml={settingsAny?.email_signature_html ?? null}
          emailSignatureLegacyText={settingsAny?.email_signature ?? null}
          emailSignatureLogoUrl={settingsAny?.email_signature_logo_url ?? null}
        />
      </div>
    </div>
  )
}
