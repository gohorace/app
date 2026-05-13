'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns'
import { Bell, CheckCheck } from 'lucide-react'

type NotificationItem = {
  id: string
  type: string
  contact_id: string | null
  title: string | null
  body: string | null
  url: string | null
  sent_at: string
  read_at: string | null
}

interface Props {
  initialItems: NotificationItem[]
  initialCursor: string | null
}

const PARCHMENT = '#F5F0E8'
const CREAM     = '#FAF7F2'
const CHARCOAL  = '#2E2823'
const INK       = '#1A1612'
const TERRACOTTA = '#C4622D'
const STONE     = '#8C7B6B'
const BORDER    = '#E4DCDA'

function isIOSWithoutPWA(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return isIOS && !isStandalone
}

function dayLabel(date: Date): string {
  if (isToday(date))     return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'EEEE d MMMM')
}

function groupByDay(items: NotificationItem[]): { label: string; items: NotificationItem[] }[] {
  const groups = new Map<string, NotificationItem[]>()
  for (const item of items) {
    const key = format(new Date(item.sent_at), 'yyyy-MM-dd')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }
  return Array.from(groups.entries()).map(([key, items]) => ({
    label: dayLabel(new Date(key)),
    items,
  }))
}

export function NotificationsList({ initialItems, initialCursor }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>(initialItems)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [loadingMore, setLoadingMore] = useState(false)
  const [, startTransition] = useTransition()

  const grouped = useMemo(() => groupByDay(items), [items])
  const unreadCount = useMemo(() => items.filter(i => !i.read_at).length, [items])
  const showIOSHint = items.length === 0 && isIOSWithoutPWA()

  const markRead = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id && !i.read_at ? { ...i, read_at: new Date().toISOString() } : i)),
    )
    fetch(`/api/notifications/${id}/read`, { method: 'POST' })
      .then(() => startTransition(() => router.refresh()))
      .catch(() => { /* optimistic update stands; next refresh corrects */ })
  }, [router])

  const markAllRead = useCallback(() => {
    setItems((prev) => prev.map((i) => (i.read_at ? i : { ...i, read_at: new Date().toISOString() })))
    fetch('/api/notifications/mark-all-read', { method: 'POST' })
      .then(() => startTransition(() => router.refresh()))
      .catch(() => { /* optimistic update stands */ })
  }, [router])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/notifications?cursor=${encodeURIComponent(cursor)}`)
      if (!res.ok) return
      const { items: more, nextCursor } = await res.json() as { items: NotificationItem[]; nextCursor: string | null }
      setItems((prev) => [...prev, ...more])
      setCursor(nextCursor)
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: '20px 24px',
          background: CREAM,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div>
          <h1
            className="font-display"
            style={{ fontSize: '22px', fontWeight: 700, color: INK, letterSpacing: '-0.02em', margin: 0 }}
          >
            Notifications
          </h1>
          <p style={{ fontSize: '12px', color: STONE, margin: '2px 0 0' }}>
            Everything Horace has flagged for you.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="flex items-center gap-1.5 transition-colors hover:bg-black/[0.04]"
            style={{
              fontSize: '12px',
              color: STONE,
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'transparent',
              border: `1px solid ${BORDER}`,
              cursor: 'pointer',
            }}
          >
            <CheckCheck style={{ width: '13px', height: '13px' }} />
            Mark all read
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" style={{ background: PARCHMENT }}>
        {items.length === 0 ? (
          <EmptyState showIOSHint={showIOSHint} />
        ) : (
          <div style={{ maxWidth: '720px', margin: '0 auto', padding: '20px 16px 80px' }}>
            {grouped.map((group) => (
              <section key={group.label} style={{ marginBottom: '24px' }}>
                <h2
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: STONE,
                    margin: '0 0 8px',
                    padding: '0 4px',
                  }}
                >
                  {group.label}
                </h2>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {group.items.map((item) => (
                    <NotificationRow
                      key={item.id}
                      item={item}
                      onClick={() => markRead(item.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}

            {cursor && (
              <div style={{ textAlign: 'center', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{
                    fontSize: '13px',
                    color: STONE,
                    padding: '8px 16px',
                    borderRadius: '6px',
                    background: 'transparent',
                    border: `1px solid ${BORDER}`,
                    cursor: loadingMore ? 'default' : 'pointer',
                    opacity: loadingMore ? 0.5 : 1,
                  }}
                >
                  {loadingMore ? 'Loading…' : 'Load older'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function NotificationRow({ item, onClick }: { item: NotificationItem; onClick: () => void }) {
  const isUnread = !item.read_at
  const href = item.url || (item.contact_id ? `/contacts/${item.contact_id}` : null)

  const inner = (
    <div
      style={{
        display: 'flex',
        gap: '12px',
        padding: '14px',
        background: CREAM,
        border: `1px solid ${BORDER}`,
        borderRadius: '10px',
        marginBottom: '8px',
        cursor: href ? 'pointer' : 'default',
      }}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          background: isUnread ? 'rgba(196,98,45,0.12)' : 'rgba(140,123,107,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Bell
          style={{
            width: '15px',
            height: '15px',
            color: isUnread ? TERRACOTTA : STONE,
            strokeWidth: 1.7,
          }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
          <p
            style={{
              fontSize: '14px',
              fontWeight: isUnread ? 600 : 500,
              color: INK,
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.title}
          </p>
          <span
            style={{
              fontSize: '11px',
              color: STONE,
              flexShrink: 0,
            }}
          >
            {formatDistanceToNow(new Date(item.sent_at), { addSuffix: true })}
          </span>
        </div>
        {item.body && (
          <p
            style={{
              fontSize: '13px',
              color: STONE,
              margin: '4px 0 0',
              lineHeight: 1.5,
            }}
          >
            {item.body}
          </p>
        )}
      </div>
      {isUnread && (
        <div
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: TERRACOTTA,
            flexShrink: 0,
            marginTop: '12px',
          }}
        />
      )}
    </div>
  )

  return (
    <li>
      {href ? (
        <Link href={href} onClick={onClick} style={{ textDecoration: 'none' }}>
          {inner}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onClick}
          style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }}
        >
          {inner}
        </button>
      )}
    </li>
  )
}

function EmptyState({ showIOSHint }: { showIOSHint: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '64px 24px',
        maxWidth: '440px',
        margin: '0 auto',
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'rgba(140,123,107,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '16px',
        }}
      >
        <Bell style={{ width: '26px', height: '26px', color: STONE, strokeWidth: 1.5 }} />
      </div>
      <h2
        style={{
          fontSize: '17px',
          fontWeight: 600,
          color: INK,
          margin: 0,
        }}
      >
        Nothing yet
      </h2>
      <p
        style={{
          fontSize: '13px',
          color: STONE,
          margin: '6px 0 0',
          lineHeight: 1.6,
        }}
      >
        Horace will record every alert here, so you can scroll back to anything you missed.
      </p>
      {showIOSHint && (
        <div
          style={{
            marginTop: '20px',
            padding: '12px 14px',
            background: CREAM,
            border: `1px solid ${BORDER}`,
            borderRadius: '8px',
            fontSize: '12px',
            color: CHARCOAL,
            lineHeight: 1.6,
            textAlign: 'left',
          }}
        >
          On iPhone? Install Horace to your home screen — Share → Add to Home Screen — and grant push permission. That way Horace can tap you on the shoulder the moment something stirs.
        </div>
      )}
    </div>
  )
}
