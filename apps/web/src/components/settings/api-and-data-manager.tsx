'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ui/copy-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Key, Download } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'

export interface ApiV1KeyRow {
  id: string
  name: string
  masked: string
  last_used_at: string | null
  last_used_ip: string | null
  revoked_at: string | null
  created_at: string
}

interface Props {
  initialKeys: ApiV1KeyRow[]
  baseUrl: string
  /** When false, the data-export card is hidden. Use when the page renders
   *  its own "Your data" section at the correct position. Default: true. */
  showExport?: boolean
}

export function ApiAndDataManager({ initialKeys, baseUrl, showExport = true }: Props) {
  const [keys, setKeys] = useState<ApiV1KeyRow[]>(initialKeys)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{ id: string; plaintext: string } | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    setRevealed(null)

    const res = await fetch('/api/settings/api-v1-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Couldn't mint that key — have a look.")
      setCreating(false)
      return
    }

    const data = (await res.json()) as { key: ApiV1KeyRow; plaintext: string }
    setKeys([{ ...data.key, last_used_at: null, last_used_ip: null, revoked_at: null }, ...keys])
    setRevealed({ id: data.key.id, plaintext: data.plaintext })
    setName('')
    setCreating(false)
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this key? Anything using it stops working straight away.')) return
    const res = await fetch(`/api/settings/api-v1-keys/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setError("Couldn't revoke that key — have a look.")
      return
    }
    setKeys(keys.map((k) => (k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k)))
    if (revealed?.id === id) setRevealed(null)
  }

  function download(url: string) {
    window.location.href = url
  }

  const activeKeys = keys.filter((k) => !k.revoked_at)
  const revokedKeys = keys.filter((k) => k.revoked_at)

  return (
    <div className="space-y-6">
      {/* Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-4 h-4" />
            API keys
          </CardTitle>
          <CardDescription>
            Keys are scoped to your whole agency. Treat them like passwords — you see a key once,
            when you make it, and never again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">New key</Label>
              <div className="flex gap-2">
                <Input
                  id="key-name"
                  placeholder="e.g. Rex integration"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  className="max-w-sm"
                />
                <Button type="submit" disabled={creating || !name.trim()}>
                  {creating ? 'Making…' : 'New key'}
                </Button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>

          {revealed && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
              <p className="text-sm font-medium">
                Copy this key now — you won&apos;t see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-background border rounded px-2 py-1 flex-1 break-all font-mono">
                  {revealed.plaintext}
                </code>
                <CopyButton text={revealed.plaintext} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Active</p>
            {activeKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">No keys yet.</p>
            ) : (
              <ul className="divide-y border rounded-md">
                {activeKeys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{k.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{k.masked}</p>
                      <p className="text-xs text-muted-foreground">
                        Created {format(new Date(k.created_at), 'd MMM yyyy')}
                        {' · '}
                        {k.last_used_at
                          ? `last used ${formatDistanceToNow(new Date(k.last_used_at), { addSuffix: true })}${
                              k.last_used_ip ? ` from ${k.last_used_ip}` : ''
                            }`
                          : 'never used'}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleRevoke(k.id)}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {revokedKeys.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Revoked</p>
              <ul className="divide-y border rounded-md">
                {revokedKeys.map((k) => (
                  <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm truncate text-muted-foreground">{k.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Revoked {formatDistanceToNow(new Date(k.revoked_at!), { addSuffix: true })}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      Revoked
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Mini-docs: enough to make the first call. */}
          <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
            <p className="text-xs font-medium">Using the API</p>
            <pre className="text-xs bg-background border rounded px-2 py-2 overflow-x-auto font-mono">
              {`curl ${baseUrl}/contacts \\\n  -H "Authorization: Bearer hra_live_…"`}
            </pre>
            <p className="text-xs text-muted-foreground">
              Three resources — contacts, properties, relationships. HTTPS only, JSON only.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Export — hidden when the page renders its own Your data section */}
      {showExport && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="w-4 h-4" />
            Take your data anywhere
          </CardTitle>
          <CardDescription>
            Your contacts, properties, and the relationships between them — the whole agency
            dataset, exactly as the API returns it. No request, no wait.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => download('/api/settings/data-export?format=json')}>
              Download everything (JSON)
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => download('/api/settings/data-export?format=csv&resource=contacts')}
            >
              Contacts (CSV)
            </Button>
            <Button
              variant="outline"
              onClick={() => download('/api/settings/data-export?format=csv&resource=properties')}
            >
              Properties (CSV)
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                download('/api/settings/data-export?format=csv&resource=relationships')
              }
            >
              Relationships (CSV)
            </Button>
          </div>
        </CardContent>
      </Card>}
    </div>
  )
}
