/**
 * HOR-102 / HOR-203 — TeamManager client component.
 *
 * Renders members + pending invites in two sections (Agents and
 * Support), plus the invite form. Wires to:
 *   - POST   /api/workspaces/:id/invites             (HOR-99)
 *   - POST   /api/workspaces/:id/invites?resend=true (HOR-99)
 *   - DELETE /api/workspaces/:id/invites/:inviteId   (HOR-101)
 *   - DELETE /api/workspaces/:id/members/:userId     (HOR-101)
 *
 * Permission model:
 *   - viewer: read-only (no invite form, no destructive actions).
 *   - admin:  can invite, revoke, resend. Cannot remove members.
 *   - owner:  can do everything. Sole-owner guard prevents removing self
 *             when ownerCount === 1.
 *
 * Support seats (HOR-203):
 *   - `seatType` discriminates agent vs support on each row.
 *   - Pro plan: invite picker offers only "Support" (the single agent
 *     slot belongs to the workspace owner).
 *   - Office/Enterprise: picker offers Agent / Manager / Support.
 *   - Feature-flagged via NEXT_PUBLIC_SUPPORT_SEATS_ENABLED; off-state
 *     restores the legacy Agent/Manager-only picker.
 */

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const SUPPORT_SEAT_MONTHLY_AUD = 39

export interface MemberRow {
  userId: string
  isSelf: boolean
  authRole: 'owner' | 'admin' | 'viewer'
  agentRole: 'admin' | 'manager' | 'agent'
  seatType: 'agent' | 'support'
  firstName: string | null
  lastName: string | null
  email: string | null
  joinedAt: string
}

export interface PendingInviteRow {
  id: string
  email: string
  role: 'manager' | 'agent' | 'support'
  inviterName: string
  expiresAt: string
  createdAt: string
}

interface Props {
  workspaceId: string
  callerRole: 'owner' | 'admin' | 'viewer'
  ownerCount: number
  workspacePlan: string | null
  supportSeatsEnabled: boolean
  initialMembers: MemberRow[]
  initialInvites: PendingInviteRow[]
}

const ROLE_DISPLAY: Record<MemberRow['agentRole'], string> = {
  admin: 'Admin',
  manager: 'Manager',
  agent: 'Agent',
}

function inviteRoleDisplay(role: PendingInviteRow['role']): string {
  switch (role) {
    case 'manager':
      return 'Manager'
    case 'support':
      return 'Support'
    case 'agent':
    default:
      return 'Agent'
  }
}

function isProPlan(plan: string | null): boolean {
  return !!plan && plan.startsWith('pro')
}

export function TeamManager({
  workspaceId,
  callerRole,
  ownerCount,
  workspacePlan,
  supportSeatsEnabled,
  initialMembers,
  initialInvites,
}: Props) {
  const router = useRouter()
  const [members, setMembers] = useState<MemberRow[]>(initialMembers)
  const [invites, setInvites] = useState<PendingInviteRow[]>(initialInvites)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const canInvite = callerRole === 'owner' || callerRole === 'admin'
  const canRemove = callerRole === 'owner'
  const proPlan = isProPlan(workspacePlan)

  // Pro plan with the support-seats flag on: only support seats are
  // invitable (the single agent slot is the account owner).
  const inviteOptions: PendingInviteRow['role'][] = supportSeatsEnabled
    ? proPlan
      ? ['support']
      : ['agent', 'manager', 'support']
    : ['agent', 'manager']

  function flash(kind: 'success' | 'error', text: string) {
    setToast({ kind, text })
    setTimeout(() => setToast(null), 4000)
  }

  // -- Invite form ----------------------------------------------------------
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<PendingInviteRow['role']>(
    inviteOptions[0] ?? 'agent',
  )
  const [inviteBusy, setInviteBusy] = useState(false)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!canInvite) return
    setInviteBusy(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        flash('error', body?.error ?? `Failed (${res.status})`)
        return
      }
      const newRow: PendingInviteRow = {
        id: body.id,
        email: body.email,
        role: body.role,
        inviterName: 'You',
        expiresAt: body.expires_at,
        createdAt: body.created_at,
      }
      const isExisting = body.resent === false && res.status === 200
      setInvites((prev) => {
        const filtered = prev.filter((p) => p.id !== newRow.id)
        return [newRow, ...filtered]
      })
      setInviteEmail('')
      const wasSupport = newRow.role === 'support'
      flash(
        'success',
        isExisting
          ? `Invite already pending for ${newRow.email}.`
          : wasSupport
            ? `Support seat added. $${SUPPORT_SEAT_MONTHLY_AUD}/mo, billed with your plan.`
            : `Invite sent to ${newRow.email}.`,
      )
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Network error')
    } finally {
      setInviteBusy(false)
    }
  }

  async function handleRevoke(invite: PendingInviteRow) {
    if (!canInvite) return
    const prev = invites
    setInvites((p) => p.filter((i) => i.id !== invite.id))
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/invites/${invite.id}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setInvites(prev)
        flash('error', body?.error ?? `Failed (${res.status})`)
        return
      }
      flash('success', `Revoked invite for ${invite.email}.`)
    } catch (err) {
      setInvites(prev)
      flash('error', err instanceof Error ? err.message : 'Network error')
    }
  }

  async function handleResend(invite: PendingInviteRow) {
    if (!canInvite) return
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/invites?resend=true`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: invite.email, role: invite.role }),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        flash('error', body?.error ?? `Failed (${res.status})`)
        return
      }
      setInvites((p) =>
        p.map((i) => (i.id === body.id ? { ...i, expiresAt: body.expires_at } : i)),
      )
      flash('success', `Resent invite to ${invite.email}.`)
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Network error')
    }
  }

  async function handleRemove(member: MemberRow) {
    if (!canRemove) return
    if (!confirm(`Remove ${displayName(member)} from this workspace?`)) return

    const prev = members
    setMembers((m) => m.filter((x) => x.userId !== member.userId))
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/members/${member.userId}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setMembers(prev)
        flash('error', body?.error ?? `Failed (${res.status})`)
        return
      }
      flash('success', `Removed ${displayName(member)}.`)
      if (member.authRole === 'owner') {
        router.refresh()
      }
    } catch (err) {
      setMembers(prev)
      flash('error', err instanceof Error ? err.message : 'Network error')
    }
  }

  // -- Split by seat type ---------------------------------------------------
  const agentMembers = members.filter((m) => m.seatType === 'agent')
  const supportMembers = members.filter((m) => m.seatType === 'support')
  const agentInvites = invites.filter((i) => i.role !== 'support')
  const supportInvites = invites.filter((i) => i.role === 'support')

  const supportMonthlyCost =
    (supportMembers.length + supportInvites.length) * SUPPORT_SEAT_MONTHLY_AUD

  return (
    <div className="space-y-8">
      {toast && (
        <div
          className={
            toast.kind === 'success'
              ? 'rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900'
              : 'rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'
          }
        >
          {toast.text}
        </div>
      )}

      {/* Invite form */}
      {canInvite ? (
        <form onSubmit={handleInvite} className="space-y-3">
          <div className="text-sm font-medium">Invite a teammate</div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invite-role">
                {supportSeatsEnabled && proPlan ? 'Type' : 'Role'}
              </Label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as PendingInviteRow['role'])}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                disabled={inviteOptions.length <= 1}
              >
                {inviteOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {inviteRoleDisplay(opt)}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={inviteBusy || !inviteEmail.trim()}>
              {inviteBusy ? 'Sending…' : 'Send invite'}
            </Button>
          </div>
          {supportSeatsEnabled && proPlan && (
            <p className="text-xs text-muted-foreground">
              On Pro, your agent slot is the account owner. Support seats are
              for admins, PAs, or sales support who action signals on your behalf.
            </p>
          )}
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to invite teammates. Ask the workspace owner.
        </p>
      )}

      {/* Agents section */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-medium">Agents</div>
          <div className="text-xs text-muted-foreground">
            {agentMembers.length} {agentMembers.length === 1 ? 'agent' : 'agents'}
          </div>
        </div>

        {agentInvites.length > 0 && (
          <ul className="divide-y divide-border rounded-md border">
            {agentInvites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{inv.email}</div>
                  <div className="text-xs text-muted-foreground">
                    Pending · {inviteRoleDisplay(inv.role)} · invited by {inv.inviterName} · expires {formatExpiry(inv.expiresAt)}
                  </div>
                </div>
                {canInvite && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleResend(inv)}>
                      Resend
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleRevoke(inv)}>
                      Revoke
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {agentMembers.length === 0 && agentInvites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border">
            {agentMembers.map((m) => (
              <MemberLi
                key={m.userId}
                member={m}
                canRemove={canRemove}
                ownerCount={ownerCount}
                onRemove={handleRemove}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Support section (gated behind the feature flag) */}
      {supportSeatsEnabled && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium">Support</div>
            <div className="text-xs text-muted-foreground">
              {supportMembers.length + supportInvites.length}{' '}
              {supportMembers.length + supportInvites.length === 1 ? 'seat' : 'seats'}
              {supportMonthlyCost > 0 && ` · $${supportMonthlyCost}/mo`}
            </div>
          </div>

          {supportInvites.length > 0 && (
            <ul className="divide-y divide-border rounded-md border">
              {supportInvites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{inv.email}</div>
                    <div className="text-xs text-muted-foreground">
                      Pending · Support · invited by {inv.inviterName} · expires {formatExpiry(inv.expiresAt)}
                    </div>
                  </div>
                  {canInvite && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleResend(inv)}>
                        Resend
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleRevoke(inv)}>
                        Revoke
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {supportMembers.length === 0 && supportInvites.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No support seats yet. Add one when you&apos;ve got an admin or PA
              who&apos;d help action signals.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border">
              {supportMembers.map((m) => (
                <MemberLi
                  key={m.userId}
                  member={m}
                  canRemove={canRemove}
                  ownerCount={ownerCount}
                  onRemove={handleRemove}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function MemberLi({
  member: m,
  canRemove,
  ownerCount,
  onRemove,
}: {
  member: MemberRow
  canRemove: boolean
  ownerCount: number
  onRemove: (m: MemberRow) => void
}) {
  const disableRemove = m.isSelf && m.authRole === 'owner' && ownerCount <= 1
  return (
    <li className="flex items-center justify-between gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {displayName(m)}
          {m.isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          {m.seatType === 'support' ? 'Support' : ROLE_DISPLAY[m.agentRole]} · {m.email ?? '—'} · joined {formatJoined(m.joinedAt)}
        </div>
      </div>
      {canRemove && !m.isSelf && (
        <Button variant="outline" size="sm" onClick={() => onRemove(m)}>
          Remove
        </Button>
      )}
      {canRemove && m.isSelf && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRemove(m)}
          disabled={disableRemove}
          title={disableRemove ? 'Promote another member to owner first.' : undefined}
        >
          Remove
        </Button>
      )}
    </li>
  )
}

function displayName(m: MemberRow): string {
  return (
    [m.firstName, m.lastName].filter(Boolean).join(' ') ||
    m.email ||
    'Unknown'
  )
}

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (days >= 1) return `in ${days} day${days === 1 ? '' : 's'}`
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  return 'soon'
}

function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
