/**
 * HOR-102 — /settings/team
 *
 * Server-rendered team management page. Fetches the workspace's
 * members + pending invites and the caller's role, then hands off
 * to the client TeamManager for interactions.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SectionHeading } from '@/components/ui/section-heading'
import { TeamManager, type MemberRow, type PendingInviteRow } from '@/components/settings/team-manager'

interface InviteFromDb {
  id: string
  email: string
  role: 'manager' | 'agent' | 'support'
  invited_by: string
  expires_at: string
  created_at: string
}

const SUPPORT_SEATS_ENABLED =
  process.env.NEXT_PUBLIC_SUPPORT_SEATS_ENABLED === 'true'

export default async function TeamSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()

  const { data: callerMembership } = await admin
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!callerMembership) {
    return (
      <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
        <div className="p-4 md:p-8 max-w-[660px]">
          <SectionHeading title="Team" description="Invite teammates to your workspace, manage roles, and revoke access." />
          <p className="text-sm text-[var(--fg-secondary)]">You don&apos;t belong to a workspace yet.</p>
        </div>
      </div>
    )
  }

  const workspaceId = callerMembership.workspace_id
  const callerRole = callerMembership.role as 'owner' | 'admin' | 'viewer'

  const { data: callerAgent } = await admin
    .from('agents')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('seat_type' as any)
    .eq('workspace_id', workspaceId)
    .eq('user_id', user!.id)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((callerAgent as any)?.seat_type === 'support') {
    return (
      <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
        <div className="p-4 md:p-8 max-w-[660px]">
          <SectionHeading title="Team" description="Invite teammates to your workspace, manage roles, and revoke access." />
          <p className="text-sm text-[var(--fg-secondary)]">
            Team management is handled by the workspace owner. Ask them if you need access changed.
          </p>
        </div>
      </div>
    )
  }

  const [
    { data: memberRows },
    { data: agentRows },
    { data: invitesRaw },
    { data: workspaceRow },
  ] = await Promise.all([
    admin.from('workspace_members').select('user_id, role, created_at').eq('workspace_id', workspaceId),
    admin
      .from('agents')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('user_id, first_name, last_name, email, role, seat_type, status, joined_at' as any)
      .eq('workspace_id', workspaceId),
    admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('workspace_invites' as any)
      .select('id, email, role, invited_by, expires_at, created_at')
      .eq('workspace_id', workspaceId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
    admin.from('workspaces').select('plan').eq('id', workspaceId).maybeSingle(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentByUser = new Map<string, any>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agentRows as any[] | null ?? []).map((a) => [a.user_id, a]),
  )

  const members: MemberRow[] = (memberRows ?? []).map((m) => {
    const a = agentByUser.get(m.user_id)
    return {
      userId: m.user_id,
      isSelf: m.user_id === user!.id,
      authRole: m.role as MemberRow['authRole'],
      agentRole: (a?.role ?? 'agent') as MemberRow['agentRole'],
      seatType: (a?.seat_type ?? 'agent') as MemberRow['seatType'],
      firstName: a?.first_name ?? null,
      lastName: a?.last_name ?? null,
      email: a?.email ?? null,
      joinedAt: a?.joined_at ?? m.created_at,
    }
  })

  const ownerCount = members.filter((m) => m.authRole === 'owner').length

  const invites: PendingInviteRow[] = (invitesRaw as InviteFromDb[] | null ?? []).map((inv) => {
    const inviter = agentByUser.get(inv.invited_by)
    const inviterName =
      [inviter?.first_name, inviter?.last_name].filter(Boolean).join(' ') ||
      inviter?.email ||
      'A teammate'
    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      inviterName,
      expiresAt: inv.expires_at,
      createdAt: inv.created_at,
    }
  })

  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8 max-w-[660px] space-y-5">
        <SectionHeading
          title="Team"
          description="Invite teammates and manage who can act on your signals."
        />
        <TeamManager
          workspaceId={workspaceId}
          callerRole={callerRole}
          ownerCount={ownerCount}
          workspacePlan={(workspaceRow?.plan as string | null) ?? null}
          supportSeatsEnabled={SUPPORT_SEATS_ENABLED}
          initialMembers={members}
          initialInvites={invites}
        />
      </div>
    </div>
  )
}
