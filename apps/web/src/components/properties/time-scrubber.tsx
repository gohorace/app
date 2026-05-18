'use client'

/**
 * HOR-217 — Today / This week / This month scrubber for the Properties Map View.
 *
 * Three connected dots on a rail. Click a dot or its label → onChange. The
 * parent (PropertiesView) controls the URL `?timeWindow=` param + the
 * `/api/properties/map-payload` refetch; this component is pure visuals +
 * click.
 *
 * Full keyboard model (arrow keys, role="radiogroup") lands in HOR-220. For
 * now buttons are real <button>s so Tab/Enter already works.
 *
 * Visuals follow the prototype (`/tmp/horace_design_mapview/app/MapView.jsx`
 * lines 359–402): cream rail with terracotta progress fill, active dot
 * filled terracotta with a parchment inner ring, captions beneath.
 */

import { useId } from 'react'
import type { TimeWindow } from '@/lib/map/rpc-types'
import { MAP_COPY } from '@/lib/copy/map-view'

const POSITIONS: readonly TimeWindow[] = ['24h', '7d', '30d'] as const

interface Props {
  value:    TimeWindow
  onChange: (next: TimeWindow) => void
  /** Subtle visual hint that a refetch is in flight (parent owns the fetch). */
  pending?: boolean
}

export function TimeScrubber({ value, onChange, pending = false }: Props) {
  const idx = POSITIONS.indexOf(value)
  const labelId = useId()

  return (
    <div
      role="radiogroup"
      aria-label="Time window"
      aria-labelledby={labelId}
      style={{
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.22)',
        borderRadius: 10,
        padding: '20px 28px 18px',
        margin: '14px 0 0',
        opacity: pending ? 0.85 : 1,
        transition: 'opacity 150ms ease-out',
      }}
    >
      <span id={labelId} style={{ position: 'absolute', left: -9999, top: -9999 }}>
        Time window for the map view
      </span>

      {/* Rail + progress fill + dots */}
      <div style={{ position: 'relative', height: 14, margin: '6px 8px 14px' }}>
        {/* Rail (background) */}
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 0,
            right: 0,
            height: 2,
            background: 'rgba(140,123,107,0.28)',
            borderRadius: 2,
          }}
        />
        {/* Progress fill from left to the active dot */}
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 0,
            width: `${(idx / 2) * 100}%`,
            height: 2,
            background: '#1A1612',
            borderRadius: 2,
            transition: 'width 220ms cubic-bezier(0.16,1,0.3,1)',
          }}
        />
        {/* Dots */}
        {POSITIONS.map((pos, i) => {
          const active = i === idx
          const left = `${(i / 2) * 100}%`
          return (
            <button
              key={pos}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={MAP_COPY.scrubber[pos].label}
              onClick={() => { if (!active) onChange(pos) }}
              style={{
                position: 'absolute',
                left,
                top: 0,
                transform: 'translateX(-50%)',
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: active ? '#C4622D' : '#FAF7F2',
                border: active
                  ? '1.5px solid #C4622D'
                  : '1.5px solid rgba(140,123,107,0.45)',
                cursor: active ? 'default' : 'pointer',
                padding: 0,
                transition: 'background 180ms ease-out, border-color 180ms ease-out',
              }}
            >
              {active && (
                <span
                  aria-hidden
                  style={{
                    display: 'block',
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: '#FAF7F2',
                    margin: '2.5px auto 0',
                  }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Labels + captions */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 0,
          textAlign: 'center',
        }}
      >
        {POSITIONS.map((pos, i) => {
          const active = i === idx
          return (
            <button
              key={pos + '-label'}
              type="button"
              onClick={() => { if (!active) onChange(pos) }}
              // Hidden from a11y tree — the radio dot above is the canonical control.
              aria-hidden
              tabIndex={-1}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: active ? 'default' : 'pointer',
                textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center',
                fontFamily: 'var(--font-body)',
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: active ? '#1A1612' : '#5E5246',
                  letterSpacing: '-0.005em',
                }}
              >
                {MAP_COPY.scrubber[pos].label}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: active ? '#8C7B6B' : 'rgba(140,123,107,0.65)',
                  letterSpacing: '0.04em',
                }}
              >
                {MAP_COPY.scrubber[pos].caption}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
