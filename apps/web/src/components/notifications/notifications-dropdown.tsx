'use client'

import { ChevronRight, SlidersHorizontal, X } from 'lucide-react'
import type { StreamMoment } from './moment-types'

/**
 * NotificationsDropdown — the v2 notifications surface.
 *
 * Ported 1:1 from the v2 design handoff (`shell.jsx` → `NotificationsDropdown`):
 * a compact, floating, rounded panel anchored under the topbar bell — NOT a
 * full-height slide-over. Each row is a flat read-dot / title / sub / time /
 * chevron line; the footer carries "Mark all read" + "Notification settings".
 *
 * Pure presentation. The container (`slide-over.tsx`) owns data-fetching,
 * read-state, navigation and the floating-panel chrome. Pixel values are
 * intentional — compare against the prototype before refactoring to utilities.
 */

const FOOTER_LINK: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  fontWeight: 500,
  color: '#6E5F50',
  background: 'transparent',
  border: 'none',
  padding: '4px 6px',
  cursor: 'pointer',
  textDecoration: 'none',
  fontFamily: "'DM Sans', sans-serif",
}

export interface NotificationsDropdownProps {
  items: StreamMoment[]
  /** True once the fetch settled with zero items. */
  isEmpty?: boolean
  panelRef?: React.Ref<HTMLDivElement>
  onClose: () => void
  /** Whole-row tap — navigate to the subject + mark read. */
  onRowClick: (moment: StreamMoment) => void
  onMarkAllRead: () => void
  onSettings: () => void
}

export function NotificationsDropdown({
  items,
  isEmpty,
  panelRef,
  onClose,
  onRowClick,
  onMarkAllRead,
  onSettings,
}: NotificationsDropdownProps) {
  const unread = items.filter((m) => m.unread).length

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      className="w-[420px] max-w-[calc(100vw-32px)]"
      style={{
        position: 'fixed',
        top: 60,
        right: 24,
        maxHeight: 'calc(100vh - 80px)',
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.25)',
        borderRadius: 12,
        boxShadow: 'var(--shadow-xl)',
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
        animation: 'drawer-slide-in 240ms var(--ease-out)',
        overflow: 'hidden',
        zIndex: 51,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 18px 12px',
          borderBottom: '1px solid rgba(140,123,107,0.18)',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 20,
              fontWeight: 600,
              color: '#1A1612',
              letterSpacing: '-0.015em',
            }}
          >
            Notifications
          </h2>
          <div
            style={{
              fontSize: 11,
              color: '#8C7B6B',
              marginTop: 2,
              fontStyle: 'italic',
              fontFamily: "'Playfair Display', serif",
            }}
          >
            {unread > 0
              ? `${unread} new — Horace is listening.`
              : 'Quiet. Horace will tell you when something stirs.'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            color: '#5E5246',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X style={{ width: 14, height: 14, strokeWidth: 1.75 }} />
        </button>
      </div>

      {/* Body */}
      {isEmpty ? (
        <div
          style={{
            padding: '40px 24px 44px',
            textAlign: 'center',
            fontFamily: "'Playfair Display', serif",
            fontStyle: 'italic',
            fontSize: 14,
            color: '#8C7B6B',
            lineHeight: 1.5,
          }}
        >
          Quiet. Horace will tell you when something stirs.
        </div>
      ) : (
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {items.map((moment) => (
            <button
              type="button"
              key={moment.id}
              onClick={() => onRowClick(moment)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '14px 18px',
                background: moment.unread ? 'rgba(196,98,45,0.04)' : 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(140,123,107,0.12)',
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                cursor: 'pointer',
                transition: 'background 120ms var(--ease-out)',
              }}
            >
              <div style={{ paddingTop: 3, flexShrink: 0 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: moment.unread ? '#C4622D' : 'rgba(140,123,107,0.3)',
                  }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#1A1612',
                    marginBottom: 2,
                    lineHeight: 1.35,
                  }}
                >
                  {moment.headline}
                </div>
                {moment.editorial && (
                  <div
                    style={{
                      fontSize: 12,
                      color: '#6E5F50',
                      lineHeight: 1.4,
                      marginBottom: 4,
                    }}
                  >
                    {moment.editorial}
                  </div>
                )}
                <div
                  style={{
                    fontSize: 10,
                    color: '#8C7B6B',
                    fontFamily: "'DM Mono', monospace",
                    letterSpacing: 0.2,
                  }}
                >
                  {moment.time}
                </div>
              </div>
              <div style={{ paddingTop: 4, color: '#8C7B6B', flexShrink: 0 }}>
                <ChevronRight style={{ width: 14, height: 14, strokeWidth: 1.75 }} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          padding: '10px 18px',
          borderTop: '1px solid rgba(140,123,107,0.18)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(245,240,232,0.6)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={unread === 0}
          style={{ ...FOOTER_LINK, opacity: unread === 0 ? 0.5 : 1 }}
        >
          Mark all read
        </button>
        <button type="button" onClick={onSettings} style={FOOTER_LINK}>
          <SlidersHorizontal style={{ width: 12, height: 12, strokeWidth: 1.75 }} />
          Notification settings
        </button>
      </div>
    </div>
  )
}
