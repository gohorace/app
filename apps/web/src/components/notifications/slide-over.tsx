'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { NotificationsDropdown } from './notifications-dropdown'
import type { StreamMoment } from './moment-types'

/**
 * Notifications dropdown host. Mounted once at the dashboard layout level,
 * so any surface (digest/stream, contacts, properties, lists, market) can
 * open it via the bell in its page header.
 *
 * Open/close is driven by `location.hash === '#notifications'`. The
 * BellButton sets/clears the hash; this component listens for changes and
 * toggles. ESC closes, a click outside the panel closes, the close button
 * in the dropdown header closes.
 *
 * v2 (Refactor V1) — the surface is a compact floating dropdown anchored
 * under the topbar bell (see `NotificationsDropdown`), not a full-height
 * slide-over. The dedicated `/notifications` page was removed; this is the
 * only notifications surface.
 *
 * Data is fetched client-side via `GET /api/notifications` whenever the
 * panel opens. No SSR — the panel is decoupled from the underlying page.
 */

export function NotificationsSlideOver() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<StreamMoment[]>([])
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()
  const panelRef = useRef<HTMLDivElement>(null)

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

  // Esc-to-close + click-outside-to-close.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    function onPointer(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', onKey)
    // Defer the pointer listener a tick so the click that opened the panel
    // (the bell) doesn't immediately close it.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onPointer), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onPointer)
    }
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

  // Whole-row tap: mark read, refresh the bell badge, navigate to the subject,
  // and close. Property subjects navigate to the property detail page; contacts
  // to the contact detail page. HOR-231 — refresh decrements the bell badge.
  const handleRowClick = useCallback(
    (moment: StreamMoment) => {
      markReadLocal(moment.id)
      void fetch(`/api/notifications/${moment.id}/read`, { method: 'POST' }).then(() =>
        startTransition(() => router.refresh()),
      )
      close()
      if (moment.subject.kind === 'contact') {
        router.push(`/contacts/${moment.subject.id}`)
      } else if (moment.subject.kind === 'property') {
        router.push(`/properties/${moment.subject.id}`)
      }
    },
    [markReadLocal, close, router],
  )

  const handleSettings = useCallback(() => {
    close()
    router.push('/settings/notifications')
  }, [close, router])

  if (!open) return null

  return (
    <NotificationsDropdown
      items={items}
      isEmpty={!loading && items.length === 0}
      panelRef={panelRef}
      onClose={close}
      onRowClick={handleRowClick}
      onMarkAllRead={handleMarkAllRead}
      onSettings={handleSettings}
    />
  )
}
