'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ui/copy-button'
import { formatDistanceToNow, format } from 'date-fns'

interface TokenRow {
  id: string
  name: string
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

interface Props {
  initialTokens: TokenRow[]
  mcpUrl: string
}

export function ApiTokensManager({ initialTokens, mcpUrl }: Props) {
  const [tokens, setTokens] = useState<TokenRow[]>(initialTokens)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealedToken, setRevealedToken] = useState<{ id: string; plaintext: string } | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    setRevealedToken(null)

    const res = await fetch('/api/settings/api-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to mint token')
      setCreating(false)
      return
    }

    const data = (await res.json()) as { token: TokenRow; plaintext: string }
    setTokens([{ ...data.token, last_used_at: null, revoked_at: null }, ...tokens])
    setRevealedToken({ id: data.token.id, plaintext: data.plaintext })
    setName('')
    setCreating(false)
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this token? Anything using it will stop working immediately.')) return
    const res = await fetch(`/api/settings/api-tokens/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      setError('Failed to revoke token')
      return
    }
    setTokens(tokens.map((t) => (t.id === id ? { ...t, revoked_at: new Date().toISOString() } : t)))
    if (revealedToken?.id === id) setRevealedToken(null)
  }

  const activeTokens = tokens.filter((t) => !t.revoked_at)
  const revokedTokens = tokens.filter((t) => t.revoked_at)

  return (
    <div className="space-y-6">
      {mcpUrl && (
        <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
          <p className="text-xs font-medium">MCP endpoint</p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-background border rounded px-2 py-1 flex-1 truncate font-mono">
              {mcpUrl}
            </code>
            <CopyButton text={mcpUrl} />
          </div>
          <p className="text-xs text-muted-foreground">
            Paste this URL and a token below into Claude&apos;s MCP connector settings.
          </p>
        </div>
      )}

      <form onSubmit={handleCreate} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="token-name">Create new token</Label>
          <div className="flex gap-2">
            <Input
              id="token-name"
              placeholder="e.g. My Claude account"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="max-w-sm"
            />
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating ? 'Minting…' : 'Mint token'}
            </Button>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>

      {revealedToken && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
          <p className="text-sm font-medium">Copy this token now — you won&apos;t see it again.</p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-background border rounded px-2 py-1 flex-1 break-all font-mono">
              {revealedToken.plaintext}
            </code>
            <CopyButton text={revealedToken.plaintext} />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Active</p>
        {activeTokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active tokens.</p>
        ) : (
          <ul className="divide-y border rounded-md">
            {activeTokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {format(new Date(t.created_at), 'd MMM yyyy')}
                    {' · '}
                    {t.last_used_at
                      ? `last used ${formatDistanceToNow(new Date(t.last_used_at), { addSuffix: true })}`
                      : 'never used'}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleRevoke(t.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {revokedTokens.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Revoked</p>
          <ul className="divide-y border rounded-md">
            {revokedTokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm truncate text-muted-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Revoked {formatDistanceToNow(new Date(t.revoked_at!), { addSuffix: true })}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0">Revoked</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
