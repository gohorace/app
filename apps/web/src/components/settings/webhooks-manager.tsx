'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ui/copy-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Webhook } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const EVENTS = [
  'contact.created',
  'contact.updated',
  'relationship.created',
  'relationship.updated',
] as const
type EventName = (typeof EVENTS)[number]

interface Endpoint {
  id: string
  url: string
  description: string | null
  events: string[]
  enabled: boolean
  status: 'active' | 'failing' | 'disabled'
  last_delivery_at: string | null
  last_error: string | null
  created_at: string
}

interface Delivery {
  id: string
  event_type: string
  status: string
  attempts: number
  response_status: number | null
  last_error: string | null
  created_at: string
}

function statusBadge(e: Endpoint) {
  if (e.status === 'failing')
    return (
      <Badge variant="outline" className="border-destructive/50 text-destructive">
        Attention
      </Badge>
    )
  if (!e.enabled || e.status === 'disabled')
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Paused
      </Badge>
    )
  return (
    <Badge variant="outline" className="border-emerald-600/40 text-emerald-700">
      Active
    </Badge>
  )
}

export function WebhooksManager() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [events, setEvents] = useState<Record<EventName, boolean>>({
    'contact.created': true,
    'contact.updated': true,
    'relationship.created': true,
    'relationship.updated': true,
  })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [openLog, setOpenLog] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])

  useEffect(() => {
    fetch('/api/settings/webhooks')
      .then((r) => (r.ok ? r.json() : { endpoints: [] }))
      .then((d) => setEndpoints(d.endpoints ?? []))
      .finally(() => setLoading(false))
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const chosen = EVENTS.filter((ev) => events[ev])
    if (!url.trim() || chosen.length === 0) return
    setCreating(true)
    setError(null)
    setRevealedSecret(null)

    const res = await fetch('/api/settings/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url.trim(),
        events: chosen,
        description: description.trim() || undefined,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Couldn't add that webhook — have a look.")
      setCreating(false)
      return
    }
    const data = (await res.json()) as { endpoint: Endpoint; secret: string }
    setEndpoints([{ ...data.endpoint, last_delivery_at: null, last_error: null }, ...endpoints])
    setRevealedSecret(data.secret)
    setUrl('')
    setDescription('')
    setCreating(false)
  }

  async function toggle(ep: Endpoint) {
    const res = await fetch(`/api/settings/webhooks/${ep.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !ep.enabled }),
    })
    if (!res.ok) return setError("Couldn't update that webhook — have a look.")
    const data = (await res.json()) as { endpoint: Endpoint }
    setEndpoints(endpoints.map((e) => (e.id === ep.id ? data.endpoint : e)))
  }

  async function remove(ep: Endpoint) {
    if (!confirm('Delete this webhook? Horace stops sending to it straight away.')) return
    const res = await fetch(`/api/settings/webhooks/${ep.id}`, { method: 'DELETE' })
    if (!res.ok) return setError("Couldn't delete that webhook — have a look.")
    setEndpoints(endpoints.filter((e) => e.id !== ep.id))
    if (openLog === ep.id) setOpenLog(null)
  }

  async function viewLog(ep: Endpoint) {
    if (openLog === ep.id) {
      setOpenLog(null)
      return
    }
    setOpenLog(ep.id)
    setDeliveries([])
    const res = await fetch(`/api/settings/webhooks/${ep.id}/deliveries`)
    if (res.ok) {
      const data = (await res.json()) as { deliveries: Delivery[] }
      setDeliveries(data.deliveries ?? [])
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="w-4 h-4" />
          Webhooks
        </CardTitle>
        <CardDescription>
          Get a nudge to your own systems the moment a contact or relationship changes — no polling.
          Each delivery is signed; verify the <code className="text-xs">X-Horace-Signature</code>{' '}
          header.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wh-url">Endpoint URL</Label>
            <Input
              id="wh-url"
              placeholder="https://example.com/horace/webhook"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="max-w-md"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-desc">Label (optional)</Label>
            <Input
              id="wh-desc"
              placeholder="e.g. Rex sync"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              className="max-w-md"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Events</Label>
            <div className="flex flex-wrap gap-3">
              {EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={events[ev]}
                    onChange={(e) => setEvents({ ...events, [ev]: e.target.checked })}
                  />
                  <code className="text-xs">{ev}</code>
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={creating || !url.trim()}>
            {creating ? 'Adding…' : 'Add webhook'}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>

        {revealedSecret && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
            <p className="text-sm font-medium">
              Copy this signing secret now — you won&apos;t see it again.
            </p>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-background border rounded px-2 py-1 flex-1 break-all font-mono">
                {revealedSecret}
              </code>
              <CopyButton text={revealedSecret} />
            </div>
          </div>
        )}

        <div className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : endpoints.length === 0 ? (
            <p className="text-sm text-muted-foreground">No webhooks yet.</p>
          ) : (
            <ul className="divide-y border rounded-md">
              {endpoints.map((ep) => (
                <li key={ep.id} className="px-3 py-2 space-y-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{ep.description || ep.url}</p>
                      <p className="text-xs text-muted-foreground truncate font-mono">{ep.url}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                      {statusBadge(ep)}
                      <Button variant="ghost" size="sm" onClick={() => viewLog(ep)}>
                        {openLog === ep.id ? 'Hide' : 'Deliveries'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggle(ep)}>
                        {ep.enabled ? 'Pause' : 'Resume'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(ep)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ep.events.map((ev) => (
                      <code
                        key={ev}
                        className="text-[10px] text-muted-foreground border rounded px-1"
                      >
                        {ev}
                      </code>
                    ))}
                  </div>
                  {ep.last_error && ep.status === 'failing' && (
                    <p className="text-xs text-destructive">{ep.last_error}</p>
                  )}
                  {openLog === ep.id && (
                    <div className="mt-2 rounded-md border bg-muted/30 p-2">
                      {deliveries.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No deliveries in the last 30 days.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {deliveries.map((d) => (
                            <li
                              key={d.id}
                              className="text-xs flex items-center justify-between gap-2"
                            >
                              <code>{d.event_type}</code>
                              <span className="text-muted-foreground">
                                {d.status}
                                {d.response_status ? ` · ${d.response_status}` : ''} ·{' '}
                                {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
