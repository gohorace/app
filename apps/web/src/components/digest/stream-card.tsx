'use client'

/**
 * Stream V2 feed card (HOR-363) — the tier-shaded `StreamCardMini` that
 * replaces the Phase 0–2 `SignalCard`. Per the Stream Card design handoff
 * (`design_handoff_stream_card`), every card is warm-shaded by its intent
 * tier: a background gradient + border + accent that cools down the feed —
 * hot glows and pulls the eye, quiet desaturates to flat cream.
 *
 * Anatomy (top → bottom): tier badge + identity + Ask Horace · avatar + name +
 * property/recency line · behavioural observation · Email / Phone / SMS CTAs.
 *
 * Scope of this slice (HOR-363): the card shell + tier shading + the
 * `place · time` fallback subtitle. Deferred to siblings:
 *   - role chip + property address + recency-coded timestamp → HOR-364
 *   - cooling-down tier assignment                          → HOR-365
 *   - Email→dock / card-click→contact wiring                → HOR-366
 *   - retiring the old SignalCard chrome                    → HOR-367
 */

import { User, Feather, Mail, Phone, MessageSquare } from 'lucide-react'
import { RoleBadge } from '@/lib/design/badges'

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
  /** Display name. Never wraps. */
  name: string
  /** Initials for the known avatar; ignored when `isUnknown`. */
  initials: string | null
  /** Identity-state label shown in the header ("Known" / "Unknown" / …). */
  identityLabel: string
  /** Drives the avatar glyph + suppresses initials. */
  isUnknown: boolean
  tier: StreamTier
  /** The behavioural one-liner (the full authored read lives on contact detail). */
  observation: string
  /** Suburb / area for the fallback subtitle. */
  place: string | null
  /** Pre-computed recency string for the subtitle timestamp. */
  when: string
  /** Durable role tying this contact to a property — renders the role chip +
   *  address subtitle. Falls back to `place · when` when absent. */
  role?: 'seller' | 'buyer' | 'landlord'
  /** Short property address shown beside the role chip. */
  property?: string | null
  /** `tel:` target; Phone CTA is disabled when absent. */
  phone?: string | null
}

interface StreamCardMiniProps {
  data: StreamCardData
  /** Opens the read-context Companion for this card (HOR-366 wires the rest). */
  onAsk?: (data: StreamCardData) => void
}

// ── Timestamp — ≤24h by the hour, live green + pulsing; older grey ────────────
// `fresh` mirrors the handoff heuristic: a leading minute/hour token or "just
// now" reads as live. HOR-364 makes the upstream `when` values conform.
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
            // Green expanding-ring pulse; respects prefers-reduced-motion via
            // the keyframe being a no-op there is handled at the media level —
            // here we simply attach it.
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

function CTARow({ phone }: { phone?: string | null }) {
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
      {/* Email is the primary action — wiring to the composer dock is HOR-366. */}
      <button
        type="button"
        style={{
          ...base,
          fontWeight: 600,
          border: 'none',
          background: '#C4622D',
          color: '#FBF4EE',
          cursor: 'pointer',
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

export function StreamCardMini({ data, onAsk }: StreamCardMiniProps) {
  const shade = STREAM_TIERS[data.tier]
  return (
    <div
      style={{
        background: shade.cardBg,
        border: `1px solid ${shade.cardBorder}`,
        borderRadius: 14,
        padding: '18px 22px 20px',
        boxShadow: '0 1px 3px rgba(26,22,18,0.05)',
        fontFamily: 'var(--font-body)',
      }}
    >
      {/* Header: tier badge · identity · Ask Horace */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <TierBadge shade={shade} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: '#5E5246' }}>
            <User style={{ width: 14, height: 14, color: STONE }} aria-hidden /> {data.identityLabel}
          </span>
          <button
            type="button"
            onClick={() => onAsk?.(data)}
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
        </div>
      </div>

      {/* Identity row: avatar + name + property/recency line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 15 }}>
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: data.isUnknown ? 'rgba(140,123,107,0.16)' : shade.dot,
            color: '#FBF4EE',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {data.isUnknown ? <User style={{ width: 20, height: 20, color: STONE }} aria-hidden /> : data.initials}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 16.5,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.15,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {data.name}
          </div>
          {/* Property-association line: role chip + address when the contact
            * has a durable role on a property; otherwise the place·time
            * fallback (e.g. an Unknown visitor). Address truncates before it
            * pushes the right-aligned timestamp. */}
          {data.role && data.property ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, minWidth: 0 }}>
              <RoleBadge role={data.role} />
              <span style={{ fontSize: 13, color: STONE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                {data.property}
              </span>
              <span style={{ marginLeft: 'auto', paddingLeft: 8, flexShrink: 0 }}>
                <TimeStamp when={data.when} />
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 3, minWidth: 0 }}>
              {data.place && (
                <span style={{ fontSize: 13, color: STONE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                  {data.place}
                </span>
              )}
              <span style={{ marginLeft: data.place ? 'auto' : 0, paddingLeft: 8, flexShrink: 0 }}>
                <TimeStamp when={data.when} />
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Observation */}
      <p style={{ margin: '14px 0 0', fontSize: 14.5, lineHeight: 1.5, color: '#2E2823', textWrap: 'pretty' }}>
        {data.observation}
      </p>

      <CTARow phone={data.phone} />
    </div>
  )
}
