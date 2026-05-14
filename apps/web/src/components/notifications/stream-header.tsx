'use client'

import { Settings2, X } from 'lucide-react'

export interface StreamHeaderProps {
  unreadCount: number
  onMarkAllRead?: () => void
  /** Tightens type sizes + spacing for the 420px desktop panel container. */
  container?: 'mobile' | 'desktop'
  /** Renders a close (×) button on the right — desktop slide-over only. */
  onClose?: () => void
  /** Renders the settings cog. Links to /settings/notifications. */
  onSettings?: () => void
}

/**
 * Stream-level header. Sits at the top of the feed (sticky in the scroll
 * region above). Right side carries Mark-all-read (when there's unread),
 * the notification-settings cog, and — on desktop — the panel close button.
 */
export function StreamHeader({
  unreadCount,
  onMarkAllRead,
  container = 'mobile',
  onClose,
  onSettings,
}: StreamHeaderProps) {
  const isDesktop = container === 'desktop'

  return (
    <div
      style={{
        padding: isDesktop ? '18px 20px 14px' : '14px 16px 12px',
        borderBottom: '1px solid rgba(140,123,107,0.12)',
        background: '#F5F0E8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexShrink: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: isDesktop ? 22 : 24,
            fontWeight: 600,
            color: '#1A1612',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
          }}
        >
          Notifications
        </div>
        <div style={{ fontSize: 12, color: '#8C7B6B', marginTop: 3 }}>
          {unreadCount > 0 ? (
            <>
              {unreadCount} unread · <span style={{ fontStyle: 'italic' }}>Horace is watching</span>
            </>
          ) : (
            <span style={{ fontStyle: 'italic' }}>You&rsquo;re up to date</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {unreadCount > 0 && onMarkAllRead && (
          <button
            type="button"
            onClick={onMarkAllRead}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#5A4D40',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: "'DM Sans', sans-serif",
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: 6,
            }}
          >
            Mark all as read
          </button>
        )}
        <button
          type="button"
          aria-label="Notification settings"
          onClick={onSettings}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'transparent',
            border: '1px solid rgba(140,123,107,0.22)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#5A4D40',
          }}
        >
          <Settings2 style={{ width: 14, height: 14, strokeWidth: 1.75 }} />
        </button>
        {isDesktop && onClose && (
          <button
            type="button"
            aria-label="Close panel"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'transparent',
              border: '1px solid rgba(140,123,107,0.22)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#5A4D40',
              marginLeft: 2,
            }}
          >
            <X style={{ width: 14, height: 14, strokeWidth: 1.75 }} />
          </button>
        )}
      </div>
    </div>
  )
}
