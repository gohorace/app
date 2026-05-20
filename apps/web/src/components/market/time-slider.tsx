'use client'

import { useId, useRef } from 'react'
import type { TimeWindow } from '@/lib/map/rpc-types'

/**
 * TimeSlider — the v2 `/market` time control. Replaces the HOR-217
 * scrubber (kept its keyboard model from HOR-220 — radiogroup ARIA,
 * arrow keys step between stops, Home / End jump to the ends).
 *
 * Visual: thin parchment rail with a terracotta fill that animates to
 * the active stop's position; three stop dots with `Today / This week /
 * This month` labels and DM Mono sub-captions.
 *
 * URL: the parent owns `?timeWindow=` (or another mechanism); this
 * component is presentational + accessible.
 */

interface TimeSliderProps {
  value: TimeWindow
  onChange: (next: TimeWindow) => void
}

interface Stop {
  id: TimeWindow
  label: string
  sub: string
}

const STOPS: Stop[] = [
  { id: '24h', label: 'Today',      sub: 'Last 24 hours' },
  { id: '7d',  label: 'This week',  sub: 'Last 7 days'   },
  { id: '30d', label: 'This month', sub: 'Last 30 days'  },
]

export function TimeSlider({ value, onChange }: TimeSliderProps) {
  const groupId = useId()
  const dotRefs = useRef<Array<HTMLButtonElement | null>>([])
  const idx = STOPS.findIndex((s) => s.id === value)
  const safeIdx = idx === -1 ? 1 : idx // default to "This week" when unknown
  const pct = (safeIdx / (STOPS.length - 1)) * 100

  function focusAt(nextIdx: number) {
    const clamped = Math.max(0, Math.min(STOPS.length - 1, nextIdx))
    onChange(STOPS[clamped].id)
    // Move keyboard focus to the newly-active dot so the next keypress
    // continues to land here. Matches the WAI-ARIA radiogroup pattern.
    window.requestAnimationFrame(() => {
      dotRefs.current[clamped]?.focus()
    })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault()
        focusAt(safeIdx - 1)
        break
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault()
        focusAt(safeIdx + 1)
        break
      case 'Home':
        e.preventDefault()
        focusAt(0)
        break
      case 'End':
        e.preventDefault()
        focusAt(STOPS.length - 1)
        break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={`${groupId}-label`}
      onKeyDown={onKeyDown}
      style={{ position: 'relative', padding: '0 6px' }}
    >
      <span id={`${groupId}-label`} className="sr-only">
        Time window — Today, this week, this month
      </span>
      {/* Rail */}
      <div
        aria-hidden
        style={{
          position: 'relative',
          height: 4,
          background: 'rgba(140,123,107,0.2)',
          borderRadius: 999,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: '#C4622D',
            borderRadius: 999,
            transition: 'width 220ms var(--ease-out)',
          }}
        />
      </div>

      {/* Stops */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: -7,
          position: 'relative',
        }}
      >
        {STOPS.map((s, i) => {
          const sel = s.id === value
          return (
            <button
              key={s.id}
              ref={(el) => {
                dotRefs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={sel}
              aria-label={`${s.label} — ${s.sub}`}
              tabIndex={sel ? 0 : -1}
              onClick={() => onChange(s.id)}
              className="focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C4622D] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-parchment)]"
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems:
                  i === 0
                    ? 'flex-start'
                    : i === STOPS.length - 1
                      ? 'flex-end'
                      : 'center',
                borderRadius: 8,
                // Padding gives the stop a ≥24px hit area per HOR-220's
                // WCAG 2.5.5 line. Visible dot stays 14px.
                paddingTop: 0,
                paddingBottom: 6,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: sel ? '#C4622D' : '#FAF7F2',
                  border: sel
                    ? '3px solid var(--color-parchment, #F5F0E8)'
                    : '2px solid rgba(140,123,107,0.4)',
                  boxShadow: sel ? '0 0 0 2px #C4622D' : 'none',
                  marginBottom: 8,
                  transition: 'background 180ms var(--ease-out), box-shadow 180ms var(--ease-out)',
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: sel ? '#1A1612' : '#6E5F50',
                }}
              >
                {s.label}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: '#8C7B6B',
                  marginTop: 2,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {s.sub}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
