'use client'

/**
 * HOR-329 — Integrations surface (client component).
 *
 * Renders the merged Connections + Integrations page using the ServiceCard
 * expandable pattern from the design handoff. Data is fetched server-side
 * and passed as props; mutations happen client-side.
 */

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Mail, Plug, Unplug, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { ServiceCard } from '@/components/ui/service-card'
import { SectionHeading } from '@/components/ui/section-heading'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmailExclusionsManager } from './email-exclusions-manager'
import { SettingRow } from '@/components/ui/setting-row'
import type { AgentIntegrationRow } from '@/lib/email/types'
import type { ConnectionRow } from './connections-manager'

interface ExclusionRow {
  id: string
  pattern: string
  pattern_kind: 'email' | 'domain'
  reason: string | null
  source: 'agent' | 'seeded' | 'auto_bounce'
  created_at: string
}

interface IntegrationBanner {
  kind: 'success' | 'workspace_admin_blocked' | 'refresh_revoked' | 'consent_denied' | 'invalid_state' | 'unexpected'
  message: string
}

const CATALOG = [
  { system: 'rex', display_name: 'Rex', letter: 'R' },
  { system: 'vaultre', display_name: 'VaultRE', letter: 'V' },
  { system: 'agentbox', display_name: 'Agentbox', letter: 'A' },
]

function slugify(name: string): string {
  return (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)) || 'other'
}

interface Props {
  integration: AgentIntegrationRow | null
  banner: IntegrationBanner | null
  exclusions: ExclusionRow[]
  connections: ConnectionRow[]
  isAdmin: boolean
}

export function IntegrationsView({ integration, banner, exclusions, connections, isAdmin }: Props) {
  // Gmail state
  const [disconnecting, setDisconnecting] = useState(false)
  const [gmailRemoved, setGmailRemoved] = useState(false)

  // CRM + concierge state
  const [localConnections, setLocalConnections] = useState<ConnectionRow[]>(connections)
  const [conciergeOpen, setConciergeOpen] = useState(false)
  const [conciergeSystem, setConciergeSystem] = useState('rex')
  const [conciergeOther, setConciergeOther] = useState('')
  const [inbound, setInbound] = useState(true)
  const [outbound, setOutbound] = useState(true)
  const [conciergeError, setConciergeError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const effectiveIntegration = gmailRemoved ? null : integration
  const gmailStatus = effectiveIntegration?.status
  const isConnected = gmailStatus === 'connected'
  const isRevoked = gmailStatus === 'refresh_revoked' || gmailStatus === 'workspace_admin_blocked'

  async function handleGmailDisconnect() {
    if (!confirm('Disconnect Gmail? Future tracked sends will fail until you reconnect. Past send history is retained.')) return
    setDisconnecting(true)
    const res = await fetch('/api/integrations/gmail/disconnect', { method: 'POST' })
    if (res.ok) setGmailRemoved(true)
    setDisconnecting(false)
  }

  async function handleConciergeSubmit(e: React.FormEvent) {
    e.preventDefault()
    const chosen = conciergeSystem === 'other'
      ? { system: slugify(conciergeOther), display_name: conciergeOther.trim() }
      : { system: conciergeSystem, display_name: CATALOG.find(c => c.system === conciergeSystem)?.display_name ?? conciergeSystem }
    if (!chosen.display_name || (!inbound && !outbound)) return
    setSubmitting(true)
    setConciergeError(null)
    const res = await fetch('/api/settings/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...chosen, inbound, outbound }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setConciergeError(data.error ?? 'Could not send that request — please try again.')
      setSubmitting(false)
      return
    }
    const data = (await res.json()) as { connection: ConnectionRow }
    setLocalConnections(prev => [data.connection, ...prev.filter(c => c.system !== data.connection.system)])
    setConciergeOpen(false)
    setConciergeOther('')
    setSubmitting(false)
  }

  const bySystem = new Map(localConnections.map(c => [c.system, c]))
  const connectedCRMs = CATALOG.filter(cat => bySystem.get(cat.system)?.status === 'active')
  const availableCRMs = CATALOG.filter(cat => bySystem.get(cat.system)?.status !== 'active')

  function gmailSummary(): string {
    if (!effectiveIntegration) return 'Send tracked 1:1 emails from your own address.'
    if (isConnected) return `Send tracked 1:1 emails from your own address and log replies.`
    if (isRevoked) return gmailStatus === 'workspace_admin_blocked'
      ? 'Blocked by your Google Workspace admin.'
      : 'Reconnect required to resume tracked sends.'
    return 'Send tracked 1:1 emails from your own address.'
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Integrations"
        description="Every service Horace works alongside, in one place. Connect a service, then manage its settings right on its card."
      />

      {/* OAuth callback banner */}
      {banner && (
        <div className={[
          'flex items-start gap-2.5 rounded-md border p-3 text-sm',
          banner.kind === 'success'
            ? 'border-[rgba(61,82,70,0.2)] bg-[rgba(61,82,70,0.08)] text-[var(--fg-primary)]'
            : 'border-[rgba(181,146,42,0.3)] bg-[rgba(181,146,42,0.08)] text-[var(--fg-primary)]',
        ].join(' ')}>
          {banner.message}
        </div>
      )}

      {/* ── Email ──────────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-secondary)]">Connected services</div>
        <ServiceCard
          logo={<Mail />}
          name="Gmail"
          summary={gmailSummary()}
          connected={isConnected}
          statusVariant={isConnected ? 'moss' : isRevoked ? 'amber' : 'stone'}
          statusLabel={isConnected ? 'Connected' : isRevoked ? 'Reconnect required' : 'Not connected'}
          connectLabel={isRevoked ? 'Reconnect' : 'Connect'}
          onConnect={() => { window.location.href = '/api/integrations/gmail/connect' }}
          defaultOpen={isConnected}
        >
          {/* Connected expanded panel */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Send from</Label>
              <Input
                value={effectiveIntegration?.external_account ?? ''}
                disabled
                className="font-mono"
              />
            </div>
            <div>
              <EmailExclusionsManager initialExclusions={exclusions} />
            </div>
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGmailDisconnect}
                disabled={disconnecting}
              >
                <Unplug className="size-3.5" />
                {disconnecting ? 'Disconnecting…' : 'Disconnect Gmail'}
              </Button>
            </div>
          </div>
        </ServiceCard>

        {/* Connected CRMs */}
        {connectedCRMs.map(cat => {
          const c = bySystem.get(cat.system)!
          const lastSynced = c.last_synced_at
            ? formatDistanceToNow(new Date(c.last_synced_at), { addSuffix: true })
            : null
          const syncSummary = [
            c.inbound_enabled && 'Contacts in',
            c.outbound_enabled && 'Leads out',
          ].filter(Boolean).join(' · ')

          return (
            <ServiceCard
              key={cat.system}
              logo={cat.letter}
              name={cat.display_name}
              connected={true}
              statusVariant="moss"
              statusLabel="Connected"
              summary={syncSummary || 'Connected'}
            >
              {c.inbound_enabled && (
                <SettingRow
                  icon={<ArrowDownToLine />}
                  title="Contacts in"
                  description="Pull contacts into Horace."
                  last={!c.outbound_enabled}
                />
              )}
              {c.outbound_enabled && (
                <SettingRow
                  icon={<ArrowUpFromLine />}
                  title="Leads out"
                  description="Push qualified leads back."
                  last
                />
              )}
              {lastSynced && (
                <div className="mt-4 font-mono text-[11px] text-[var(--fg-tertiary)]">
                  Last synced {lastSynced}
                </div>
              )}
            </ServiceCard>
          )
        })}
      </div>

      {/* ── Available CRMs (admin only) ───────────────────────────── */}
      {isAdmin && availableCRMs.length > 0 && (
        <div className="space-y-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-secondary)]">Available</div>
          <div className="space-y-2.5">
            {availableCRMs.map(cat => {
              const c = bySystem.get(cat.system)
              const isPending = c?.status === 'assisted_pending' || c?.status === 'connecting'
              return (
                <ServiceCard
                  key={cat.system}
                  logo={cat.letter}
                  name={cat.display_name}
                  connected={false}
                  statusVariant={isPending ? 'amber' : 'stone'}
                  statusLabel={isPending ? 'In progress' : 'Not connected'}
                  summary={isPending
                    ? "We're setting this up — usually live within two business days."
                    : 'Two-way sync with your contacts and leads.'}
                  onConnect={() => {
                    setConciergeSystem(cat.system)
                    setConciergeOpen(true)
                  }}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* ── Concierge request (admin only) ────────────────────────── */}
      {isAdmin && (
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]">
          <div className="mb-2 flex items-center gap-2">
            <Plug className="size-[15px] text-[var(--fg-secondary)]" />
            <span className="text-sm font-semibold text-[var(--fg-primary)]">Request a connection</span>
          </div>
          <p className="mb-3.5 text-xs leading-relaxed text-[var(--fg-secondary)]">
            Don&apos;t see your CRM, or stuck getting a key? Tell us what you use — Horace will set it up for you. Most connections are live within two business days.
          </p>
          {!conciergeOpen ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setConciergeSystem('rex'); setConciergeOpen(true) }}
            >
              Request a connection
            </Button>
          ) : (
            <form onSubmit={handleConciergeSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="conn-system">CRM</Label>
                <select
                  id="conn-system"
                  value={conciergeSystem}
                  onChange={e => setConciergeSystem(e.target.value)}
                  className="h-10 w-full appearance-none rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--fg-primary)]"
                >
                  {CATALOG.map(c => <option key={c.system} value={c.system}>{c.display_name}</option>)}
                  <option value="other">Other…</option>
                </select>
              </div>
              {conciergeSystem === 'other' && (
                <div className="space-y-1.5">
                  <Label htmlFor="conn-other">Which CRM?</Label>
                  <Input
                    id="conn-other"
                    placeholder="e.g. Box+Dice"
                    value={conciergeOther}
                    onChange={e => setConciergeOther(e.target.value)}
                    maxLength={60}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>What should flow?</Label>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--fg-primary)]">
                    <input type="checkbox" checked={inbound} onChange={e => setInbound(e.target.checked)} />
                    Pull contacts in
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--fg-primary)]">
                    <input type="checkbox" checked={outbound} onChange={e => setOutbound(e.target.checked)} />
                    Send Doorstep leads out
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={submitting || (!inbound && !outbound)}>
                  {submitting ? 'Sending…' : 'Send request'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConciergeOpen(false)}>
                  Cancel
                </Button>
              </div>
              {conciergeError && <p className="text-sm text-destructive">{conciergeError}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  )
}
