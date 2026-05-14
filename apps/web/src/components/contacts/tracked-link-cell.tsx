'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Edit3, ExternalLink, Loader2 } from 'lucide-react'

interface TrackedLinkCellProps {
  contactId: string
  token: string | null
  destinationUrl: string | null
  lastClickedAt: string | null
  /** Public app URL prefix — joined with `/c/${token}`. */
  appUrl: string
  /** Workspace default destination URL (agent_settings.website_url). Shown
   *  in the edit popover as the fallback when the per-contact override is
   *  cleared. */
  defaultLinkUrl: string | null
}

/**
 * Per-contact tracked-link cell (HOR-136). Surfaces the row's tracked URL
 * with a Copy button and an Edit-destination popover. Anonymous contacts
 * (no token yet) render `—`.
 *
 * Behaviour preserved from the original feature (PR #4 / claude/plan-tracked-links-csv-0kK4U):
 *   - `${appUrl}/c/${token}` is the canonical short URL.
 *   - Destination override stored on contacts.tracked_link_destination_url
 *     via PATCH /api/contacts/[id]/tracked-link.
 *   - Null override falls back to agent_settings.website_url.
 *   - Last clicked timestamp surfaces as a small pill when present.
 */
export function TrackedLinkCell({
  contactId,
  token,
  destinationUrl,
  lastClickedAt,
  appUrl,
  defaultLinkUrl,
}: TrackedLinkCellProps) {
  const [copied, setCopied] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  if (!token) {
    return <span style={{ fontSize: 12, color: '#8C7B6B' }}>—</span>
  }

  const url = `${appUrl}/c/${token}`

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard refused — nothing to do */
    }
  }

  return (
    <div
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied' : url}
        aria-label={copied ? 'Copied tracked link' : 'Copy tracked link'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          fontSize: 11,
          fontWeight: 500,
          color: copied ? '#3D5246' : '#5E5246',
          background: copied ? 'rgba(61,82,70,0.1)' : 'rgba(140,123,107,0.08)',
          border: '1px solid rgba(140,123,107,0.18)',
          borderRadius: 6,
          cursor: 'pointer',
          fontFamily: 'var(--font-body)',
          transition: 'all 180ms',
        }}
      >
        {copied ? (
          <>
            <Check style={{ width: 11, height: 11 }} />
            Copied
          </>
        ) : (
          <>
            <Copy style={{ width: 11, height: 11 }} />
            Copy
          </>
        )}
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setEditOpen((o) => !o)
        }}
        title="Edit destination"
        aria-label="Edit tracked link destination"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          color: '#8C7B6B',
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        <Edit3 style={{ width: 12, height: 12 }} />
      </button>

      {lastClickedAt && (
        <span
          title={`Last clicked ${new Date(lastClickedAt).toLocaleString()}`}
          style={{
            fontSize: 9,
            color: '#C4622D',
            background: 'rgba(196,98,45,0.1)',
            padding: '1px 5px',
            borderRadius: 9999,
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
          }}
        >
          {relativeWhen(lastClickedAt)}
        </span>
      )}

      {editOpen && (
        <EditDestinationPopover
          contactId={contactId}
          currentValue={destinationUrl}
          defaultLinkUrl={defaultLinkUrl}
          trackedUrl={url}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  )
}

// ── Edit-destination popover ─────────────────────────────────────────────────

function EditDestinationPopover({
  contactId,
  currentValue,
  defaultLinkUrl,
  trackedUrl,
  onClose,
}: {
  contactId: string
  currentValue: string | null
  defaultLinkUrl: string | null
  trackedUrl: string
  onClose: () => void
}) {
  const [value, setValue] = useState(currentValue ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Click-outside to dismiss without saving.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!popoverRef.current) return
      if (!popoverRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [onClose])

  async function save(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setSaving(true)
    setError(null)
    const trimmed = value.trim()
    const payload = trimmed.length === 0 ? null : trimmed
    const res = await fetch(`/api/contacts/${contactId}/tracked-link`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination_url: payload }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data?.error ?? 'Could not save')
      setSaving(false)
      return
    }
    setSaving(false)
    onClose()
    // The row re-renders on next router.refresh() — for instant feedback
    // the parent could optimistic-update, but a refresh on close keeps
    // server truth canonical. We don't router.refresh() here to avoid
    // resetting the entire grid; callers wanting a re-fetch should hook
    // a softer revalidation path later.
  }

  return (
    <div
      ref={popoverRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        right: 0,
        top: 'calc(100% + 6px)',
        zIndex: 50,
        width: 320,
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.3)',
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(26,22,18,0.18)',
        padding: 14,
        fontFamily: 'var(--font-body)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#8C7B6B',
          marginBottom: 8,
        }}
      >
        Destination for this link
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={defaultLinkUrl ?? 'https://yoursite.com/page'}
        autoFocus
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 12,
          color: '#1A1612',
          background: '#FFFFFF',
          border: '1px solid rgba(140,123,107,0.3)',
          borderRadius: 6,
          outline: 'none',
          marginBottom: 8,
          fontFamily: 'var(--font-body)',
        }}
      />
      <p style={{ fontSize: 11, color: '#8C7B6B', margin: '0 0 10px', lineHeight: 1.5 }}>
        Leave blank to fall back to{' '}
        {defaultLinkUrl ? (
          <span style={{ fontFamily: 'var(--font-mono)', color: '#5E5246' }}>{defaultLinkUrl}</span>
        ) : (
          <span style={{ fontStyle: 'italic' }}>your workspace default</span>
        )}
        .
      </p>
      <div
        style={{
          fontSize: 10,
          color: '#8C7B6B',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontFamily: 'var(--font-mono)',
        }}
      >
        <ExternalLink style={{ width: 10, height: 10 }} />
        {trackedUrl}
      </div>
      {error && (
        <p style={{ fontSize: 11, color: '#9C4A1F', margin: '0 0 8px' }}>{error}</p>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          disabled={saving}
          style={{
            padding: '6px 10px',
            fontSize: 12,
            background: 'transparent',
            color: '#5E5246',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            background: '#1A1612',
            color: '#FAF7F2',
            border: 'none',
            borderRadius: 6,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
            fontFamily: 'var(--font-body)',
          }}
        >
          {saving && <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />}
          {saving ? 'Saving' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  const d = Math.floor(diff / 86_400_000)
  if (d === 1) return '1d'
  if (d < 7) return `${d}d`
  return `${Math.floor(d / 7)}w`
}
