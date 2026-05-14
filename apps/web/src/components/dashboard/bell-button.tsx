'use client'

import Link from 'next/link'
import { Bell } from 'lucide-react'

/**
 * BellButton — primary entry point to the Notifications stream.
 *
 *  - On `>= md`: clicking sets `location.hash = 'notifications'`, which
 *    the `<NotificationsSlideOver />` mounted in the dashboard layout
 *    listens to and toggles open.
 *  - On `< md`: just navigates to `/notifications` (full-screen stream).
 *    No overlay on mobile — the stream IS the mobile surface.
 *
 * Implemented as two siblings — a hidden-on-mobile button + a
 * hidden-on-desktop link — both rendering the same chrome. Avoids a
 * useMediaQuery hook (consistent with the rest of the codebase, which
 * gates responsive behaviour with Tailwind `md:` utilities).
 *
 * Badge: numeric pill with the unread count (clamped to 99+). When
 * `attentionCount` is 0 the badge is omitted entirely.
 */

export interface BellButtonProps {
  attentionCount: number
  /** Optional ARIA label; defaults to "Notifications". */
  label?: string
}

export function BellButton({ attentionCount, label = 'Notifications' }: BellButtonProps) {
  const hasUnread = attentionCount > 0
  const badgeText = attentionCount > 99 ? '99+' : String(attentionCount)

  const chrome = (
    <span
      aria-label={label}
      style={{
        width: 38,
        height: 38,
        borderRadius: 9,
        background: hasUnread ? 'rgba(196,98,45,0.12)' : 'transparent',
        border: hasUnread ? '1px solid rgba(196,98,45,0.4)' : '1px solid rgba(140,123,107,0.22)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        color: hasUnread ? '#C4622D' : '#5A4D40',
        cursor: 'pointer',
        transition: 'background 180ms cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      <Bell style={{ width: 16, height: 16, strokeWidth: 1.75 }} />
      {hasUnread && (
        <span
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            background: '#C4622D',
            color: '#FAF7F2',
            borderRadius: 9999,
            fontSize: 9,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #F5F0E8',
            lineHeight: 1,
          }}
        >
          {badgeText}
        </span>
      )}
    </span>
  )

  return (
    <>
      {/* Desktop: toggle the slide-over via URL hash. Tailwind `md:` gates visibility. */}
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          if (typeof window === 'undefined') return
          // Toggle: if the hash is already #notifications, clear it.
          if (window.location.hash === '#notifications') {
            history.replaceState(null, '', window.location.pathname + window.location.search)
            // Manually nudge listeners — `replaceState` doesn't fire hashchange.
            window.dispatchEvent(new HashChangeEvent('hashchange'))
          } else {
            window.location.hash = 'notifications'
          }
        }}
        className="hidden md:inline-flex"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
      >
        {chrome}
      </button>

      {/* Mobile: navigate to /notifications. */}
      <Link
        href="/notifications"
        aria-label={label}
        className="md:hidden"
        style={{ textDecoration: 'none' }}
      >
        {chrome}
      </Link>
    </>
  )
}
