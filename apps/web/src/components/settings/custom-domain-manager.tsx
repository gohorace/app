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
      <div className="space-y-5">
        <div className="space-y-3 rounded-md border bg-muted/40 p-4 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">Two-step setup</div>
          <ol className="ml-4 list-decimal space-y-1.5">
            <li>Pick a subdomain you control (e.g. <code className="font-mono">inspections.agentname.com.au</code>) and add it here.</li>
            <li>
              We&apos;ll give you a <strong>CNAME record</strong> to add at your DNS host
              (Cloudflare / Namecheap / Route&nbsp;53 / wherever). Doorstep goes live once
              that record resolves — usually a minute or two.
            </li>
          </ol>
          <p>
            You&apos;ll need access to your DNS provider. If you&apos;re unsure where that is,
            email <a className="text-foreground underline" href="mailto:team@gohorace.com">team@gohorace.com</a> and we&apos;ll point you to the right place.
          </p>
          <p className="text-amber-900">
            <strong>If your DNS is on Cloudflare:</strong> when you add the record, set the
            Proxy column to <strong>DNS only</strong> (grey cloud), not Proxied (orange cloud).
            We&apos;ll remind you again at the next step.
          </p>
        </div>

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
    const sslLive = domain.sslStatus === 'active'
    return (
      <div className="space-y-4">
        <div
          className={
            sslLive
              ? 'flex items-start gap-3 rounded-md border border-green-200 bg-green-50 p-4'
              : 'flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4'
          }
        >
          {sslLive ? (
            <CheckCircle2 className="w-5 h-5 text-green-700 flex-shrink-0 mt-0.5" />
          ) : (
            <Clock className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1 space-y-1">
            <div className={sslLive ? 'font-medium text-green-900' : 'font-medium text-amber-900'}>
              {sslLive
                ? `You're set. Doorstep is live on ${domain.hostname}.`
                : `DNS resolved. Certificate provisioning for ${domain.hostname}.`}
            </div>
            <div className={sslLive ? 'text-xs text-green-800' : 'text-xs text-amber-800'}>
              {sslLive
                ? 'Certificate active.'
                : 'Usually about a minute. Refresh this page to see the live state.'}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {!sslLive && (
            <Button onClick={handleVerify} disabled={busy}>
              {busy ? 'Refreshing…' : 'Refresh'}
            </Button>
          )}
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
  // The subdomain label is what most DNS hosts want in the "Name" field.
  // Hosts vary: some accept the full FQDN, some only the label, some
  // either. We show the label as the default and surface the full host
  // for clarity.
  const subdomainLabel = domain.hostname.split('.').slice(0, -2).join('.') || domain.hostname

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4">
        <Clock className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1">
          <div className="font-medium text-amber-900">
            Action required — add this CNAME at your DNS host.
          </div>
          <div className="text-xs text-amber-800">
            Doorstep capture stays paused until {domain.hostname} resolves. Usually a
            minute or two after you save the record.
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-md border p-4">
        <div className="text-sm font-medium">Add this record at your DNS host</div>

        <div className="rounded-md border bg-muted/40 p-3">
          <div className="grid grid-cols-[80px,1fr] gap-x-3 gap-y-2 text-xs">
            <div className="text-muted-foreground">Type</div>
            <div className="font-mono">CNAME</div>

            <div className="text-muted-foreground">Name</div>
            <div className="flex items-center gap-2">
              <code className="font-mono">{subdomainLabel}</code>
              <span className="text-muted-foreground">
                (some hosts ask for the full <span className="font-mono">{domain.hostname}</span>)
              </span>
            </div>

            <div className="text-muted-foreground">Value</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono break-all">{domain.dnsTarget}</code>
              <Button variant="outline" size="sm" onClick={copyDnsTarget}>
                <Copy className="w-3 h-3 mr-1" />
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>

            <div className="text-muted-foreground">TTL</div>
            <div className="text-muted-foreground">Auto / 300 seconds</div>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <AlertCircle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs text-amber-900">
            <div className="font-medium">Using Cloudflare? Set the proxy to DNS&nbsp;only.</div>
            <p className="text-amber-800">
              In Cloudflare&apos;s DNS table, the cloud icon next to your record must be <strong>grey (DNS&nbsp;only)</strong>,
              not orange (Proxied). Vercel issues the certificate directly — proxying through Cloudflare
              produces an SSL handshake error (525). Other DNS hosts (Namecheap, Route&nbsp;53, GoDaddy)
              don&apos;t have a proxy toggle, so you can skip this.
            </p>
          </div>
        </div>

        <ol className="ml-4 list-decimal space-y-1.5 text-xs text-muted-foreground">
          <li>Log in to your DNS host (Cloudflare, Namecheap, Route 53, GoDaddy, etc.).</li>
          <li>Add the record above to <span className="font-mono">{domain.hostname.split('.').slice(-2).join('.')}</span>.</li>
          <li>Save / publish the record.</li>
          <li>Wait 30–120 seconds for propagation, then click <strong>Check status</strong>.</li>
        </ol>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground">Verify from your terminal (optional)</summary>
          <div className="mt-2 rounded-md border bg-background px-3 py-2 font-mono">
            dig +short {domain.hostname} CNAME
          </div>
          <p className="mt-1.5">
            Expected output: <code className="font-mono">{domain.dnsTarget}.</code>
            {' '}Anything else (including no output) means the record hasn&apos;t
            propagated yet.
          </p>
        </details>

        {domain.verificationRecords.length > 0 &&
          domain.verificationRecords.some((r) => r.type !== 'CNAME') && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer text-foreground">Other records Vercel may ask for</summary>
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
