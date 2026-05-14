'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bookmark, ListPlus, Pencil, Trash2 } from 'lucide-react'
import { RowOverflowMenu } from '@/components/dashboard/row-overflow-menu'

// HOR-167  Client row for /lists overview.
//
// One saved list (manual or saved_filter). Owns the kebab → Rename / Delete
// affordances. Built-in rows on the overview page don't use this — they're
// read-only and render as plain server <Link>s.
//
// Refresh strategy: after a successful mutation we call router.refresh()
// so the server component re-fetches lists. Rename also flips local state
// optimistically so the input doesn't snap back to the old name on the
// brief render gap before the refresh lands.

export interface ListRowData {
  id: string
  name: string
  description: string | null
  kind: 'manual' | 'saved_filter'
  updated_at: string
  memberCount: number | null
}

interface ListRowProps {
  list: ListRowData
  isLast: boolean
}

export function ListRow({ list, isLast }: ListRowProps) {
  const router = useRouter()
  const isSaved = list.kind === 'saved_filter'

  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(list.name)
  const [draftName, setDraftName] = useState(list.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  async function commitRename() {
    const trimmed = draftName.trim()
    if (!trimmed || trimmed === name) {
      setRenaming(false)
      setDraftName(name)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/lists/${list.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Could not rename (${res.status})`)
      }
      setName(trimmed)
      setRenaming(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename')
    } finally {
      setBusy(false)
    }
  }

  async function commitDelete() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/lists/${list.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Could not delete (${res.status})`)
      }
      setConfirmDelete(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete')
      setBusy(false)
    }
  }

  const rowBaseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 18px',
    borderBottom: isLast ? 'none' : '1px solid rgba(140,123,107,0.1)',
    textDecoration: 'none',
    color: 'inherit',
  }

  // Row-level click → navigate to the list view. We skip navigation while
  // renaming (the input owns the row) and rely on RowOverflowMenu's own
  // stopPropagation to keep kebab clicks local. The input itself also
  // stops propagation so typing doesn't bubble into router.push.
  function handleRowActivate() {
    if (renaming) return
    router.push(`/contacts?list_id=${list.id}`)
  }

  return (
    <>
      <div
        role="link"
        tabIndex={renaming ? -1 : 0}
        onClick={handleRowActivate}
        onKeyDown={(e) => {
          if (renaming) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleRowActivate()
          }
        }}
        style={{
          ...rowBaseStyle,
          position: 'relative',
          cursor: renaming ? 'default' : 'pointer',
        }}
      >
        {/* Kind icon (parchment chip — same vocabulary as the page's built-in panel) */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 7,
            background: isSaved ? 'rgba(61,82,70,0.1)' : 'rgba(196,98,45,0.08)',
            color: isSaved ? '#3D5246' : '#C4622D',
            flexShrink: 0,
          }}
        >
          {isSaved ? (
            <Bookmark style={{ width: 13, height: 13 }} aria-hidden />
          ) : (
            <ListPlus style={{ width: 13, height: 13 }} aria-hidden />
          )}
        </span>

        {/* Name + meta. While renaming, the name is replaced by an inline
            input — the surrounding Link wrapper is suspended so clicks on
            the input don't navigate away. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            {renaming ? (
              <input
                ref={inputRef}
                value={draftName}
                onChange={(e) => {
                  setDraftName(e.target.value)
                  setError(null)
                }}
                // Keep typing + cursor clicks inside the input — don't let
                // them bubble to the row-level click handler.
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void commitRename()
                  } else if (e.key === 'Escape') {
                    setRenaming(false)
                    setDraftName(name)
                    setError(null)
                  }
                }}
                onBlur={() => void commitRename()}
                disabled={busy}
                maxLength={80}
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: '#1A1612',
                  background: '#FFFFFF',
                  border: '1px solid rgba(140,123,107,0.28)',
                  borderRadius: 5,
                  padding: '4px 8px',
                  outline: 'none',
                  minWidth: 220,
                  fontFamily: 'var(--font-body)',
                }}
              />
            ) : (
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: '#1A1612',
                }}
              >
                {name}
              </span>
            )}
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: isSaved ? '#3D5246' : '#C4622D',
              }}
            >
              {isSaved ? 'Saved view' : 'List'}
            </span>
          </div>
          {error && (
            <div role="alert" style={{ marginTop: 4, fontSize: 12, color: '#9C4A1F' }}>
              {error}
            </div>
          )}
          {!renaming && !error && list.description && (
            <div
              style={{
                fontSize: 12,
                color: '#8C7B6B',
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {list.description}
            </div>
          )}
        </div>

        {/* Meta + actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexShrink: 0,
          }}
        >
          {list.memberCount !== null && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: '#5E5246',
                background: 'rgba(140,123,107,0.12)',
                padding: '2px 8px',
                borderRadius: 9999,
              }}
            >
              {list.memberCount} {list.memberCount === 1 ? 'member' : 'members'}
            </span>
          )}
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: '#8C7B6B',
            }}
          >
            {formatRelative(list.updated_at)}
          </span>
          {/* Kebab — wrapped in a chip-style container so it reads as an
              affordance against the parchment row. The shared
              RowOverflowMenu icon is intentionally muted; on this surface
              (no hover-revealed columns) we want it always-visible. */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid rgba(140,123,107,0.2)',
              background: '#FFFFFF',
            }}
          >
            <RowOverflowMenu
              triggerLabel={`Actions for ${name}`}
              actions={[
                {
                  id: 'rename',
                  label: 'Rename',
                  Icon: Pencil,
                  onSelect: () => {
                    setDraftName(name)
                    setError(null)
                    setRenaming(true)
                  },
                },
                {
                  id: 'delete',
                  label: 'Delete',
                  Icon: Trash2,
                  destructive: true,
                  onSelect: () => {
                    setError(null)
                    setConfirmDelete(true)
                  },
                },
              ]}
            />
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDeleteDialog
          name={name}
          busy={busy}
          error={error}
          onCancel={() => {
            setConfirmDelete(false)
            setError(null)
          }}
          onConfirm={() => void commitDelete()}
        />
      )}
    </>
  )
}

function ConfirmDeleteDialog({
  name,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  name: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(26,22,18,0.36)',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm delete"
        style={{
          width: '100%',
          maxWidth: 380,
          background: '#FAF7F2',
          border: '1px solid rgba(140,123,107,0.22)',
          borderRadius: 12,
          boxShadow: '0 20px 48px rgba(26,22,18,0.18)',
          padding: '18px 20px',
          fontFamily: 'var(--font-body)',
          color: '#1A1612',
        }}
      >
        <h3
          className="font-display"
          style={{
            margin: '0 0 4px',
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          Delete this list?
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#5E5246', lineHeight: 1.5 }}>
          &ldquo;{name}&rdquo; will be removed. Members aren&rsquo;t affected — they stay in
          your book; only the bucket disappears.
        </p>
        {error && (
          <p role="alert" style={{ margin: '0 0 12px', fontSize: 12, color: '#9C4A1F' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '8px 12px',
              fontSize: 12,
              color: '#5E5246',
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 500,
              color: '#FAF7F2',
              background: '#9C4A1F',
              border: 'none',
              borderRadius: 6,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
              fontFamily: 'var(--font-body)',
            }}
          >
            <Trash2 style={{ width: 12, height: 12 }} />
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1)   return 'Just now'
  if (minutes < 60)  return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)    return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1)    return 'Yesterday'
  if (days < 7)      return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4)     return `${weeks}w ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
