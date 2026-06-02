'use client'

/**
 * HOR-285 — EmbedOriginsManager.
 *
 * Manages the sites allowed to use the website embed
 * (workspace_settings.snippet_domains). The embed's capture endpoint hard-
 * rejects submissions from any origin not listed here, so the empty state is
 * a deliberate warning: the form won't accept anything until the agent adds
 * their site. Verified Doorstep custom domains are shown as auto-allowed
 * (read-only — they're trusted at the endpoint without being stored here).
 *
 * Mirrors the email-exclusions manager: add form on top, list below,
 * optimistic state from the API response.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

interface Props {
  initialOrigins: string[]
  /** Verified custom domains — auto-allowed at the endpoint, shown read-only. */
  autoAllowed: string[]
}

export function EmbedOriginsManager({ initialOrigins, autoAllowed }: Props) {
  const [origins, setOrigins] = useState<string[]>(initialOrigins)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const v = value.trim()
    if (!v) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/settings/embed-origins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: v }),
    })
    const data = (await res.json().catch(() => ({}))) as { origins?: string[]; error?: string }
    if (!res.ok || !data.origins) {
      setError(data.error ?? 'Failed to add')
      setBusy(false)
      return
    }
    setOrigins(data.origins)
    setValue('')
    setBusy(false)
  }

  async function handleRemove(host: string) {
    setError(null)
    const res = await fetch(`/api/settings/embed-origins?origin=${encodeURIComponent(host)}`, {
      method: 'DELETE',
    })
    const data = (await res.json().catch(() => ({}))) as { origins?: string[]; error?: string }
    if (!res.ok || !data.origins) {
      setError(data.error ?? 'Failed to remove')
      return
    }
    setOrigins(data.origins)
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleAdd} className="space-y-2">
        <Label htmlFor="embed-origin">Add your website</Label>
        <div className="flex gap-2">
          <Input
            id="embed-origin"
            placeholder="youragency.com.au"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={253}
            className="max-w-sm"
          />
          <Button type="submit" disabled={busy || !value.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The domain where you’ll paste the embed, e.g.{' '}
          <code className="text-[0.9em]">youragency.com.au</code>. The form only accepts sign-ins
          from sites listed here.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>

      <div className="space-y-2">
        <p className="text-sm font-medium">Your sites</p>
        {origins.length === 0 ? (
          <p className="text-sm text-destructive">
            No sites added yet — the embed won’t accept any sign-ins until you add the website you’re
            putting it on.
          </p>
        ) : (
          <ul className="divide-y border rounded-md">
            {origins.map((host) => (
              <li key={host} className="flex items-center justify-between gap-3 px-3 py-2">
                <code className="min-w-0 truncate text-sm font-mono">{host}</code>
                <Button variant="ghost" size="sm" className="shrink-0" onClick={() => handleRemove(host)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {autoAllowed.length > 0 && (
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium">Auto-allowed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Your verified Doorstep domain is trusted automatically.
            </p>
          </div>
          <ul className="divide-y border rounded-md">
            {autoAllowed.map((host) => (
              <li key={host} className="flex items-center justify-between gap-3 px-3 py-2">
                <code className="text-sm font-mono">{host}</code>
                <Badge variant="outline" className="text-[0.7rem] uppercase">
                  Verified
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
