'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Plug } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export interface ConnectionRow {
  id: string
  system: string
  display_name: string
  status: 'not_connected' | 'connecting' | 'active' | 'error' | 'assisted_pending'
  auth_method: 'api_key' | 'oauth' | null
  inbound_enabled: boolean
  outbound_enabled: boolean
  last_synced_at: string | null
  last_error: string | null
  connected_at: string | null
  requested_at: string | null
  created_at: string
}

// The CRMs we surface as cards out of the box. Anything else an agency uses is
// reachable via the "Request a connection" panel (system = a slug of the name).
const CATALOG: Array<{ system: string; display_name: string }> = [
  { system: 'rex', display_name: 'Rex' },
  { system: 'vaultre', display_name: 'VaultRE' },
  { system: 'agentbox', display_name: 'Agentbox' },
]

function directions(c: ConnectionRow): string {
  const parts: string[] = []
  if (c.inbound_enabled) parts.push('Contacts in')
  if (c.outbound_enabled) parts.push('Leads out')
  return parts.join(' · ')
}

export function ConnectionsManager({
  initialConnections,
}: {
  initialConnections: ConnectionRow[]
}) {
  const [connections, setConnections] = useState<ConnectionRow[]>(initialConnections)
  const [error, setError] = useState<string | null>(null)

  // Concierge request form.
  const [open, setOpen] = useState(false)
  const [system, setSystem] = useState('rex')
  const [otherName, setOtherName] = useState('')
  const [inbound, setInbound] = useState(true)
  const [outbound, setOutbound] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const bySystem = new Map(connections.map((c) => [c.system, c]))
  // Catalog CRMs first (merged with any live row), then any connected CRM not in the catalog.
  const catalogCards = CATALOG.map(
    (c) => bySystem.get(c.system) ?? ({ ...blank(c.system, c.display_name) } as ConnectionRow),
  )
  const extraCards = connections.filter((c) => !CATALOG.some((cat) => cat.system === c.system))
  const cards = [...catalogCards, ...extraCards]

  function openRequest(prefillSystem?: string, prefillName?: string) {
    if (prefillSystem) setSystem(prefillSystem)
    if (prefillName) setOtherName(prefillSystem === 'other' ? prefillName : '')
    setOpen(true)
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const chosen =
      system === 'other'
        ? { system: slug(otherName), display_name: otherName.trim() }
        : { system, display_name: CATALOG.find((c) => c.system === system)?.display_name ?? system }
    if (!chosen.display_name || (!inbound && !outbound)) return
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/settings/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...chosen, inbound, outbound }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Couldn't send that request — have a look.")
      setSubmitting(false)
      return
    }
    const data = (await res.json()) as { connection: ConnectionRow }
    setConnections((prev) => {
      const without = prev.filter((c) => c.system !== data.connection.system)
      return [...without, data.connection]
    })
    setOpen(false)
    setOtherName('')
    setSubmitting(false)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <ConnectionCard
            key={c.system}
            c={c}
            onConnect={() => openRequest(c.system, c.display_name)}
          />
        ))}
      </div>

      {/* Request a connection (concierge) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="w-4 h-4" />
            Request a connection
          </CardTitle>
          <CardDescription>
            Don&apos;t see your CRM, or stuck getting a key? Tell us what you use — Horace will set
            it up for you. Most connections are live within two business days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!open ? (
            <Button variant="outline" onClick={() => openRequest()}>
              Request a connection
            </Button>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="conn-system">CRM</Label>
                <select
                  id="conn-system"
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {CATALOG.map((c) => (
                    <option key={c.system} value={c.system}>
                      {c.display_name}
                    </option>
                  ))}
                  <option value="other">Other…</option>
                </select>
              </div>
              {system === 'other' && (
                <div className="space-y-1.5">
                  <Label htmlFor="conn-other">Which CRM?</Label>
                  <Input
                    id="conn-other"
                    placeholder="e.g. Box+Dice"
                    value={otherName}
                    onChange={(e) => setOtherName(e.target.value)}
                    maxLength={60}
                    className="max-w-sm"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>What should flow?</Label>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={inbound}
                      onChange={(e) => setInbound(e.target.checked)}
                    />
                    Pull contacts in
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={outbound}
                      onChange={(e) => setOutbound(e.target.checked)}
                    />
                    Send Doorstep leads out
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={submitting || (!inbound && !outbound)}>
                  {submitting ? 'Sending…' : 'Send request'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ConnectionCard({ c, onConnect }: { c: ConnectionRow; onConnect: () => void }) {
  return (
    <div className="rounded-md border p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{c.display_name}</p>
        <StatusBadge status={c.status} />
      </div>

      {c.status === 'active' && (
        <p className="text-xs text-muted-foreground">
          {directions(c) || 'Connected'}
          {c.last_synced_at
            ? ` · synced ${formatDistanceToNow(new Date(c.last_synced_at), { addSuffix: true })}`
            : ''}
        </p>
      )}
      {c.status === 'assisted_pending' && (
        <p className="text-xs text-muted-foreground">
          We&apos;re setting this up for you — usually live within two business days.
        </p>
      )}
      {c.status === 'error' && c.last_error && (
        <p className="text-xs text-destructive">{c.last_error}</p>
      )}

      {(c.status === 'not_connected' || c.status === 'error') && (
        <Button
          variant={c.status === 'error' ? 'outline' : 'default'}
          size="sm"
          onClick={onConnect}
        >
          {c.status === 'error' ? 'Reconnect' : 'Connect'}
        </Button>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: ConnectionRow['status'] }) {
  switch (status) {
    case 'active':
      return (
        <Badge variant="outline" className="border-emerald-600/40 text-emerald-700">
          Connected
        </Badge>
      )
    case 'error':
      return (
        <Badge variant="outline" className="border-destructive/50 text-destructive">
          Attention
        </Badge>
      )
    case 'assisted_pending':
    case 'connecting':
      return (
        <Badge variant="outline" className="border-blue-500/40 text-blue-600">
          In progress
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          Not connected
        </Badge>
      )
  }
}

function blank(system: string, display_name: string): ConnectionRow {
  return {
    id: `catalog-${system}`,
    system,
    display_name,
    status: 'not_connected',
    auth_method: null,
    inbound_enabled: false,
    outbound_enabled: false,
    last_synced_at: null,
    last_error: null,
    connected_at: null,
    requested_at: null,
    created_at: new Date().toISOString(),
  }
}

function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'other'
  )
}
