/**
 * HOR-204 — CustomDomainManager client component.
 *
 * Renders four states of a workspace custom domain:
 *   - empty:    no row → input + Add button + setup instructions
 *   - pending:  CNAME instructions + Check status
 *   - verified: domain card + DNS record card + Check status / Change domain
 *   - failed:   error state + Retry + Change domain
 *
 * Wires to:
 *   POST   /api/domains
 *   POST   /api/domains/:id/verify
 *   DELETE /api/domains/:id
 */

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CardLabel } from '@/components/ui/card-label'
import { RefreshCw, Copy, Check } from 'lucide-react'
import { DnsProviderGuide, type DnsProvider } from './dns-provider-guide'

export interface VerificationRecord {
  type: string
  domain: string
  value: string
  reason: string
}

export interface CustomDomainRow {
  id: string
  hostname: string
  status: 'pending' | 'verifying' | 'verified' | 'failed' | 'removed'
  sslStatus: 'pending' | 'provisioning' | 'active' | 'failed'
  dnsTarget: string
  verificationRecords: VerificationRecord[]
  dnsProvider: DnsProvider
  errorMessage: string | null
  createdAt: string
  verifiedAt: string | null
}

interface Props {
  initialDomain: CustomDomainRow | null
}

const card = 'rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[22px] shadow-[var(--shadow-sm)]'

function DnsTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
      {rows.map(([k, v], i) => (
        <div
          key={k}
          className={`flex px-3.5 py-2.5${i < rows.length - 1 ? ' border-b border-[var(--border-subtle)]' : ''}`}
        >
          <span className="w-20 shrink-0 text-xs text-[var(--fg-secondary)]">{k}</span>
          <span className="min-w-0 break-all font-mono text-xs text-[var(--fg-primary)]">{v}</span>
        </div>
      ))}
    </div>
  )
}

export function CustomDomainManager({ initialDomain }: Props) {
  const router = useRouter()
  const [domain, setDomain] = useState<CustomDomainRow | null>(initialDomain)
  const [hostname, setHostname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: hostname.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? `Failed (${res.status})`); return }
      setDomain({
        id: body.id, hostname: body.hostname, status: body.status, sslStatus: body.ssl_status,
        dnsTarget: body.dns_target, verificationRecords: body.verification_records ?? [],
        dnsProvider: (body.dns_provider ?? 'unknown') as DnsProvider,
        errorMessage: null, createdAt: new Date().toISOString(), verifiedAt: null,
      })
      setHostname('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally { setBusy(false) }
  }

  async function handleVerify() {
    if (!domain) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/domains/${domain.id}/verify`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? `Failed (${res.status})`) }
      setDomain((d) => d ? {
        ...d,
        status: body.status ?? d.status,
        sslStatus: body.ssl_status ?? d.sslStatus,
        verificationRecords: body.verification_records ?? d.verificationRecords,
      } : d)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally { setBusy(false) }
  }

  async function handleRemove() {
    if (!domain) return
    if (!confirm(`Remove ${domain.hostname}? Doorstep capture will pause until you restore a custom domain.`)) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/domains/${domain.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? `Failed (${res.status})`); return }
      setDomain(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally { setBusy(false) }
  }

  function copyDnsTarget() {
    if (!domain) return
    navigator.clipboard.writeText(domain.dnsTarget).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Domain status card (shown when a domain exists) ──────────────────
  const DomainStatusCard = () => {
    if (!domain) return null
    const isVerified = domain.status === 'verified'
    const isFailed = domain.status === 'failed'
    const statusVariant = isVerified ? 'moss' : isFailed ? 'accent' : 'amber'
    const statusLabel = isVerified && domain.sslStatus === 'active'
      ? 'Verified & live'
      : isVerified
      ? 'Verifying SSL'
      : isFailed
      ? 'Failed'
      : 'Pending DNS'

    return (
      <div className={card}>
        <div className="flex items-center justify-between">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-secondary)]">
              Doorstep domain
            </div>
            <div className="font-mono text-[15px] text-[var(--fg-primary)]">{domain.hostname}</div>
          </div>
          <Badge variant={statusVariant} dot>{statusLabel}</Badge>
        </div>
      </div>
    )
  }

  // ── DNS record card ──────────────────────────────────────────────────
  const DnsRecordCard = () => {
    if (!domain) return null
    const subLabel = labelOf(domain.hostname)
    const dnsRows: [string, string][] = [
      ['Type', 'CNAME'],
      ['Name', subLabel],
      ['Value', domain.dnsTarget],
    ]

    return (
      <div className={card}>
        <CardLabel>DNS record</CardLabel>
        <p className="mb-3 text-xs leading-relaxed text-[var(--fg-secondary)]">
          Add this CNAME at your domain registrar. Horace checks for it automatically.
        </p>
        <DnsTable rows={dnsRows} />

        <div className="mt-5 border-t border-[var(--border-subtle)] pt-5">
          <DnsProviderGuide
            provider={domain.dnsProvider}
            hostname={domain.hostname}
            apex={apexOf(domain.hostname)}
            subdomainLabel={subLabel}
          />
        </div>

        <div className="mt-4 flex items-center gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleVerify}
            disabled={busy}
          >
            <RefreshCw className="size-3.5" />
            {busy ? 'Checking…' : 'Check status'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={busy}
          >
            Change domain
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={copyDnsTarget}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy value'}
          </Button>
        </div>

        {domain.status === 'failed' && domain.errorMessage && (
          <p className="mt-3 text-xs text-[var(--color-terracotta)]">{domain.errorMessage}</p>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  // ── Empty state ──────────────────────────────────────────────────────
  if (!domain) {
    return (
      <div className="space-y-4">
        <div className={card}>
          <CardLabel>Add your domain</CardLabel>
          <p className="mb-4 text-xs leading-relaxed text-[var(--fg-secondary)]">
            Pick a subdomain you control (e.g.{' '}
            <code className="font-mono">inspections.agentname.com.au</code>) and add it here.
            We&apos;ll give you a CNAME record to add at your DNS host — Doorstep goes live once
            that record resolves.
          </p>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="domain-hostname">Inspection subdomain</Label>
              <Input
                id="domain-hostname"
                type="text"
                placeholder="inspections.agentname.com.au"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                autoComplete="off"
                required
                disabled={busy}
              />
            </div>
            <Button type="submit" disabled={busy || !hostname.trim()}>
              {busy ? 'Adding…' : 'Add domain'}
            </Button>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </div>
      </div>
    )
  }

  // ── Verified or pending or failed ────────────────────────────────────
  return (
    <div className="space-y-4">
      <DomainStatusCard />
      <DnsRecordCard />
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const MULTI_LABEL_TLDS = new Set([
  'com.au', 'net.au', 'org.au', 'co.uk', 'co.nz', 'com.nz',
])

function apexOf(hostname: string): string {
  const parts = hostname.toLowerCase().split('.')
  if (parts.length < 2) return hostname
  const lastTwo = parts.slice(-2).join('.')
  if (MULTI_LABEL_TLDS.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.')
  return lastTwo
}

function labelOf(hostname: string): string {
  const apex = apexOf(hostname)
  const stripped = hostname.toLowerCase().endsWith('.' + apex)
    ? hostname.slice(0, -(apex.length + 1))
    : hostname
  return stripped || hostname
}
