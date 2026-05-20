'use client'

import { X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * SelectionBar — the v2 charcoal action bar that appears when one or more
 * rows are checked in a data grid (HOR-246). Reused across Contacts (M5)
 * and Properties (M6) per the v2 brief's "build once, use in all four"
 * shared-surface rule.
 *
 * Renders inline above the table (not a fixed-bottom pill — that was the
 * v1 treatment). Charcoal background, count chip, an italic "What's next?"
 * nudge, the action buttons, and a clear-X. Slides in via the shared
 * `drawer-slide-in` keyframe.
 *
 * Actions are passed in by the host so the same bar serves different
 * surfaces — Contacts uses Message / Add to list / Copy links / Archive /
 * More; Properties will pass its own set.
 */

export interface SelectionAction {
  label: string
  icon: LucideIcon
  onClick: () => void
  /** Disables the button + dims it. Used while an action is in flight. */
  disabled?: boolean
}

interface SelectionBarProps {
  count: number
  actions: SelectionAction[]
  onClear: () => void
  /** Override the default italic nudge copy. */
  nudge?: string
}

export function SelectionBar({ count, actions, onClear, nudge = "What's next?" }: SelectionBarProps) {
  return (
    <div
      role="toolbar"
      aria-label={`${count} selected — bulk actions`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        background: '#1A1612',
        color: '#F5F0E8',
        borderRadius: 10,
        marginBottom: 18,
        animation: 'drawer-slide-in 200ms var(--ease-out)',
        boxShadow: 'var(--shadow-md)',
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          background: 'rgba(196,98,45,0.25)',
          color: '#FAF7F2',
          padding: '3px 9px',
          borderRadius: 999,
        }}
      >
        {count} selected
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 80,
          fontSize: 11.5,
          color: 'rgba(245,240,232,0.55)',
          fontStyle: 'italic',
          fontFamily: 'var(--font-display)',
        }}
      >
        {nudge}
      </span>
      {actions.map((a) => {
        const Icon = a.icon
        return (
          <button
            key={a.label}
            type="button"
            className="row-action-btn"
            onClick={a.onClick}
            disabled={a.disabled}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 500,
              background: 'rgba(245,240,232,0.08)',
              border: '1px solid rgba(245,240,232,0.18)',
              color: '#F5F0E8',
              borderRadius: 7,
              cursor: a.disabled ? 'not-allowed' : 'pointer',
              opacity: a.disabled ? 0.5 : 1,
              fontFamily: 'var(--font-body)',
              transition: 'background 120ms',
            }}
          >
            <Icon size={12} aria-hidden /> {a.label}
          </button>
        )
      })}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          background: 'transparent',
          border: 'none',
          color: 'rgba(245,240,232,0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
