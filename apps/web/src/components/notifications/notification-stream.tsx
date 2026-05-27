'use client'

import { useMemo } from 'react'
import { MomentCard, type StackStyle } from './moment-card'
import { CaughtUp } from './caught-up'
import { EmptyState } from './empty-state'
import { SectionHead } from './section-head'
import { StreamHeader } from './stream-header'
import { BUCKET_LABELS, type Bucket, type StreamMoment } from './moment-types'

const BUCKET_ORDER: Bucket[] = ['today', 'yesterday', 'week', 'earlier']

export interface NotificationStreamProps {
  items: StreamMoment[]
  /** When true, show the empty-state surface instead of an empty feed. */
  isEmpty?: boolean
  /** Set of moment ids currently in the post-action confirmation state. */
  resolvedIds?: Set<string>
  /** Container shape — tightens header padding for the desktop slide-over. */
  container?: 'mobile' | 'desktop'
  stackStyle?: StackStyle
  onMarkAllRead?: () => void
  onPrimary?: (moment: StreamMoment) => void
  onMarkRead?: (moment: StreamMoment) => void
  onMarkUnread?: (moment: StreamMoment) => void
  onOpen?: (moment: StreamMoment) => void
  onSettings?: () => void
  onClose?: () => void
}

/**
 * Top-level Notifications stream component. Pure UI — the page (mobile)
 * and the slide-over panel (desktop) both feed it `items` and own their
 * own data-fetching, optimistic state, and action wiring.
 */
export function NotificationStream({
  items,
  isEmpty,
  resolvedIds,
  container = 'mobile',
  stackStyle = 'flat',
  onMarkAllRead,
  onPrimary,
  onMarkRead,
  onMarkUnread,
  onOpen,
  onSettings,
  onClose,
}: NotificationStreamProps) {
  const unreadCount = useMemo(() => items.filter((m) => m.unread).length, [items])

  const byBucket = useMemo(() => {
    const out: Record<Bucket, StreamMoment[]> = { today: [], yesterday: [], week: [], earlier: [] }
    for (const m of items) out[m.bucket].push(m)
    return out
  }, [items])

  const isEmptyComputed = isEmpty || items.length === 0

  return (
    <div
      style={{
        background: '#F5F0E8',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <StreamHeader
        unreadCount={unreadCount}
        onMarkAllRead={onMarkAllRead}
        container={container}
        onClose={onClose}
        onSettings={onSettings}
      />

      {isEmptyComputed ? (
        <EmptyState />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {BUCKET_ORDER.map((bucket) => {
            const entries = byBucket[bucket]
            if (entries.length === 0) return null
            return (
              <div key={bucket}>
                <SectionHead count={entries.length}>{BUCKET_LABELS[bucket]}</SectionHead>
                <div style={{ padding: '0 12px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {entries.map((moment) => (
                    <MomentCard
                      key={moment.id}
                      moment={moment}
                      resolved={resolvedIds?.has(moment.id) ?? false}
                      stackStyle={stackStyle}
                      onPrimary={onPrimary}
                      onMarkRead={onMarkRead}
                      onMarkUnread={onMarkUnread}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              </div>
            )
          })}
          <CaughtUp />
          <div style={{ height: 12 }} />
        </div>
      )}
    </div>
  )
}
