/**
 * HOR-204 — CustomDomainManager client component.
 *
 * Renders the four states of a workspace custom domain:
 *   - empty:    no row → input + Add button
 *   - pending:  row exists but not yet verified → CNAME instructions +
 *               Check status button + Remove
 *   - verified: green tick + "You're set" + Remove
 *   - failed:   red flag + error message + Retry + Remove
 *
 * Wires to:
 *   POST   /api/domains
 *   POST   /api/domains/:id/verify
 *   DELETE /api/domains/:id
 *
 * No live polling — user clicks "Check status" once they've configured
 * DNS. The cron at /api/cron/check-domains catches changes between visits.
 */

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CheckCircle2, AlertCircle, Clock, Copy } from 'lucide-react'

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
  errorMessage: string | null
  createdAt: string
  verifiedAt: string | null
}

interface Props {
  initialDomain: CustomDomainRow | null
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
      if (!res.ok) {
        setError(body.error ?? `Failed (${res.status})`)
        return
      }
      setDomain({
        id: body.id,
        hostname: body.hostname,
        status: body.status,
        sslStatus: body.ssl_status,
        dnsTarget: body.dns_target,
        verificationRecords: body.verification_records ?? [],
        errorMessage: null,
        createdAt: new Date().toISOString(),
        verifiedAt: null,
      })
      setHostname('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  async function handleVerify() {
    if (!domain) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/domains/${domain.id}/verify`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? `Failed (${res.status})`)
      }
      setDomain((d) =>
        d
          ? {
              ...d,
              status: body.status ?? d.status,
              sslStatus: body.ssl_status ?? d.sslStatus,
              verificationRecords: body.verification_records ?? d.verificationRecords,
            }
          : d,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!domain) return
    if (
      !confirm(
        `Remove ${domain.hostname}? Doorstep capture will pause until you restore a custom domain. Your existing inspection data is preserved.`,
      )
    )
      return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/domains/${domain.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? `Failed (${res.status})`)
        return
      }
      setDomain(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  function copyDnsTarget() {
    if (!domain) return
    navigator.clipboard.writeText(domain.dnsTarget).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Empty state ─────────────────────────────────────────────────────
  if (!domain) {
    return (
      <div className="space-y-4">
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="domain-hostname">Your inspection subdomain</Label>
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
            <p className="text-xs text-muted-foreground">
              Use a subdomain you control. We&apos;ll give you a CNAME record to
              add at your DNS host.
            </p>
          </div>
          <Button type="submit" disabled={busy || !hostname.trim()}>
            {busy ? 'Adding…' : 'Add domain'}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  // ── Verified state ──────────────────────────────────────────────────
  if (domain.status === 'verified') {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-4">
          <CheckCircle2 className="w-5 h-5 text-green-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <div className="font-medium text-green-900">
              You&apos;re set. Doorstep is live on {domain.hostname}.
            </div>
            <div className="text-xs text-green-800">
              {domain.sslStatus === 'active'
                ? 'Certificate active.'
                : 'Certificate provisioning — usually about a minute.'}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRemove} disabled={busy}>
            Remove
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  // ── Failed state ────────────────────────────────────────────────────
  if (domain.status === 'failed') {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <div className="font-medium">Something&apos;s off with {domain.hostname}.</div>
            <div className="text-xs">
              {domain.errorMessage ?? 'Vercel rejected the verification check.'}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleVerify} disabled={busy}>
            {busy ? 'Retrying…' : 'Retry'}
          </Button>
          <Button variant="outline" onClick={handleRemove} disabled={busy}>
            Remove
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Stuck? Email <a className="text-foreground underline" href="mailto:team@gohorace.com">team@gohorace.com</a>.
        </p>
      </div>
    )
  }

  // ── Pending / verifying state ───────────────────────────────────────
  const subdomainLabel = domain.hostname.split('.').slice(0, -2).join('.') || domain.hostname

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4">
        <Clock className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1">
          <div className="font-medium text-amber-900">
            Waiting on DNS. Usually a few minutes, sometimes longer.
          </div>
          <div className="text-xs text-amber-800">
            We&apos;ll flip this to <strong>verified</strong> as soon as your CNAME resolves.
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <div className="text-sm font-medium">Set up your DNS</div>
        <p className="text-xs text-muted-foreground">
          Log in to your DNS host. Add a <strong>CNAME</strong> record where the
          Name is <code className="font-mono">{subdomainLabel}</code> and the
          Value is the line below. Save the record.
        </p>

        <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 font-mono text-xs">
          <span className="flex-1 break-all">{domain.dnsTarget}</span>
          <Button variant="outline" size="sm" onClick={copyDnsTarget}>
            <Copy className="w-3 h-3 mr-1" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        {domain.verificationRecords.length > 0 &&
          domain.verificationRecords.some((r) => r.type !== 'CNAME') && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Other records Vercel may ask for</summary>
              <ul className="mt-2 space-y-1 font-mono">
                {domain.verificationRecords.map((r, i) => (
                  <li key={i}>
                    <strong>{r.type}</strong> {r.domain} → {r.value}
                  </li>
                ))}
              </ul>
            </details>
          )}
      </div>

      <div className="flex gap-2">
        <Button onClick={handleVerify} disabled={busy}>
          {busy ? 'Checking…' : 'Check status'}
        </Button>
        <Button variant="outline" onClick={handleRemove} disabled={busy}>
          Remove
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Stuck? Email <a className="text-foreground underline" href="mailto:team@gohorace.com">team@gohorace.com</a>.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
