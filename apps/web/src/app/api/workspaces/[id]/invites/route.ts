/**
 * HOR-99 — POST /api/workspaces/[id]/invites
 *
 * Owner/admin creates an invite for a teammate. Generates a signed token,
 * stores its sha256 in `workspace_invites`, and sends the redemption link
 * via Resend using the existing `invite` action in email.ts.
 *
 * Behaviour:
 *   - Auth: caller must be owner or admin in `workspace_members` for :id.
 *   - Validation: email valid + lowercased; role ∈ {manager, agent}.
 *   - Idempotency: an existing outstanding (unaccepted, unrevoked, unexpired)
 *     invite for (workspace_id, lower(email)) is returned unchanged unless
 *     `?resend=true`. With ?resend=true, the token_hash + expires_at are
 *     replaced in-place and a new email is sent.
 *   - Expired outstanding invites are revoked, then a fresh row inserted.
 *   - Audit: writes a `notification_log` row of type 'email_workspace_invite'
 *     (added to the constraint by migration 20260513000001).
 *
 * `workspace_invites` is not yet in the generated Database types (the
 * migration that adds the table lands in this same PR chain), so the
 * supabase-js calls below use `as never` / cast back to a local row
 * interface. Regenerate types after merge to clean this up.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildMagicLinkEmail,
  buildInvitePlainText,
  type WorkspaceInviteContext,
} from '@/lib/notifications/email'
import { getAppUrl } from '@/lib/url'
import { reconcileSupportSeats } from '@/lib/stripe/support-seats'
import { logAudit, AuditAction } from '@/lib/audit/log'

const INVITE_TTL_DAYS = 7
const TOKEN_PREFIX = 'inv_'

type InviteRole = 'manager' | 'agent' | 'support'

interface WorkspaceInviteRow {
  id: string
  workspace_id: string
  email: string
  role: InviteRole
  invited_by: string
  token_hash: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function mintInviteToken(): { plaintext: string; hash: string } {
  const plaintext = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(plaintext).digest('hex')
  return { plaintext, hash }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace id required' }, { status: 400 })
  }

  // 1. Authn — current user.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse + validate body.
  let parsed: { email?: unknown; role?: unknown }
  try {
    parsed = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawEmail = typeof parsed.email === 'string' ? parsed.email.trim() : ''
  if (!rawEmail || !EMAIL_RE.test(rawEmail)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  const role = parsed.role
  if (role !== 'manager' && role !== 'agent' && role !== 'support') {
    return NextResponse.json(
      { error: 'role must be "manager", "agent", or "support"' },
      { status: 400 },
    )
  }
  const email = rawEmail.toLowerCase()

  // 3. ACL — caller must be owner or admin in workspace_members.
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    // 403 instead of 404 — don't leak workspace existence to non-members.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only owners and admins can invite' },
      { status: 403 },
    )
  }

  const resendFlag =
    (request.nextUrl.searchParams.get('resend') ?? '').toLowerCase() === 'true'

  // 4. Look for an existing outstanding (unaccepted, unrevoked) invite.
  const { data: existingRaw } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('workspace_invites' as any)
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle()

  const existing = existingRaw as WorkspaceInviteRow | null
  const now = new Date()
  const stillValid = existing ? new Date(existing.expires_at) > now : false

  // Fast path: existing valid invite, no resend requested → idempotent return.
  if (existing && stillValid && !resendFlag) {
    return NextResponse.json(
      {
        id: existing.id,
        email: existing.email,
        role: existing.role,
        expires_at: existing.expires_at,
        created_at: existing.created_at,
        resent: false,
      },
      { status: 200 },
    )
  }

  // From here we mint a new token. One of three paths:
  //   (a) no existing → INSERT
  //   (b) existing expired → revoke it, then INSERT fresh
  //   (c) existing valid + ?resend=true → UPDATE token_hash + expires_at in place
  const { plaintext, hash } = mintInviteToken()
  const expiresAt = new Date(
    now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  let invite: WorkspaceInviteRow

  if (existing && !stillValid) {
    // Revoke the expired row so the partial-unique index frees up.
    await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('workspace_invites' as any)
      .update({ revoked_at: now.toISOString() })
      .eq('id', existing.id)
  }

  if (existing && stillValid && resendFlag) {
    const { data: updatedRaw, error: updateErr } = await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('workspace_invites' as any)
      .update({ token_hash: hash, expires_at: expiresAt })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (updateErr || !updatedRaw) {
      console.error('Failed to update workspace_invite for resend', updateErr)
      return NextResponse.json({ error: 'Failed to update invite' }, { status: 500 })
    }
    invite = updatedRaw as WorkspaceInviteRow
  } else {
    const { data: insertedRaw, error: insertErr } = await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('workspace_invites' as any)
      .insert({
        workspace_id: workspaceId,
        email,
        role,
        invited_by: user.id,
        token_hash: hash,
        expires_at: expiresAt,
      })
      .select('*')
      .single()
    if (insertErr || !insertedRaw) {
      console.error('Failed to insert workspace_invite', insertErr)
      return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 })
    }
    invite = insertedRaw as WorkspaceInviteRow
  }

  // 4b. Support seats: reconcile Stripe quantity against the new
  // outstanding-invite + active-seat count. Idempotent; safe across all
  // three insert paths (new / replay-after-expire / resend) since
  // reconciliation reads from the source of truth in the db.
  // Best-effort: if Stripe fails we still keep the invite — the
  // settings UI will display a reconciliation warning.
  if (role === 'support') {
    try {
      await reconcileSupportSeats(workspaceId)
    } catch (err) {
      console.error('reconcileSupportSeats failed after invite insert', {
        workspaceId,
        inviteId: invite.id,
        err,
      })
    }
  }

  // 5. Fetch workspace + inviter context for the email body.
  const [{ data: workspace }, { data: inviterAgent }] = await Promise.all([
    admin.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    admin
      .from('agents')
      .select('id, first_name, last_name')
      .eq('user_id', user.id)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ])

  if (!workspace) {
    // We just confirmed membership for this workspace_id, so this is unexpected.
    console.error('Workspace not found after membership check', { workspaceId })
    return NextResponse.json({ error: 'Workspace not found' }, { status: 500 })
  }

  const inviterName =
    [inviterAgent?.first_name, inviterAgent?.last_name].filter(Boolean).join(' ') ||
    user.email ||
    'A teammate'

  // HOR-374/377: audit the invite (a role-grant action). The invite vocabulary
  // excludes 'admin', so no invite can escalate to Admin — the ceiling is
  // structural. Logged regardless of whether the email send below succeeds.
  await logAudit(admin, {
    workspaceId,
    actorUserId: user.id,
    actorAgentId: inviterAgent?.id ?? null,
    action: AuditAction.MemberInvite,
    resourceType: 'invite',
    resourceId: invite.id,
    metadata: { email, role, resent: Boolean(existing && stillValid && resendFlag) },
  })

  // 6. Send the email via Resend (HTML + plain-text fallback per HOR-103).
  const inviteUrl = `${getAppUrl()}/invite/accept?token=${plaintext}`
  const inviteContext: WorkspaceInviteContext = {
    workspaceName: workspace.name,
    inviterName,
    role,
  }
  const { subject, html } = buildMagicLinkEmail({
    action: 'invite',
    url: inviteUrl,
    email,
    inviteContext,
  })
  const text = buildInvitePlainText({ url: inviteUrl, inviteContext })

  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey) {
    console.error('RESEND_API_KEY not configured — invite row created but email not sent', {
      inviteId: invite.id,
    })
    return NextResponse.json(
      { error: 'Email service not configured' },
      { status: 500 },
    )
  }

  try {
    const { error: sendErr } = await new Resend(resendApiKey).emails.send({
      from:
        process.env.RESEND_FROM_EMAIL ?? 'Horace <noreply@gohorace.com>',
      to: email,
      subject,
      html,
      text,
    })
    if (sendErr) {
      console.error('Resend send failed for invite', { inviteId: invite.id, error: sendErr })
      return NextResponse.json(
        { error: 'Failed to send invite email' },
        { status: 502 },
      )
    }
  } catch (err) {
    console.error('Resend send threw for invite', { inviteId: invite.id, error: err })
    return NextResponse.json(
      { error: 'Failed to send invite email' },
      { status: 502 },
    )
  }

  // 7. Audit-log the send (best-effort — skip if inviter has no agents row).
  // The 'email_workspace_invite' type is added to the CHECK constraint by
  // migration 20260513000001 but isn't in database.types.ts until the types
  // are regenerated post-merge.
  if (inviterAgent?.id) {
    await admin.from('notification_log').insert({
      agent_id: inviterAgent.id,
      contact_id: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: 'email_workspace_invite' as any,
    })
  }

  // 8. Return metadata. Never the raw token.
  return NextResponse.json(
    {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at,
      created_at: invite.created_at,
      resent: Boolean(existing && stillValid && resendFlag),
    },
    { status: 201 },
  )
}
