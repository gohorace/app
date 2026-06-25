'use client'

/**
 * Stream V2 feed card — signal-first. Identity (name/avatar/address/role/known
 * pill) lives one tap deeper on the contact detail; the stream triages signals,
 * not people. The read is the hero — promoted to headline weight, leading with
 * the deviation. Three exits: card body → contact detail (onOpen), Ask Horace
 * → companion (onAsk), action row → channel actions (Email / Phone / SMS·soon).
 *
 * Anatomy (top → bottom): tier badge + recency + Ask Horace (+ Clear) ·
 * read-as-headline · action row. Nothing else.
 */

import { Feather, Mail, Phone, MessageSquare } from 'lucide-react'

const INK = '#1A1612'
const STONE = '#8C7B6B'
const SUBTLE = 'rgba(140,123,107,0.16)'
const LIVE_DOT = '#3DA361'
const LIVE_TEXT = '#2F8F54'

export type StreamTier = 'act' | 'heating' | 'cooling' | 'steady' | 'quiet'

interface TierShade {
  label: string
  dot: string
  accent: string
  cardBg: string
  cardBorder: string
  badgeBg: string
}

/**
 * Canonical per-tier shading. Mirrors the `--stream-shade-*` custom properties
 * in globals.css (keep the two in sync). Values from the handoff Tier table.
 */
export const STREAM_TIERS: Record<StreamTier, TierShade> = {
  act: {
    label: 'Act now',
    dot: '#C4622D',
    accent: '#C4622D',
    cardBg: 'linear-gradient(165deg, #F3E1D2 0%, #F5EADE 52%, #F7F0E8 100%)',
    cardBorder: 'rgba(196,98,45,0.22)',
    badgeBg: 'rgba(255,255,255,0.5)',
  },
  heating: {
    label: 'Heating up',
    dot: '#E8956D',
    accent: '#C4622D',
    cardBg: 'linear-gradient(165deg, #F5E8DD 0%, #F7EFE6 60%, #F8F2EB 100%)',
    cardBorder: 'rgba(232,149,109,0.24)',
    badgeBg: 'rgba(255,255,255,0.5)',
  },
  cooling: {
    label: 'Cooling down',
    dot: '#9C6B5A',
    accent: '#9C6B5A',
    cardBg: 'linear-gradient(165deg, #EEE6DE 0%, #F3EEE7 62%, #F6F2EC 100%)',
    cardBorder: 'rgba(156,107,90,0.2)',
    badgeBg: 'rgba(255,255,255,0.45)',
  },
  steady: {
    label: 'Steady',
    dot: '#3D5246',
    accent: '#3D5246',
    cardBg: 'linear-gradient(165deg, #ECEFE9 0%, #F4F1EA 66%, #F7F3EC 100%)',
    cardBorder: 'rgba(61,82,70,0.16)',
    badgeBg: 'rgba(255,255,255,0.45)',
  },
  quiet: {
    label: 'Quiet',
    dot: STONE,
    accent: STONE,
    cardBg: '#FAF7F2',
    cardBorder: 'rgba(140,123,107,0.2)',
    badgeBg: 'rgba(140,123,107,0.1)',
  },
}

export interface StreamCardData {
  contactId: string
  /** Display name. Used for the accessible label on the clickable card body —
   *  not rendered visually (identity lives on the contact detail). */
  name: string
  /** Carried for backward compat; the signal-first card doesn't render these. */
  initials: string | null
  identityLabel: string
  isUnknown: boolean
  tier: StreamTier
  /** The behavioural one-liner — the lead. Rendered at headline weight. */
  observation: string
  /** Carried for backward compat; not rendered on the signal-first card. */
  place: string | null
  /** Pre-computed recency string for the header timestamp. */
  when: string
  /** Carried for backward compat; not rendered (role lens lives in the read). */
  role?: 'seller' | 'buyer' | 'landlord'
  property?: string | null
  /** `tel:` target; Phone CTA is disabled when absent. */
  phone?: string | null
}

interface StreamCardMiniProps {
  data: StreamCardData
  /** Opens the read-context Companion for this card. */
  onAsk?: (data: StreamCardData) => void
  /** Opens the contact record — the card's primary affordance. Omitted (e.g.
   *  demo cards) → the card isn't clickable. */
  onOpen?: () => void
  /** Opens the tracked-email composer dock for this card. Omitted → Email
   *  button is inert (e.g. demo cards). */
  onEmail?: (data: StreamCardData) => void
  /** Per-card Clear (Stream "Clear" handoff) — the dismiss-until-deviation
   *  affordance. Subordinate to the contact actions, top-right header.
   *  Omitted → no Clear control (demo cards, cleared-state echoes). */
  onClear?: (data: StreamCardData) => void
}

// ── Timestamp — ≤24h by the hour, live green + pulsing; older grey ────────────
function TimeStamp({ when }: { when: string }) {
  const fresh = /^\s*\d+\s*[hm]\b/i.test(when) || /just now/i.test(when)
  if (fresh) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, whiteSpace: 'nowrap' }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: LIVE_DOT,
            animation: 'streamLive 1.8s ease-out infinite',
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 500, color: LIVE_TEXT, fontFamily: 'var(--font-mono)' }}>{when}</span>
      </span>
    )
  }
  return <span style={{ fontSize: 12, color: STONE, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{when}</span>
}

function TierBadge({ shade }: { shade: TierShade }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 13px 6px 12px',
        borderRadius: 9999,
        background: shade.badgeBg,
        fontFamily: 'var(--font-body)',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: shade.dot, flexShrink: 0 }} />
      <span style={{ fontSize: 13.5, fontWeight: 600, color: shade.accent, letterSpacing: '0.005em' }}>{shade.label}</span>
    </span>
  )
}

function CTARow({ phone, onEmail }: { phone?: string | null; onEmail?: () => void }) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 13px',
    borderRadius: 9,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: 'var(--font-body)',
  }
  return (
    // stopPropagation so the action buttons never trigger the card's
    // open-contact navigation.
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}
    >
      <button
        type="button"
        onClick={onEmail}
        disabled={!onEmail}
        style={{
          ...base,
          fontWeight: 600,
          border: 'none',
          background: '#C4622D',
          color: '#FBF4EE',
          cursor: onEmail ? 'pointer' : 'not-allowed',
          opacity: onEmail ? 1 : 0.5,
          boxShadow: '0 2px 8px rgba(196,98,45,0.24)',
        }}
      >
        <Mail style={{ width: 14, height: 14 }} aria-hidden /> Email
      </button>

      {phone ? (
        <a href={`tel:${phone}`} style={{ ...base, border: `1px solid ${SUBTLE}`, color: INK, textDecoration: 'none', cursor: 'pointer' }}>
          <Phone style={{ width: 14, height: 14, color: STONE }} aria-hidden /> Phone
        </a>
      ) : (
        <button type="button" disabled style={{ ...base, border: `1px solid ${SUBTLE}`, color: 'rgba(140,123,107,0.7)', background: 'transparent', cursor: 'not-allowed' }}>
          <Phone style={{ width: 14, height: 14, color: 'rgba(140,123,107,0.7)' }} aria-hidden /> Phone
        </button>
      )}

      <span style={{ ...base, border: `1px dashed ${SUBTLE}`, color: 'rgba(140,123,107,0.85)', cursor: 'not-allowed' }}>
        <MessageSquare style={{ width: 14, height: 14, color: 'rgba(140,123,107,0.7)' }} aria-hidden /> SMS
        <span
          style={{
            padding: '1px 7px',
            borderRadius: 9999,
            background: 'rgba(140,123,107,0.16)',
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: '0.05em',
            color: STONE,
            textTransform: 'uppercase',
          }}
        >
          Soon
        </span>
      </span>
    </div>
  )
}

export function StreamCardMini({ data, onAsk, onOpen, onEmail, onClear }: StreamCardMiniProps) {
  const shade = STREAM_TIERS[data.tier]
  const clickable = Boolean(onOpen)
  return (
    <div
      onClick={onOpen}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen?.()
              }
            }
          : undefined
      }
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      // Identity is stripped from the visual card; keep the accessible name so
      // screen readers still announce who the signal is about.
      aria-label={clickable ? `Open ${data.name}` : undefined}
      style={{
        background: shade.cardBg,
        border: `1px solid ${shade.cardBorder}`,
        borderRadius: 14,
        padding: '18px 22px 20px',
        boxShadow: '0 1px 3px rgba(26,22,18,0.05)',
        fontFamily: 'var(--font-body)',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      {/* Header: [tier badge + recency] · [Ask Horace + Clear] */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <TierBadge shade={shade} />
          <TimeStamp when={data.when} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAsk?.(data)
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 9999,
              background: 'transparent',
              border: `1px solid ${SUBTLE}`,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              color: INK,
            }}
          >
            <Feather style={{ width: 13, height: 13, color: STONE }} aria-hidden /> Ask Horace
          </button>
          {/* Clear — subordinate to Email/Phone/SMS and to Ask Horace.
            * Plain text, no border, no chrome. "I've dealt with this," not
            * a primary outreach. Hidden when no handler is wired (demo). */}
          {onClear && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onClear(data)
              }}
              aria-label={`Clear ${data.name} from the stream`}
              title="Clear — Horace stops surfacing this contact until something stirs again"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '6px 6px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                fontSize: 12.5,
                color: STONE,
                letterSpacing: '0.005em',
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* The read — promoted to headline weight, leads the card. */}
      <p
        style={{
          margin: '16px 0 0',
          fontSize: 18.5,
          fontWeight: 600,
          lineHeight: 1.32,
          color: INK,
          textWrap: 'pretty',
          letterSpacing: '-0.005em',
        }}
      >
        {data.observation}
      </p>

      <CTARow phone={data.phone} onEmail={onEmail ? () => onEmail(data) : undefined} />
    </div>
  )
}
