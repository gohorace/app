'use client'

import Link from 'next/link'
import { ListPlus, MoreHorizontal } from 'lucide-react'
import { IntentBadge } from './intent-badge'
import { INTENT_AVATAR_BG, type IntentLevel } from '@/lib/design/intent'

export interface DigestSignal {
  contactId: string
  name: string
  initials: string
  /** Suburb or area string — e.g. "Paddington, NSW". Optional (older contacts may not have one) */
  suburb: string | null
  /** Short time-ago string. Pre-computed server-side ("2h ago", "Yesterday"…) */
  timing: string
  intent: IntentLevel
  /** The Horace-voiced "why now" line. Italic in the card. */
  nudge: string
  /** Tag chips — event-type labels, session counts, etc. */
  tags: string[]
}

interface SignalCardProps {
  signal: DigestSignal
}

/**
 * One signal in the ranked roster. Whole card is a link to /contacts/{id}.
 * Inner action buttons stopPropagation so the card click is the canonical
 * action ("open the contact") and the buttons are secondary.
 *
 * `Add to list` is deferred — disabled in V1 with a tooltip.
 * `More` overflow is rendered but inert in V1 (placeholder for snooze /
 * dismiss / not useful, all deferred).
 */
export function SignalCard({ signal }: SignalCardProps) {
  return (
    <Link
      href={`/contacts/${signal.contactId}`}
      className="signal-card"
      style={{
        display: 'block',
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: 10,
        padding: '16px 18px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'box-shadow 180ms cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      {/* Head: avatar + name/suburb + intent */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: INTENT_AVATAR_BG[signal.intent],
            color: '#FAF7F2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'var(--font-body)',
            flexShrink: 0,
          }}
          aria-hidden
        >
          {signal.initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#1A1612',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {signal.name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: '#8C7B6B',
              marginTop: 2,
              lineHeight: 1.4,
            }}
          >
            {signal.suburb ? <>{signal.suburb} · </> : null}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{signal.timing}</span>
          </div>
        </div>
        <IntentBadge intent={signal.intent} />
      </div>

      {/* Nudge — italic, Horace voice */}
      {signal.nudge && (
        <p
          className="horace-nudge"
          style={{
            margin: '12px 0 0',
            fontSize: 14,
            lineHeight: 1.55,
            color: '#2E2823',
          }}
        >
          {signal.nudge}
        </p>
      )}

      {/* Tag chips */}
      {signal.tags.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 12,
          }}
        >
          {signal.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                color: '#5E5246',
                background: 'rgba(140,123,107,0.12)',
                padding: '2px 8px',
                borderRadius: 4,
                fontFamily: 'var(--font-body)',
                whiteSpace: 'nowrap',
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Actions — primary "Add to list" (disabled, lists deferred) + overflow */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 14,
        }}
      >
        <button
          type="button"
          disabled
          aria-disabled
          title="Lists coming soon"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 500,
            color: 'rgba(94,82,70,0.55)',
            background: 'rgba(140,123,107,0.08)',
            border: '1px solid rgba(140,123,107,0.18)',
            borderRadius: 6,
            cursor: 'not-allowed',
            fontFamily: 'var(--font-body)',
          }}
        >
          <ListPlus style={{ width: 12, height: 12 }} />
          Add to list
        </button>
        <button
          type="button"
          title="More — coming soon"
          aria-label="More actions (coming soon)"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            color: '#8C7B6B',
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: 6,
            cursor: 'default',
          }}
        >
          <MoreHorizontal style={{ width: 14, height: 14 }} />
        </button>
      </div>
    </Link>
  )
}
