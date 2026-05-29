import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SettingsNav } from '@/components/settings/settings-nav'

/**
 * HOR-329 — Settings shell. Replaces the mobile-style link list with a
 * persistent section rail (desktop) / tab strip (mobile) + content pane.
 * Each section remains its own route under /settings/* and fetches its own
 * data; this layout only frames them and resolves the seat type for gating.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = user
    ? await admin
        .from('agents')
        .select('id, workspace_id')
        .eq('user_id', user.id)
        .maybeSingle()
    : { data: null }

  // HOR-203: seat_type isn't in generated types yet — fetch it separately.
  const { data: seatRow } = agent
    ? await admin
        .from('agents')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select('seat_type' as any)
        .eq('id', agent.id)
        .maybeSingle()
    : { data: null }
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
  const workspaceName = workspace?.name ?? 'your agency'

  return (
    <div className="flex h-full flex-col bg-[var(--bg-page)]">
      <header className="shrink-0 px-4 pb-4 pt-6 md:px-8">
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-[var(--fg-primary)]">
          Settings
        </h1>
        <p className="mt-0.5 text-sm text-[var(--fg-secondary)]">
          Manage {workspaceName} and how Horace works for your team.
        </p>
      </header>

      {seatType === 'support' && (
        <div className="mx-4 mb-2 flex items-center gap-2.5 rounded-md border border-[rgba(61,82,70,0.2)] bg-[rgba(61,82,70,0.08)] px-3.5 py-2.5 md:mx-8">
          <p className="text-xs leading-relaxed text-[var(--fg-primary)]">
            You&apos;re on a support seat. Team and billing are managed by the workspace owner —
            everything else here is yours to set.
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <SettingsNav seatType={seatType} />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
