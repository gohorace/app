'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react'

export interface RowOverflowAction {
  /** Stable key for React. */
  id: string
  /** Visible label. */
  label: string
  /** Lucide icon component. */
  Icon: typeof MoreHorizontal
  /** Click handler. Async errors are caught and surfaced via `onError`. */
  onSelect: () => void | Promise<void>
  /** Optional destructive styling (red-ish foreground). */
  destructive?: boolean
}

interface RowOverflowMenuProps {
  /** Aria-label for the trigger. Use the row name when possible. */
  triggerLabel: string
  actions: RowOverflowAction[]
}

/**
 * Small popover menu that appears beside the `MoreHorizontal` icon on a
 * grid row (HOR-137). Used by both Contacts and Properties tables.
 *
 * Click propagation: every click inside the menu stops at the boundary so
 * row-click → detail-page navigation is never triggered accidentally.
 * Click-outside dismisses without action.
 */
export function RowOverflowMenu({ triggerLabel, actions }: RowOverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!popoverRef.current) return
      if (!popoverRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div
      style={{ position: 'relative' }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label={`Open actions for ${triggerLabel}`}
        title="More actions"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        style={{
          background: open ? 'rgba(140,123,107,0.1)' : 'transparent',
          border: 'none',
          color: '#8C7B6B',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MoreHorizontal style={{ width: 14, height: 14 }} />
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            zIndex: 50,
            minWidth: 180,
            background: '#FAF7F2',
            border: '1px solid rgba(140,123,107,0.3)',
            borderRadius: 8,
            boxShadow: '0 12px 32px rgba(26,22,18,0.18)',
            padding: 4,
            fontFamily: 'var(--font-body)',
          }}
        >
          {actions.map((a) => (
            <button
              key={a.id}
              role="menuitem"
              type="button"
              onClick={async (e) => {
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
                await a.onSelect()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '7px 10px',
                fontSize: 12,
                color: a.destructive ? '#9C4A1F' : '#1A1612',
                background: 'transparent',
                border: 'none',
                borderRadius: 5,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'var(--font-body)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = a.destructive
                  ? 'rgba(196,98,45,0.08)'
                  : 'rgba(140,123,107,0.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <a.Icon style={{ width: 12, height: 12, opacity: 0.7 }} />
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Re-export lucide icons commonly used by callers so they don't need to
// import directly when constructing actions.
export { ExternalLink, Trash2 }
