/**
 * HOR-102 — /settings/team
 *
 * Server-rendered team management page. Fetches the workspace's
 * members + pending invites and the caller's role, then hands off
 * to the client TeamManager for interactions.
 *
 * `workspace_invites` isn't in database.types.ts yet — local row
 * interface + as-any cast on the .from() call. Regenerate types
 * post-merge to clean this up.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Users } from 'lucide-react'
import { TeamManager, type MemberRow, type PendingInviteRow } from '@/components/settings/team-manager'

interface InviteFromDb {
  id: string
  email: string
  role: 'manager' | 'agent'
  invited_by: string
  expires_at: string
  created_at: string
}

export default async function TeamSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()

  // Find caller's workspace + role.
  const { data: callerMembership } = await admin
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!callerMembership) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-muted-foreground mt-2">
          You don&apos;t belong to a workspace yet.
        </p>
      </div>
    )
  }

  const workspaceId = callerMembership.workspace_id
  const callerRole = callerMembership.role as 'owner' | 'admin' | 'viewer'

  // Fetch members. workspace_members carries the auth role; agents carries
  // the operational role + name + email. Two queries + stitch in JS — small
  // member counts per workspace make this fine.
  const [
    { data: memberRows },
    { data: agentRows },
    { data: invitesRaw },
  ] = await Promise.all([
    admin
      .from('workspace_members')
      .select('user_id, role, created_at')
      .eq('workspace_id', workspaceId),
    admin
      .from('agents')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('user_id, first_name, last_name, email, role, status, joined_at' as any)
      .eq('workspace_id', workspaceId),
    admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('workspace_invites' as any)
      .select('id, email, role, invited_by, expires_at, created_at')
      .eq('workspace_id', workspaceId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
  ])

  // Stitch agents into members by user_id.
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
      firstName: a?.first_name ?? null,
      lastName: a?.last_name ?? null,
      email: a?.email ?? null,
      joinedAt: a?.joined_at ?? m.created_at,
    }
  })

  // Count owners (for sole-owner-guard hint in the UI).
  const ownerCount = members.filter((m) => m.authRole === 'owner').length

  // Stitch inviter name into invites.
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

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-muted-foreground">
          Invite teammates to your workspace, manage roles, and revoke access.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Members &amp; invites
          </CardTitle>
          <CardDescription>
            Owners can remove members and manage everything. Admins can invite
            and revoke. Viewers see this page read-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TeamManager
            workspaceId={workspaceId}
            callerRole={callerRole}
            ownerCount={ownerCount}
            initialMembers={members}
            initialInvites={invites}
          />
        </CardContent>
      </Card>
    </div>
  )
}
