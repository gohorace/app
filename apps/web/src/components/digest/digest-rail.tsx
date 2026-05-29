'use client'

import { Archive, List, Plus } from 'lucide-react'

export interface DigestList {
  name: string
  count: number
  /** Accent dot colour. Maps to intent palette. */
  accent: 'high' | 'low' | 'none'
}

export interface DigestWeekCell {
  day: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI'
  /** Count of signals on this day. Null = future / no data yet. */
  count: number | null
  isToday: boolean
}

export interface DigestRailData {
  lists: DigestList[]
  weekSoFar: DigestWeekCell[]
  weekNote: string
}

interface DigestRailProps {
  data: DigestRailData
}

const ACCENT_COLOR: Record<DigestList['accent'], string> = {
  high: '#C4622D',
  low:  '#3D5246',
  none: '#8C7B6B',
}

/**
 * Right rail of the Digest desktop layout. Two stacked cards:
 *  - **Your Lists** — quick filter destinations (Lists feature deferred;
 *    rail renders for layout fidelity, content can be canonical or stub).
 *  - **This Week So Far** — five-day strip with today highlighted, plus
 *    a quiet-day note.
 *
 * Hidden below 1024px; the main column takes the full width on smaller
 * screens (the design treats the rail as a desktop affordance).
 */
export function DigestRail({ data }: DigestRailProps) {
  return (
    <aside
      className="hidden lg:flex"
      style={{
        flexDirection: 'column',
        gap: 14,
        width: 280,
        flexShrink: 0,
        paddingTop: 4,
      }}
    >
      <YourListsCard lists={data.lists} />
      <ThisWeekSoFarCard week={data.weekSoFar} note={data.weekNote} />
      {/* v2: the Ask Horace tease moved out of the rail — the accent "Ask
        * Horace" pill now lives in the activity header (the entry to the
        * companion), so a duplicate rail card would muddy the hierarchy. */}
    </aside>
  )
}

// ── Your Lists ───────────────────────────────────────────────────────────────

function YourListsCard({ lists }: { lists: DigestList[] }) {
  return (
    <div
      style={{
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: 12,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#8C7B6B',
          marginBottom: 10,
        }}
      >
        <List style={{ width: 12, height: 12 }} aria-hidden />
        Your Lists
      </div>

      {lists.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: '#8C7B6B',
            fontStyle: 'italic',
            lineHeight: 1.5,
          }}
        >
          Lists coming soon — Horace will let you save signals into named groups.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {lists.map((l) => (
            <div
              key={l.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 4px',
                fontSize: 12,
                color: '#2E2823',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: ACCENT_COLOR[l.accent],
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>{l.name}</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: '#8C7B6B',
                }}
              >
                {l.count}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled
        title="Lists coming soon"
        style={{
          marginTop: 8,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '6px 4px',
          fontSize: 12,
          fontWeight: 500,
          color: '#C4622D',
          background: 'transparent',
          border: 'none',
          cursor: 'not-allowed',
          opacity: 0.55,
          fontFamily: 'var(--font-body)',
        }}
      >
        <Plus style={{ width: 12, height: 12 }} />
        New list
      </button>
    </div>
  )
}

// ── This Week So Far ─────────────────────────────────────────────────────────

function ThisWeekSoFarCard({
  week,
  note,
}: {
  week: DigestWeekCell[]
  note: string
}) {
  return (
    <div
      style={{
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: 12,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#8C7B6B',
          marginBottom: 12,
        }}
      >
        <Archive style={{ width: 12, height: 12 }} aria-hidden />
        This Week So Far
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 4,
          marginBottom: 12,
        }}
      >
        {week.map((cell) => {
          const isFuture = cell.count === null
          return (
            <div
              key={cell.day}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: '10px 4px',
                background: cell.isToday ? 'rgba(196,98,45,0.12)' : 'transparent',
                borderRadius: 8,
                border: cell.isToday ? '1px solid rgba(196,98,45,0.22)' : '1px solid transparent',
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  color: cell.isToday ? '#C4622D' : '#8C7B6B',
                }}
              >
                {cell.day}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 18,
                  fontWeight: 500,
                  color: cell.isToday
                    ? '#C4622D'
                    : isFuture
                      ? 'rgba(140,123,107,0.45)'
                      : '#1A1612',
                  lineHeight: 1,
                }}
              >
                {isFuture ? '·' : cell.count}
              </span>
            </div>
          )
        })}
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 11,
          color: '#8C7B6B',
          fontStyle: 'italic',
          lineHeight: 1.5,
        }}
      >
        {note}
      </p>
    </div>
  )
}
