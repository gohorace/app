'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AddToListSheet } from '@/components/lists/add-to-list-sheet'
import type { ListRecord } from '@/lib/lists/use-lists'
import { NotificationStream } from './notification-stream'
import type { StreamMoment } from './moment-types'

/**
 * Page-level client wrapper for `/notifications`. Owns:
 *  - optimistic read state for the cards
 *  - "Add to list" sheet open/close
 *  - the post-action resolved-pill timing (5s hold, then settle to read)
 *  - mark-all-read wiring + open-subject navigation
 *
 * The stream component itself stays pure-presentational.
 */

const RESOLVED_HOLD_MS = 5_000

interface Props {
  initialItems: StreamMoment[]
}

export function NotificationsPageClient({ initialItems }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<StreamMoment[]>(initialItems)
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())
  const [sheet, setSheet] = useState<{ moment: StreamMoment } | null>(null)
  const [, startTransition] = useTransition()

  const markReadLocal = useCallback((id: string) => {
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, unread: false } : m)))
  }, [])

  const markRead = useCallback(
    (id: string) => {
      markReadLocal(id)
      void fetch(`/api/notifications/${id}/read`, { method: 'POST' }).then(() =>
        startTransition(() => router.refresh()),
      )
    },
    [markReadLocal, router],
  )

  const handleMarkAllRead = useCallback(() => {
    setItems((prev) => prev.map((m) => (m.unread ? { ...m, unread: false } : m)))
    void fetch('/api/notifications/mark-all-read', { method: 'POST' }).then(() =>
      startTransition(() => router.refresh()),
    )
  }, [router])

  const handleOpen = useCallback(
    (moment: StreamMoment) => {
      markRead(moment.id)
      if (moment.subject.kind === 'contact') {
        router.push(`/contacts/${moment.subject.id}`)
      }
      // Property subjects: no-op in Slice A — properties don't have a
      // canonical detail route yet.
    },
    [router, markRead],
  )

  const handlePrimary = useCallback(
    (moment: StreamMoment) => {
      // Contact subjects → Add to list sheet. Property subjects (Slice B)
      // → Add to Watching sheet, which doesn't exist yet.
      if (moment.subject.kind === 'contact') {
        setSheet({ moment })
        return
      }
      // Fallback for property primaries in Slice A — just open the subject.
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

      // Hold the confirmation pill, then settle back to the standard
      // read-state card. The brief asks for this transition to be felt
      // but not lingering — 5s is the spec.
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

  const handleMore = useCallback(() => {
    // Slice B wires Snooze / Dismiss / Not useful. Slice A: no-op (the
    // trigger button still renders for visual fidelity to the mock).
  }, [])

  const sheetSubjectLabel = useMemo(() => {
    if (!sheet) return undefined
    return sheet.moment.subject.kind === 'contact'
      ? sheet.moment.subject.name
      : sheet.moment.subject.address
  }, [sheet])

  return (
    <>
      <NotificationStream
        items={items}
        resolvedIds={resolvedIds}
        container="mobile"
        onMarkAllRead={handleMarkAllRead}
        onPrimary={handlePrimary}
        onMore={handleMore}
        onOpen={handleOpen}
        onSettings={() => router.push('/settings/notifications')}
      />

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
