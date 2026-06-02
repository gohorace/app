/**
 * HOR-102 / HOR-203 — TeamManager client component.
 *
 * Renders members + pending invites in two sections (Agents and
 * Support), plus the invite form. Wires to:
 *   - POST   /api/workspaces/:id/invites             (HOR-99)
 *   - POST   /api/workspaces/:id/invites?resend=true (HOR-99)
 *   - DELETE /api/workspaces/:id/invites/:inviteId   (HOR-101)
 *   - DELETE /api/workspaces/:id/members/:userId     (HOR-101)
 */

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CardLabel } from '@/components/ui/card-label'
import { EmptyState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { UserPlus, Mail, Send } from 'lucide-react'

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
    case 'manager': return 'Manager'
    case 'support': return 'Support'
    case 'agent':
    default: return 'Agent'
  }
}

function isProPlan(plan: string | null): boolean {
  return !!plan && plan.startsWith('pro')
}

function displayName(m: MemberRow): string {
  return [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email || 'Unknown'
}

function initials(m: MemberRow): string {
  const parts = [m.firstName, m.lastName].filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0] + parts[1]![0]).toUpperCase()
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (m.email ?? '?').slice(0, 2).toUpperCase()
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

const listShell = 'overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]'
const rowBase = 'flex items-center gap-3.5 px-4 py-3.5'
const divider = 'border-b border-[var(--border-subtle)]'

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

  const inviteOptions: PendingInviteRow['role'][] = supportSeatsEnabled
    ? proPlan ? ['support'] : ['agent', 'manager', 'support']
    : ['agent', 'manager']

  function flash(kind: 'success' | 'error', text: string) {
    setToast({ kind, text })
    setTimeout(() => setToast(null), 4000)
  }

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<PendingInviteRow['role']>(inviteOptions[0] ?? 'agent')
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
      if (!res.ok) { flash('error', body?.error ?? `Failed (${res.status})`); return }
      const newRow: PendingInviteRow = {
        id: body.id, email: body.email, role: body.role,
        inviterName: 'You', expiresAt: body.expires_at, createdAt: body.created_at,
      }
      const isExisting = body.resent === false && res.status === 200
      setInvites((prev) => [newRow, ...prev.filter((p) => p.id !== newRow.id)])
      setInviteEmail('')
      flash('success', isExisting
        ? `Invite already pending for ${newRow.email}.`
        : newRow.role === 'support'
          ? `Support seat added. $${SUPPORT_SEAT_MONTHLY_AUD}/mo, billed with your plan.`
          : `Invite sent to ${newRow.email}.`)
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Network error')
    } finally { setInviteBusy(false) }
  }

  async function handleRevoke(invite: PendingInviteRow) {
    if (!canInvite) return
    const prev = invites
    setInvites((p) => p.filter((i) => i.id !== invite.id))
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites/${invite.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setInvites(prev)
        flash('error', body?.error ?? `Failed (${res.status})`)
      } else {
        flash('success', `Revoked invite for ${invite.email}.`)
      }
    } catch (err) { setInvites(prev); flash('error', err instanceof Error ? err.message : 'Network error') }
  }

  async function handleResend(invite: PendingInviteRow) {
    if (!canInvite) return
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites?resend=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invite.email, role: invite.role }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { flash('error', body?.error ?? `Failed (${res.status})`); return }
      setInvites((p) => p.map((i) => i.id === body.id ? { ...i, expiresAt: body.expires_at } : i))
      flash('success', `Resent invite to ${invite.email}.`)
    } catch (err) { flash('error', err instanceof Error ? err.message : 'Network error') }
  }

  async function handleRemove(member: MemberRow) {
    if (!canRemove) return
    if (!confirm(`Remove ${displayName(member)} from this workspace?`)) return
    const prev = members
    setMembers((m) => m.filter((x) => x.userId !== member.userId))
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${member.userId}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setMembers(prev)
        flash('error', body?.error ?? `Failed (${res.status})`)
      } else {
        flash('success', `Removed ${displayName(member)}.`)
        if (member.authRole === 'owner') router.refresh()
      }
    } catch (err) { setMembers(prev); flash('error', err instanceof Error ? err.message : 'Network error') }
  }

  const agentMembers = members.filter((m) => m.seatType === 'agent')
  const supportMembers = members.filter((m) => m.seatType === 'support')
  const agentInvites = invites.filter((i) => i.role !== 'support')
  const supportInvites = invites.filter((i) => i.role === 'support')
  const supportMonthlyCost = (supportMembers.length + supportInvites.length) * SUPPORT_SEAT_MONTHLY_AUD

  return (
    <div className="space-y-6">
      {toast && (
        <div className={toast.kind === 'success'
          ? 'rounded-md border border-[rgba(61,82,70,0.2)] bg-[rgba(61,82,70,0.08)] px-3 py-2 text-sm text-[var(--fg-primary)]'
          : 'rounded-md border border-[rgba(196,98,45,0.3)] bg-[rgba(196,98,45,0.06)] px-3 py-2 text-sm text-[var(--color-terracotta)]'
        }>
          {toast.text}
        </div>
      )}

      {/* Invite form */}
      {canInvite ? (
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
          <CardLabel>Invite a teammate</CardLabel>
          <form onSubmit={handleInvite}>
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
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
              <div className="w-full space-y-1.5 sm:w-[120px]">
                <Label htmlFor="invite-role">{supportSeatsEnabled && proPlan ? 'Type' : 'Role'}</Label>
                <Select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as PendingInviteRow['role'])}
                  disabled={inviteOptions.length <= 1}
                  options={inviteOptions.map((opt) => ({ value: opt, label: inviteRoleDisplay(opt) }))}
                />
              </div>
              <Button type="submit" className="w-full sm:w-auto" disabled={inviteBusy || !inviteEmail.trim()}>
                <Send className="size-3.5" />
                {inviteBusy ? 'Sending…' : 'Send invite'}
              </Button>
            </div>
            {supportSeatsEnabled && (
              <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--fg-tertiary)]">
                Support seats are for admins, PAs, or sales support who action signals on your behalf — ${SUPPORT_SEAT_MONTHLY_AUD}/mo, billed with your plan.
              </p>
            )}
          </form>
        </div>
      ) : (
        <p className="text-sm text-[var(--fg-secondary)]">
          You don&apos;t have permission to invite teammates. Ask the workspace owner.
        </p>
      )}

      {/* Agents */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="text-[13px] font-semibold text-[var(--fg-primary)]">Agents</div>
          <div className="text-xs text-[var(--fg-secondary)]">
            {agentMembers.length} {agentMembers.length === 1 ? 'agent' : 'agents'}
          </div>
        </div>

        {(agentInvites.length > 0 || agentMembers.length > 0) ? (
          <div className={listShell}>
            {agentInvites.map((inv, i) => (
              <InviteRow
                key={inv.id}
                invite={inv}
                canInvite={canInvite}
                last={i === agentInvites.length - 1 && agentMembers.length === 0}
                onResend={handleResend}
                onRevoke={handleRevoke}
              />
            ))}
            {agentMembers.map((m, i) => (
              <MemberRow
                key={m.userId}
                member={m}
                canRemove={canRemove}
                ownerCount={ownerCount}
                last={i === agentMembers.length - 1}
                onRemove={handleRemove}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--fg-secondary)]">No agents yet.</p>
        )}
      </section>

      {/* Support */}
      {supportSeatsEnabled && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <div className="text-[13px] font-semibold text-[var(--fg-primary)]">Support</div>
            <div className="text-xs text-[var(--fg-secondary)]">
              {supportMembers.length + supportInvites.length}{' '}
              {supportMembers.length + supportInvites.length === 1 ? 'seat' : 'seats'}
              {supportMonthlyCost > 0 && ` · $${supportMonthlyCost}/mo`}
            </div>
          </div>

          {supportMembers.length === 0 && supportInvites.length === 0 ? (
            <div className={listShell}>
              <EmptyState icon={<UserPlus />}>
                No support seats yet. Add one when you&apos;ve got an admin or PA who&apos;d help action signals.
              </EmptyState>
            </div>
          ) : (
            <div className={listShell}>
              {supportInvites.map((inv, i) => (
                <InviteRow
                  key={inv.id}
                  invite={inv}
                  canInvite={canInvite}
                  last={i === supportInvites.length - 1 && supportMembers.length === 0}
                  onResend={handleResend}
                  onRevoke={handleRevoke}
                />
              ))}
              {supportMembers.map((m, i) => (
                <MemberRow
                  key={m.userId}
                  member={m}
                  canRemove={canRemove}
                  ownerCount={ownerCount}
                  last={i === supportMembers.length - 1}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// ── Row components ─────────────────────────────────────────────────────────

function MemberRow({
  member: m, canRemove, ownerCount, last, onRemove,
}: {
  member: MemberRow
  canRemove: boolean
  ownerCount: number
  last: boolean
  onRemove: (m: MemberRow) => void
}) {
  const disableRemove = m.isSelf && m.authRole === 'owner' && ownerCount <= 1
  const ini = initials(m)
  return (
    <div className={`${rowBase}${last ? '' : ' ' + divider}`}>
      {/* Initials avatar */}
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgba(140,123,107,0.12)] text-[11px] font-semibold text-[var(--fg-secondary)]">
        {ini}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--fg-primary)]">
          {displayName(m)}
          {m.isSelf && <span className="text-[10px] font-medium text-[var(--fg-tertiary)]">(you)</span>}
        </div>
        <div className="truncate text-xs text-[var(--fg-secondary)]">
          {m.seatType === 'support' ? 'Support' : ROLE_DISPLAY[m.agentRole]} · {m.email ?? '—'} · joined {formatJoined(m.joinedAt)}
        </div>
      </div>
      {canRemove && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onRemove(m)}
          disabled={disableRemove}
          title={disableRemove ? 'Promote another member to owner first.' : undefined}
        >
          Remove
        </Button>
      )}
    </div>
  )
}

function InviteRow({
  invite: inv, canInvite, last, onResend, onRevoke,
}: {
  invite: PendingInviteRow
  canInvite: boolean
  last: boolean
  onResend: (inv: PendingInviteRow) => void
  onRevoke: (inv: PendingInviteRow) => void
}) {
  return (
    <div className={`${rowBase} flex-wrap${last ? '' : ' ' + divider}`}>
      {/* Mail icon circle */}
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgba(181,146,42,0.12)]">
        <Mail className="size-[15px] text-[var(--color-signal-mid)]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-[var(--fg-primary)]">{inv.email}</div>
        <div className="truncate text-xs text-[var(--fg-secondary)]">
          Pending · {inviteRoleDisplay(inv.role)} · invited by {inv.inviterName} · expires {formatExpiry(inv.expiresAt)}
        </div>
      </div>
      {/* Status + actions — drop to their own full-width line on mobile so the
          text column above keeps its width instead of wrapping word-by-word. */}
      <div className="flex shrink-0 basis-full items-center justify-end gap-1 md:ml-auto md:basis-auto">
        <Badge variant="amber" dot>Pending</Badge>
        {canInvite && (
          <>
            <Button variant="ghost" size="sm" onClick={() => onResend(inv)}>Resend</Button>
            <Button variant="ghost" size="sm" onClick={() => onRevoke(inv)}>Revoke</Button>
          </>
        )}
      </div>
    </div>
  )
}
