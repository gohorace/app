'use client'

import { useRef } from 'react'
import type { TimeWindow } from '@/lib/map/rpc-types'
import styles from './market-map.module.css'

/**
 * TimeSlider — the `/market` time scrubber (HOR-370 hero re-skin).
 *
 * Renders the design's scrubber *contents* (track with rail + progress +
 * three dots, and a labels row); `MarketView` wraps this in the
 * bottom-center glass pill (`styles.timeScrubber`). Keeps the HOR-220
 * keyboard model — radiogroup ARIA on the dots, arrow keys step between
 * stops, Home / End jump to the ends.
 *
 * Label ↔ window map (design → payload): Today→24h, This week→7d,
 * This month→30d. Default = This week.
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
    <div role="radiogroup" aria-label="Time window" onKeyDown={onKeyDown}>
      {/* Track — rail + ink progress + three dots (the radios) */}
      <div className={styles.track}>
        <div className={styles.rail} aria-hidden />
        <div className={styles.progress} style={{ width: `${pct}%` }} aria-hidden />
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
              className={`${styles.dot} ${sel ? styles.dotActive : ''}`}
              style={{ left: `${(i / (STOPS.length - 1)) * 100}%` }}
            >
              <span className={styles.dotInner} aria-hidden />
            </button>
          )
        })}
      </div>

      {/* Labels — visual affordance; the dots above are the accessible radios */}
      <div className={styles.labels}>
        {STOPS.map((s) => {
          const sel = s.id === value
          return (
            <button
              key={s.id}
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => onChange(s.id)}
              className={`${styles.label} ${sel ? styles.labelActive : ''}`}
            >
              <span className={styles.labelMain}>{s.label}</span>
              <span className={styles.labelCaption}>{s.sub}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
