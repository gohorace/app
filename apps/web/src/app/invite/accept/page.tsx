/**
 * HOR-100 — /invite/accept?token=<plaintext>
 *
 * Server component. Hashes the token, looks up the invite row, and
 * either:
 *   - renders an error if revoked / accepted / expired / not found, or
 *   - renders workspace + inviter context + a CTA child component
 *     that triggers the magic-link send via Supabase Auth.
 *
 * The magic link comes back to /auth/callback with `invite_id` in the
 * URL — the callback validates again (defense in depth) and calls the
 * accept_workspace_invite RPC.
 */

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { AcceptInviteCta } from './accept-cta'

interface InviteRow {
  id: string
  workspace_id: string
  email: string
  role: 'manager' | 'agent'
  invited_by: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
}

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

type LookupResult =
  | { ok: true; invite: InviteRow; workspaceName: string; inviterName: string }
  | { ok: false; reason: 'invalid' | 'revoked' | 'accepted' | 'expired' }

async function lookupInvite(token: string): Promise<LookupResult> {
  const admin = createAdminClient()
  const { data: inviteRaw } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_invites' as any)
    .select('id, workspace_id, email, role, invited_by, expires_at, accepted_at, revoked_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle()

  const invite = inviteRaw as InviteRow | null
  if (!invite) return { ok: false, reason: 'invalid' }
  if (invite.revoked_at) return { ok: false, reason: 'revoked' }
  if (invite.accepted_at) return { ok: false, reason: 'accepted' }
  if (new Date(invite.expires_at) <= new Date()) return { ok: false, reason: 'expired' }

  // Fetch workspace name + inviter display name for the page render.
  const [{ data: workspace }, { data: inviterAgent }] = await Promise.all([
    admin.from('workspaces').select('name').eq('id', invite.workspace_id).maybeSingle(),
    admin
      .from('agents')
      .select('first_name, last_name')
      .eq('user_id', invite.invited_by)
      .eq('workspace_id', invite.workspace_id)
      .maybeSingle(),
  ])

  if (!workspace) return { ok: false, reason: 'invalid' }

  const inviterName =
    [inviterAgent?.first_name, inviterAgent?.last_name].filter(Boolean).join(' ') || 'A teammate'

  return { ok: true, invite, workspaceName: workspace.name, inviterName }
}

const ERROR_COPY: Record<'invalid' | 'revoked' | 'accepted' | 'expired', { heading: string; body: string }> = {
  invalid: {
    heading: 'Invalid invite link',
    body: "We couldn't find this invite. The link may be malformed or no longer valid.",
  },
  revoked: {
    heading: 'Invite revoked',
    body: 'This invite was revoked by the workspace owner. Ask them to send a new one if you still need access.',
  },
  accepted: {
    heading: 'Invite already used',
    body: 'This invite was already accepted. Try signing in instead — you should already have access to the workspace.',
  },
  expired: {
    heading: 'Invite expired',
    body: 'This invite expired before it was used. Ask the workspace owner to send you a fresh one.',
  },
}

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token: tokenParam } = await searchParams
  const token = typeof tokenParam === 'string' ? tokenParam : ''

  if (!token) {
    return <ErrorState {...ERROR_COPY.invalid} />
  }

  const result = await lookupInvite(token)
  if (!result.ok) {
    return <ErrorState {...ERROR_COPY[result.reason]} />
  }

  const { invite, workspaceName, inviterName } = result
  const roleLabel = invite.role === 'manager' ? 'manager' : 'agent'

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Join {workspaceName} on Horace
          </h1>
          <p className="text-sm text-muted-foreground">
            {inviterName} invited you to join {workspaceName} as a {roleLabel}.
          </p>
        </div>
        <AcceptInviteCta inviteId={invite.id} email={invite.email} />
        <p className="text-xs text-muted-foreground">
          The link expires {formatExpiry(invite.expires_at)}.
        </p>
      </div>
    </div>
  )
}

function ErrorState({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        <p className="text-xs text-muted-foreground pt-2">
          <a href="/login" className="underline">
            Go to sign in
          </a>
        </p>
      </div>
    </div>
  )
}

function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt)
  return date.toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
