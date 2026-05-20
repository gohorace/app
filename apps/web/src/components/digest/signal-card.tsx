'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, useContext, useState } from 'react'
import { ListPlus, Phone, Sparkles, X } from 'lucide-react'
import { IntentBadge } from './intent-badge'
import { GuidanceBadge } from './guidance-badge'
import { AddToListSheet } from '@/components/lists/add-to-list-sheet'
import { useCompanion } from '@/components/companion/companion-context'
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
   * and switches the card background to a warm terracotta tint.
   *
   * v2 note: the lead-of-the-day visual treatment moved to `SignalCardHero`
   * (HOR-244). `isAnonymousNowKnown` still drives its own banner — it can
   * coexist with the hero shell when the lead signal is also a newly-known
   * contact, though that's a rare conjunction.
   */
  isAnonymousNowKnown?: boolean
}

interface SignalCardProps {
  signal: DigestSignal
  /** When true, render the hero variant — gradient bg, Sparkles eyebrow,
   *  larger avatar/typography. Drives by `SignalCardHero` only. */
  hero?: boolean
}

/**
 * One signal in the ranked roster.
 *
 * v2 (HOR-244) replaces the v1 `Add to list / More` pair with four
 * actions: `Contact` (primary — terracotta on hero, ink on the rest),
 * `Add to list` (existing AddToListSheet flow), `Dismiss` (calls the
 * companion dismiss API + animates the card out), `Ask Horace ↗` (opens
 * the companion drawer pre-prompted with "Why is {name} on my digest
 * today?").
 *
 * The whole card is still a `<Link>` to `/contacts/{id}` — the inner
 * buttons stopPropagation so clicks land on the action, not the link.
 */
export function SignalCard({ signal, hero = false }: SignalCardProps) {
  return (
    <SignalCardShell signal={signal} hero={hero}>
      <div style={{ display: 'flex', gap: hero ? 18 : 16, alignItems: 'stretch' }}>
        <SignalAvatar signal={signal} size={hero ? 56 : 44} />
        <SignalBody signal={signal} hero={hero} />
        <SignalActions signal={signal} hero={hero} />
      </div>
    </SignalCardShell>
  )
}

// ── Shell ────────────────────────────────────────────────────────────────────
// The outer `<Link>` + the anonymous-now-known banner. Reused by both the
// standard card and the hero variant.

interface SignalCardShellProps {
  signal: DigestSignal
  hero: boolean
  children: React.ReactNode
}

export function SignalCardShell({ signal, hero, children }: SignalCardShellProps) {
  const isAnon = signal.isAnonymousNowKnown ?? false
  // Dismiss collapses the card to zero height after a brief fade. State
  // lives at the shell so the animation governs the whole row, not just
  // the actions column. The fetch happens in SignalActions.
  const [dismissed, setDismissed] = useState(false)

  return (
    <div
      data-dismissed={dismissed ? 'true' : 'false'}
      style={{
        transition: 'opacity 180ms var(--ease-out), max-height 280ms var(--ease-out), margin 280ms var(--ease-out)',
        opacity: dismissed ? 0 : 1,
        maxHeight: dismissed ? 0 : 1000,
        overflow: 'hidden',
        marginBottom: dismissed ? 0 : undefined,
        pointerEvents: dismissed ? 'none' : undefined,
      }}
    >
      <DismissContext.Provider value={() => setDismissed(true)}>
        <Link
          href={`/contacts/${signal.contactId}`}
          className="signal-card"
          aria-label={`${signal.name} — open contact`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            // Hero gradient takes precedence over the warm anon tint when
            // both apply; the anon banner inside the card keeps the
            // newly-known cue visible either way.
            background: hero
              ? 'linear-gradient(180deg, rgba(196,98,45,0.06) 0%, #FAF7F2 70%)'
              : isAnon
                ? 'rgba(196,98,45,0.06)'
                : '#FAF7F2',
            border: hero
              ? '1px solid rgba(196,98,45,0.22)'
              : isAnon
                ? '1px solid rgba(196,98,45,0.22)'
                : '1px solid rgba(140,123,107,0.2)',
            borderRadius: hero ? 14 : 12,
            padding: hero
              ? '20px 24px 22px'
              : isAnon
                ? '14px 20px 18px'
                : '18px 20px',
            textDecoration: 'none',
            color: 'inherit',
            boxShadow: hero ? '0 1px 3px rgba(196,98,45,0.08)' : undefined,
            transition: 'box-shadow 180ms cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          {hero && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#A85220',
                marginBottom: 2,
              }}
            >
              <Sparkles style={{ width: 12, height: 12 }} aria-hidden color="#C4622D" />
              Lead this morning — start here
            </div>
          )}

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

          {children}
        </Link>
      </DismissContext.Provider>
    </div>
  )
}

// Context lets the actions trigger the shell's dismiss animation without
// prop-drilling. Only the shell provides; only the actions consume.
const DismissContext = createContext<(() => void) | null>(null)

// ── Avatar ───────────────────────────────────────────────────────────────────

export function SignalAvatar({
  signal,
  size = 44,
}: {
  signal: DigestSignal
  size?: number
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: INTENT_AVATAR_BG[signal.intent],
        color: '#FAF7F2',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size >= 56 ? 18 : 14,
        fontWeight: 600,
        fontFamily: 'var(--font-body)',
        flexShrink: 0,
      }}
      aria-hidden
    >
      {signal.initials}
    </div>
  )
}

// ── Body ─────────────────────────────────────────────────────────────────────

export function SignalBody({
  signal,
  hero = false,
}: {
  signal: DigestSignal
  hero?: boolean
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
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
            fontSize: hero ? 18 : 15,
            fontWeight: 600,
            color: '#1A1612',
            lineHeight: 1.25,
          }}
        >
          {signal.name}
        </span>
        <IntentBadge intent={signal.intent} label={signal.pillLabel} />
      </div>

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

      <div style={{ marginBottom: 6 }}>
        <GuidanceBadge mode={signal.guidance} />
      </div>

      <p
        className="horace-nudge"
        style={{
          margin: '0 0 12px',
          fontSize: hero ? 16 : 15,
          lineHeight: 1.55,
          color: '#2E2823',
        }}
      >
        {signal.nudge}
      </p>

      {signal.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
  )
}

// ── Actions ──────────────────────────────────────────────────────────────────

export function SignalActions({
  signal,
  hero = false,
}: {
  signal: DigestSignal
  hero?: boolean
}) {
  const router = useRouter()
  const { openCompanion } = useCompanion()
  const dismiss = useContext(DismissContext)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  function stop(e: React.MouseEvent | React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  function handleContact(e: React.MouseEvent) {
    // Same destination as the outer Link, but kept as a button so the
    // markup stays valid (Link inside Link is invalid HTML). Stops the
    // outer card's click from also navigating — single push.
    stop(e)
    router.push(`/contacts/${signal.contactId}`)
  }

  async function handleDismiss(e: React.MouseEvent) {
    stop(e)
    if (dismissing || !dismiss) return
    setDismissing(true)
    // Fire-and-forget. The UI animation runs regardless of whether the
    // backend acknowledges; we use no-cors-equivalent behaviour by not
    // awaiting the response for the visual. Failure logs only — the
    // toast surfacing is HOR-244's M3 cut (a future PR will add a real
    // soft toast in Horace's voice: "Noted. Moving on.").
    void fetch('/api/companion/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: `digest:contact:${signal.contactId}`,
        reason: 'digest-card-dismiss',
      }),
    }).catch((err) => {
      console.warn('[signal-card] dismiss POST failed:', err)
    })
    // Run the fade after a tick so React commits the dismissing state.
    window.setTimeout(() => dismiss(), 30)
  }

  function handleAskHorace(e: React.MouseEvent) {
    stop(e)
    openCompanion({
      prompt: `Why is ${signal.name} on my digest today?`,
      contextLabel: `Contact: ${signal.name}`,
    })
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        flexShrink: 0,
        alignItems: 'stretch',
        minWidth: hero ? 144 : 132,
      }}
    >
      {/* Contact — primary action. Terracotta on hero, ink elsewhere.
        * Rendered as a button (not a Link) because the whole card is
        * already wrapped in a Link to the same contact — nested anchors
        * are invalid HTML. router.push() keeps SPA navigation intact. */}
      <button
        type="button"
        onMouseDown={stop}
        onClick={handleContact}
        style={{
          ...btnPrimary,
          background: hero ? '#C4622D' : '#1A1612',
          border: 'none',
          padding: hero ? '10px 14px' : '9px 14px',
          fontSize: hero ? 13 : 12.5,
        }}
      >
        <Phone style={{ width: 14, height: 14 }} aria-hidden />
        Contact
      </button>

      <button
        type="button"
        onMouseDown={stop}
        onClick={(e) => {
          stop(e)
          setSheetOpen(true)
        }}
        style={btnSecondary}
      >
        <ListPlus style={{ width: 13, height: 13 }} aria-hidden />
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
        onMouseDown={stop}
        onClick={handleDismiss}
        disabled={dismissing}
        style={{ ...btnSecondary, color: '#8C7B6B' }}
      >
        <X style={{ width: 13, height: 13 }} aria-hidden />
        Dismiss
      </button>

      <button
        type="button"
        onMouseDown={stop}
        onClick={handleAskHorace}
        style={{
          marginTop: 4,
          padding: '5px 0',
          fontSize: 10.5,
          fontWeight: 500,
          color: '#A85220',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'center',
          fontFamily: 'var(--font-body)',
          letterSpacing: 0.2,
        }}
      >
        Ask Horace ↗
      </button>
    </div>
  )
}

// ── Shared button styles ─────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  padding: '9px 14px',
  fontSize: 12.5,
  fontWeight: 500,
  color: '#FAF7F2',
  background: '#1A1612',
  border: '1px solid #1A1612',
  borderRadius: 7,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  transition: 'background 180ms var(--ease-out)',
}

const btnSecondary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '7px 14px',
  fontSize: 12,
  fontWeight: 500,
  color: '#5E5246',
  background: '#FAF7F2',
  border: '1px solid rgba(140,123,107,0.3)',
  borderRadius: 7,
  cursor: 'pointer',
  fontFamily: 'var(--font-body)',
  transition: 'background 180ms',
}
