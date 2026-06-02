'use client'

/**
 * EmailExclusionsManager — client CRUD UI for /settings/email-exclusions.
 *
 * Pattern mirrors api-tokens-manager (which is the established settings-manager
 * shape in Horace): add form at top, two grouped lists below (defaults vs
 * agent-added). Optimistic UI: state mutates on POST/DELETE success; the
 * page-level Server Component re-loads next nav.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from 'date-fns'

interface ExclusionRow {
  id: string
  pattern: string
  pattern_kind: 'email' | 'domain'
  reason: string | null
  source: 'agent' | 'seeded' | 'auto_bounce'
  created_at: string
}

interface Props {
  initialExclusions: ExclusionRow[]
}

export function EmailExclusionsManager({ initialExclusions }: Props) {
  const [exclusions, setExclusions] = useState<ExclusionRow[]>(initialExclusions)
  const [pattern, setPattern] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = pattern.trim()
    if (!trimmed) return

    setAdding(true)
    setError(null)

    const res = await fetch('/api/settings/email-exclusions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: trimmed }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { error?: string }))
      setError(body.error ?? 'Failed to add exclusion')
      setAdding(false)
      return
    }

    const data = (await res.json()) as { exclusion: ExclusionRow }
    setExclusions([...exclusions, data.exclusion])
    setPattern('')
    setAdding(false)
  }

  async function handleRemove(row: ExclusionRow) {
    // Seeded defaults get a confirmation step; agent-added rows go straight.
    if (row.source === 'seeded' && confirmingId !== row.id) {
      setConfirmingId(row.id)
      return
    }
    setConfirmingId(null)

    const res = await fetch(
      `/api/settings/email-exclusions/${row.id}`,
      { method: 'DELETE' },
    )
    if (!res.ok && res.status !== 204) {
      setError('Failed to remove exclusion')
      return
    }
    setExclusions(exclusions.filter((e) => e.id !== row.id))
  }

  const seeded = exclusions.filter((e) => e.source === 'seeded')
  const autoBounced = exclusions.filter((e) => e.source === 'auto_bounce')
  const agentAdded = exclusions.filter((e) => e.source === 'agent')

  return (
    <div className="space-y-6">
      {/* ── Add form ───────────────────────────────────────────────────── */}
      <form onSubmit={handleAdd} className="space-y-2">
        <Label htmlFor="exclusion-pattern">Add an exclusion</Label>
        <div className="flex gap-2">
          <Input
            id="exclusion-pattern"
            placeholder="foo@bar.com or *@bar.com"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            maxLength={254}
            className="max-w-sm"
          />
          <Button type="submit" disabled={adding || !pattern.trim()}>
            {adding ? 'Adding…' : 'Add'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Accepts <code className="text-[0.9em]">foo@bar.com</code> (one address),{' '}
          <code className="text-[0.9em]">bar.com</code> (whole domain), or{' '}
          <code className="text-[0.9em]">*@bar.com</code> (same as bar.com, explicit form).
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>

      {/* ── Agent-added ────────────────────────────────────────────────── */}
      <Section
        title="Added by you"
        empty="Nothing here yet — add a recipient or domain above to block tracked sends to them."
        rows={agentAdded}
        onRemove={handleRemove}
        confirmingId={confirmingId}
      />

      {/* ── Auto-bounce (slice G fills this) ──────────────────────────── */}
      {autoBounced.length > 0 && (
        <Section
          title="Auto-added from bounces"
          empty=""
          rows={autoBounced}
          onRemove={handleRemove}
          confirmingId={confirmingId}
          subtitle="Recipients that bounced hard. Remove if you've verified the address is good now."
        />
      )}

      {/* ── Seeded AU defaults ────────────────────────────────────────── */}
      <Section
        title="AU defaults (seeded)"
        empty="No defaults present — unusual, contact support."
        rows={seeded}
        onRemove={handleRemove}
        confirmingId={confirmingId}
        subtitle="Portal / aggregator domains where cold outbound would violate ToS or look spammy. You can remove a default if you genuinely send to it — Horace asks you to confirm first."
      />
    </div>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  empty,
  rows,
  onRemove,
  confirmingId,
}: {
  title: string
  subtitle?: string
  empty: string
  rows: ExclusionRow[]
  onRemove: (row: ExclusionRow) => void
  confirmingId: string | null
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {rows.length === 0 ? (
        empty && <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <code className="text-sm font-mono">{row.pattern}</code>
                <Badge variant="outline" className="text-[0.7rem] uppercase">
                  {row.pattern_kind}
                </Badge>
                {row.reason && row.source !== 'agent' && (
                  <span className="text-xs text-muted-foreground">
                    · {row.reason}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  · added {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 self-end sm:self-auto"
                onClick={() => onRemove(row)}
              >
                {confirmingId === row.id ? 'Confirm remove?' : 'Remove'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
