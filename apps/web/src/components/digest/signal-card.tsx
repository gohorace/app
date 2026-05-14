'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ListPlus, MoreHorizontal, Sparkles } from 'lucide-react'
import { IntentBadge } from './intent-badge'
import { GuidanceBadge } from './guidance-badge'
import { AddToListSheet } from '@/components/lists/add-to-list-sheet'
import { INTENT_AVATAR_BG, type IntentLevel, type GuidanceMode } from '@/lib/design/intent'

export interface DigestSignal {
  contactId: string
  name: string
  initials: string
  /** Suburb or area string — e.g. "Paddington, NSW". Optional. */
  suburb: string | null
  /** Pre-computed time-ago string ("Active 2h ago", "Yesterday"…). */
  timing: string
  intent: IntentLevel
  /** Horace voice mode for the nudge — drives the badge above it. */
  guidance: GuidanceMode
  /** Italic "why now" line. */
  nudge: string
  /** Tag chips — event-type labels, session counts, etc. */
  tags: string[]
  /**
   * When set, replaces the default intent label on the pill (e.g.
   * "Newly known" on the anonymous-becomes-known variant).
   */
  pillLabel?: string
  /**
   * Renders the "ANONYMOUS, NOW KNOWN — …" banner inside the card boundary
   * and switches the card background to a warm terracotta tint. Marks the
   * card as the lead signal of the digest.
   */
  isAnonymousNowKnown?: boolean
}

interface SignalCardProps {
  signal: DigestSignal
}

/**
 * One signal in the ranked roster. Three-column row on desktop:
 *   [ avatar ] [ name + meta + guidance + nudge + tags ] [ actions stack ]
 * The whole card links to /contacts/{id}; inner action buttons stopPropagation.
 *
 * `Add to list` is the primary action (disabled in V1 — Lists feature deferred).
 * `More` is the overflow (snooze / dismiss / not useful — all deferred).
 */
export function SignalCard({ signal }: SignalCardProps) {
  const isAnon = signal.isAnonymousNowKnown ?? false
  // HOR-142: Add-to-list sheet is rendered above the link via a fixed-
  // position scrim; state lives here so the trigger button can open it
  // without touching the parent's link navigation.
  const [sheetOpen, setSheetOpen] = useState(false)
  return (
    <Link
      href={`/contacts/${signal.contactId}`}
      className="signal-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        background: isAnon ? 'rgba(196,98,45,0.06)' : '#FAF7F2',
        border: isAnon
          ? '1px solid rgba(196,98,45,0.22)'
          : '1px solid rgba(140,123,107,0.2)',
        borderRadius: 12,
        padding: isAnon ? '14px 20px 18px' : '18px 20px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'box-shadow 180ms cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      {/* "Anonymous, now known" banner — only on the lead anon card */}
      {isAnon && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#C4622D',
            paddingBottom: 12,
            borderBottom: '1px solid rgba(196,98,45,0.18)',
            marginBottom: 2,
          }}
        >
          <Sparkles style={{ width: 12, height: 12 }} aria-hidden />
          Anonymous, now known — Horace had been watching this one for two weeks.
        </div>
      )}

      {/* Inner row: avatar + content + actions */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
      {/* Avatar */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: INTENT_AVATAR_BG[signal.intent],
          color: '#FAF7F2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: 'var(--font-body)',
          flexShrink: 0,
        }}
        aria-hidden
      >
        {signal.initials}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: '#1A1612',
              lineHeight: 1.25,
            }}
          >
            {signal.name}
          </span>
          <IntentBadge intent={signal.intent} label={signal.pillLabel} />
        </div>

        {/* Meta */}
        <div
          style={{
            fontSize: 12,
            color: '#8C7B6B',
            lineHeight: 1.4,
            marginBottom: 10,
          }}
        >
          {signal.suburb ? <>{signal.suburb} · </> : null}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{signal.timing}</span>
        </div>

        {/* Guidance mode label */}
        <div style={{ marginBottom: 6 }}>
          <GuidanceBadge mode={signal.guidance} />
        </div>

        {/* Italic nudge — Horace voice */}
        <p
          className="horace-nudge"
          style={{
            margin: '0 0 12px',
            fontSize: 15,
            lineHeight: 1.55,
            color: '#2E2823',
          }}
        >
          {signal.nudge}
        </p>

        {/* Tag chips */}
        {signal.tags.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
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
      </div>

      {/* Actions stack (right) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0,
          alignItems: 'stretch',
          minWidth: 132,
        }}
      >
        <button
          type="button"
          onMouseDown={(e) => {
            // Outer Link uses onClick to navigate; preventing default on
            // mousedown stops the focus + navigation race when the sheet
            // opens. onClick still does the work.
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setSheetOpen(true)
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 500,
            color: '#FAF7F2',
            background: '#1A1612',
            border: '1px solid #1A1612',
            borderRadius: 7,
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
            transition: 'opacity 180ms',
          }}
        >
          <ListPlus style={{ width: 14, height: 14 }} />
          Add to list
        </button>
        <AddToListSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          contactId={signal.contactId}
          subjectLabel={signal.name}
        />
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
            gap: 6,
            padding: '8px 14px',
            fontSize: 12,
            fontWeight: 500,
            color: '#5E5246',
            background: 'transparent',
            border: '1px solid rgba(140,123,107,0.3)',
            borderRadius: 7,
            cursor: 'default',
            fontFamily: 'var(--font-body)',
          }}
        >
          <MoreHorizontal style={{ width: 13, height: 13 }} />
          More
        </button>
      </div>
      </div>
    </Link>
  )
}
