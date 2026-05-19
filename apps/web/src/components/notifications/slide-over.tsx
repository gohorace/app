'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AddToListSheet } from '@/components/lists/add-to-list-sheet'
import type { ListRecord } from '@/lib/lists/use-lists'
import { NotificationStream } from './notification-stream'
import type { StreamMoment } from './moment-types'

/**
 * Notifications slide-over. Mounted once at the dashboard layout level,
 * so any surface (digest, contacts, properties, lists, market) can open
 * it via the bell in its page header.
 *
 * Open/close is driven by `location.hash === '#notifications'`. The
 * BellButton sets/clears the hash; this component listens for changes
 * and toggles. ESC closes, scrim click closes, the close button in the
 * stream header closes.
 *
 * v2-M1 (HOR-242) — this is the only notifications surface. The dedicated
 * `/notifications` page was removed; on mobile the panel takes the full
 * viewport width and on desktop it's a 420px right-anchored aside.
 *
 * Data is fetched client-side via `GET /api/notifications` whenever the
 * panel opens. No SSR — the panel is decoupled from the underlying page.
 */

const RESOLVED_HOLD_MS = 5_000

export function NotificationsSlideOver() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<StreamMoment[]>([])
  const [loading, setLoading] = useState(false)
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())
  const [sheet, setSheet] = useState<{ moment: StreamMoment } | null>(null)
  const [, startTransition] = useTransition()

  // Sync open-state with the URL hash on mount + every hashchange.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function syncFromHash() {
      setOpen(window.location.hash === '#notifications')
    }
    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [])

  const close = useCallback(() => {
    if (typeof window === 'undefined') return
    history.replaceState(null, '', window.location.pathname + window.location.search)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [])

  // Esc-to-close.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  // Fetch on open. Refetch any time we go from closed→open.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    fetch('/api/notifications')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { items: StreamMoment[] }) => {
        if (cancelled) return
        setItems(data.items ?? [])
      })
      .catch((err) => {
        console.error('[notifications/slide-over] fetch failed:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const markReadLocal = useCallback((id: string) => {
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, unread: false } : m)))
  }, [])

  const handleMarkAllRead = useCallback(() => {
    setItems((prev) => prev.map((m) => (m.unread ? { ...m, unread: false } : m)))
    void fetch('/api/notifications/mark-all-read', { method: 'POST' }).then(() =>
      startTransition(() => router.refresh()),
    )
  }, [router])

  const handleOpen = useCallback(
    (moment: StreamMoment) => {
      markReadLocal(moment.id)
      void fetch(`/api/notifications/${moment.id}/read`, { method: 'POST' })
      close()
      if (moment.subject.kind === 'contact') {
        router.push(`/contacts/${moment.subject.id}`)
      }
    },
    [markReadLocal, close, router],
  )

  const handlePrimary = useCallback(
    (moment: StreamMoment) => {
      if (moment.subject.kind === 'contact') {
        setSheet({ moment })
        return
      }
      handleOpen(moment)
    },
    [handleOpen],
  )

  const handleAddedToList = useCallback(
    (_list: ListRecord) => {
      const id = sheet?.moment.id
      if (!id) return
      setResolvedIds((prev) => new Set(prev).add(id))
      markReadLocal(id)
      void fetch(`/api/notifications/${id}/read`, { method: 'POST' })
      window.setTimeout(() => {
        setResolvedIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, RESOLVED_HOLD_MS)
    },
    [sheet?.moment.id, markReadLocal],
  )

  const sheetSubjectLabel = useMemo(() => {
    if (!sheet) return undefined
    return sheet.moment.subject.kind === 'contact'
      ? sheet.moment.subject.name
      : sheet.moment.subject.address
  }, [sheet])

  // Always render the markup — the inner display:none gates visibility.
  // This keeps the hashchange listener alive without re-mounting.
  if (!open) return null

  return (
    <>
      {/* Scrim — covers everything LEFT of the panel. Hidden on mobile,
        * where the panel itself takes the full viewport width. */}
      <div
        onClick={close}
        className="hidden md:block"
        style={{
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          right: 420,
          background: 'rgba(26,22,18,0.18)',
          backdropFilter: 'blur(1px)',
          WebkitBackdropFilter: 'blur(1px)',
          zIndex: 50,
        }}
        aria-hidden
      />

      {/* Panel — full-width on mobile, 420px right-anchored on desktop. */}
      <aside
        role="dialog"
        aria-label="Notifications"
        className="flex w-full md:w-[420px]"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          background: '#F5F0E8',
          boxShadow: '-12px 0 32px rgba(26,22,18,0.18)',
          borderLeft: '1px solid rgba(140,123,107,0.18)',
          flexDirection: 'column',
          zIndex: 51,
        }}
      >
        <NotificationStream
          items={items}
          isEmpty={!loading && items.length === 0}
          resolvedIds={resolvedIds}
          container="desktop"
          onMarkAllRead={handleMarkAllRead}
          onPrimary={handlePrimary}
          onOpen={handleOpen}
          onSettings={() => {
            close()
            router.push('/settings/notifications')
          }}
          onClose={close}
        />
      </aside>

      {sheet?.moment.subject.kind === 'contact' && (
        <AddToListSheet
          open={!!sheet}
          onClose={() => setSheet(null)}
          contactId={sheet.moment.subject.id}
          subjectLabel={sheetSubjectLabel}
          onAdded={handleAddedToList}
        />
      )}
    </>
  )
}
