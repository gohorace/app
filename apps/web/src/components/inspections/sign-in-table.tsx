import Link from 'next/link'
import type { SignInRow, SignInState } from '@/lib/inspections/aggregates'

/**
 * SignInTable — the captured sign-ins on a past inspection's detail page
 * (HOR-249). Each row: contact name (links to the contact), when they
 * signed in, and a state pill (still-active / pipeline / cold).
 */

const STATE_PILL: Record<SignInState, { label: string; bg: string; color: string }> = {
  'pipeline':     { label: 'In pipeline', bg: 'rgba(196,98,45,0.12)', color: '#A85220' },
  'still-active': { label: 'Still active', bg: 'rgba(181,146,42,0.16)', color: '#7A6112' },
  'cold':         { label: 'Went quiet', bg: 'rgba(140,123,107,0.14)', color: '#5E5246' },
}

function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export function SignInTable({ rows }: { rows: SignInRow[] }) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: '24px 18px',
          background: '#FAF7F2',
          border: '1px dashed rgba(140,123,107,0.3)',
          borderRadius: 10,
          textAlign: 'center',
          fontSize: 13,
          color: '#8C7B6B',
        }}
      >
        No one signed in at this inspection.
      </div>
    )
  }
  return (
    <div
      style={{
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {rows.map((r, idx) => {
        const pill = STATE_PILL[r.state]
        return (
          <Link
            key={r.contactId}
            href={`/contacts/${r.contactId}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              borderTop: idx === 0 ? 'none' : '1px solid rgba(140,123,107,0.12)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: '#1A1612' }}>
              {r.name}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8C7B6B' }}>
              {relativeWhen(r.capturedAt)}
            </span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: 0.2,
                padding: '3px 9px',
                borderRadius: 999,
                background: pill.bg,
                color: pill.color,
                whiteSpace: 'nowrap',
              }}
            >
              {pill.label}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
