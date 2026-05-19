'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { format, formatDistanceToNow } from 'date-fns'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import type { AgentIntegrationRow } from '@/lib/email/types'

interface Banner {
  kind:
    | 'success'
    | 'workspace_admin_blocked'
    | 'refresh_revoked'
    | 'consent_denied'
    | 'invalid_state'
    | 'unexpected'
  message: string
}

interface Props {
  integration: AgentIntegrationRow | null
  banner: Banner | null
}

export function GmailIntegrationManager({ integration, banner }: Props) {
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDisconnect() {
    if (
      !confirm(
        'Disconnect Gmail? Future tracked sends will fail until you reconnect. Past send history is retained.'
      )
    ) {
      return
    }
    setDisconnecting(true)
    setError(null)
    const res = await fetch('/api/integrations/gmail/disconnect', { method: 'POST' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to disconnect')
      setDisconnecting(false)
      return
    }
    // Reload so the Server Component re-fetches the (now-disconnected) row.
    window.location.assign('/settings/integrations')
  }

  const isConnected = integration?.status === 'connected'
  const isRevoked = integration?.status === 'refresh_revoked'
  const isAdminBlocked = integration?.status === 'workspace_admin_blocked'
  const isDisconnected = !integration || integration.status === 'disconnected'

  return (
    <div className="space-y-4">
      {banner && <BannerRow banner={banner} />}

      {/* ── Connected state ─────────────────────────────────────────── */}
      {isConnected && integration && (
        <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                >
                  Connected
                </Badge>
                <span className="text-sm font-medium truncate">
                  {integration.external_account}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Connected {format(new Date(integration.connected_at), 'd MMM yyyy')}
                {integration.last_refreshed_at && (
                  <>
                    {' · '}
                    refreshed{' '}
                    {formatDistanceToNow(new Date(integration.last_refreshed_at), {
                      addSuffix: true,
                    })}
                  </>
                )}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Refresh revoked ─────────────────────────────────────────── */}
      {isRevoked && integration && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Reconnect Gmail</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Google revoked the connection for {integration.external_account}. This usually
                happens when you change your password, sign out everywhere, or revoke Horace from
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {' '}Google&apos;s &ldquo;Apps with access&rdquo;{' '}
                </a>
                page. Reconnect to resume tracked sends.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ConnectLink label="Reconnect Gmail" variant="default" />
            <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Workspace-admin block ───────────────────────────────────── */}
      {isAdminBlocked && integration && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Blocked by your Google Workspace admin</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your organisation has restricted third-party app access. Ask your admin to allow
                Horace in the Google Workspace Admin console, or use a personal Gmail account.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
            {disconnecting ? 'Removing…' : 'Remove'}
          </Button>
        </div>
      )}

      {/* ── Disconnected / never connected ──────────────────────────── */}
      {isDisconnected && (
        <div className="space-y-3">
          <div className="rounded-md border border-border p-4">
            <p className="text-sm">
              Connect your Gmail account to send tracked emails from inside Horace.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Horace requests only the <code className="text-[0.85em]">gmail.send</code> scope —
              we can send mail as you, but cannot read your inbox.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <ConnectLink label="Connect Gmail" variant="default" />
              <span className="text-xs text-muted-foreground">
                Takes about 30 seconds.
              </span>
            </div>
          </div>
          <UnverifiedAppNote />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function ConnectLink({
  label,
  variant,
}: {
  label: string
  variant: 'default' | 'outline'
}) {
  // Plain <a> so the browser follows the 302 from /connect → Google.
  // A button + fetch would trip CORS on the redirect.
  return (
    <Button asChild variant={variant}>
      <a href="/api/integrations/gmail/connect">{label}</a>
    </Button>
  )
}

function UnverifiedAppNote() {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-start gap-2">
        <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium">Expect a Google &ldquo;unverified app&rdquo; warning</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Horace&apos;s OAuth client is in the middle of Google&apos;s verification process.
            Until that lands, you&apos;ll see an interstitial saying &ldquo;Google hasn&apos;t verified
            this app&rdquo; — click <strong>Advanced</strong> → <strong>Go to gohorace.com (unsafe)</strong>{' '}
            to continue. Verification is in flight (HOR-105).
          </p>
        </div>
      </div>
    </div>
  )
}

function BannerRow({ banner }: { banner: Banner }) {
  const styles =
    banner.kind === 'success'
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : banner.kind === 'workspace_admin_blocked'
        ? 'border-destructive/40 bg-destructive/5'
        : 'border-amber-500/40 bg-amber-500/5'
  const Icon =
    banner.kind === 'success'
      ? CheckCircle2
      : banner.kind === 'workspace_admin_blocked'
        ? XCircle
        : AlertTriangle
  const iconColour =
    banner.kind === 'success'
      ? 'text-emerald-600'
      : banner.kind === 'workspace_admin_blocked'
        ? 'text-destructive'
        : 'text-amber-600'

  return (
    <div className={`rounded-md border p-3 ${styles}`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColour}`} />
        <p className="text-sm">{banner.message}</p>
      </div>
    </div>
  )
}
