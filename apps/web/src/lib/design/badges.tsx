/**
 * Shared design primitives used by both Contacts and Properties surfaces.
 * Faithful port of /tmp/horace_design_properties/components/Shared.jsx.
 *
 * One source of truth — Contacts grid, Contact detail, Properties grid,
 * Property detail, Add modals all import from here. If a primitive needs
 * to diverge, generalise with a prop, don't fork.
 */

import { Home, KeyRound, Eye } from 'lucide-react'

// ── Identity gradient (contacts only) ─────────────────────────────────────────
// 'anonymous' → 'email' → 'partial' → 'known'. Four-dot mini scale fills left to
// right as identity resolves. Used on contact rows and detail headers.

export type IdentityState = 'anonymous' | 'email' | 'partial' | 'known'

export interface IdentityConfig {
  label:  string
  short:  string
  bg:     string
  fg:     string
  dot:    string
  /** How many of the 4 dots are filled — proxies "how known is this person?" */
  filled: 1 | 2 | 3 | 4
}

export const IDENTITY: Record<IdentityState, IdentityConfig> = {
  anonymous: { label: 'Anonymous',  short: 'Anon',    bg: 'rgba(140,123,107,0.14)', fg: '#5E5246', dot: '#8C7B6B', filled: 1 },
  email:     { label: 'Email only', short: 'Email',   bg: 'rgba(181,146,42,0.12)',  fg: '#8A6A00', dot: '#B5922A', filled: 2 },
  partial:   { label: 'Partial',    short: 'Partial', bg: 'rgba(61,82,70,0.12)',    fg: '#3D5246', dot: '#3D5246', filled: 3 },
  known:     { label: 'Known',      short: 'Known',   bg: 'rgba(196,98,45,0.12)',   fg: '#C4622D', dot: '#C4622D', filled: 4 },
}

export function IdentityGradient({
  state = 'anonymous',
  size = 'sm',
}: {
  state?: IdentityState
  size?: 'sm' | 'lg'
}) {
  const cfg = IDENTITY[state] ?? IDENTITY.anonymous
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: size === 'lg' ? '4px 10px 4px 6px' : '2px 8px 2px 5px',
        borderRadius: 9999,
        background: cfg.bg,
        color: cfg.fg,
        fontSize: size === 'lg' ? 11 : 10,
        fontWeight: 500,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <span style={{ display: 'inline-flex', gap: 1.5 }}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: i < cfg.filled ? cfg.dot : 'rgba(140,123,107,0.25)',
            }}
          />
        ))}
      </span>
      {cfg.label}
    </span>
  )
}

// ── State badge (properties) ──────────────────────────────────────────────────
// V1 relationship-first vocabulary (HOR-135). Every state describes the
// agent's view of the property, not the property's market status. The
// migration in 20260514000001_property_state_v1.sql swaps the CHECK
// constraint to exactly these four values.

export type PropertyStatus = 'listed' | 'appraising' | 'watching' | 'sold'

interface StateStyle {
  label: string
  dot:   string
  bg:    string
  fg:    string
  /** One-line guidance used by the Change-state dropdown and Add modal. */
  desc:  string
}

export const STATE_STYLE: Record<PropertyStatus, StateStyle> = {
  listed:     { label: 'Listed',     dot: '#C4622D', bg: 'rgba(196,98,45,0.12)',  fg: '#C4622D', desc: 'Your stock — actively on the market' },
  appraising: { label: 'Appraising', dot: '#B5922A', bg: 'rgba(181,146,42,0.14)', fg: '#8A6A00', desc: 'Active appraisal pitch in progress'  },
  watching:   { label: 'Watching',   dot: '#3D5246', bg: 'rgba(61,82,70,0.12)',   fg: '#3D5246', desc: "Not yours — but you're tracking it"  },
  sold:       { label: 'Sold',       dot: '#8C7B6B', bg: 'rgba(140,123,107,0.16)', fg: '#5E5246', desc: 'A past listing — they sold with you' },
}

/** Ordered for picker UIs (Add modal, Change-state dropdown). */
export const PROPERTY_STATUSES: readonly PropertyStatus[] = [
  'listed',
  'appraising',
  'watching',
  'sold',
] as const

export function StateBadge({
  status,
  size = 'sm',
}: {
  status: PropertyStatus | null | undefined
  size?: 'sm' | 'lg'
}) {
  const s = STATE_STYLE[status ?? 'watching']
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: size === 'lg' ? 12 : 11,
        fontWeight: 500,
        padding: size === 'lg' ? '4px 10px' : '3px 9px',
        borderRadius: 9999,
        background: s.bg,
        color: s.fg,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: s.dot,
          flexShrink: 0,
        }}
      />
      {s.label}
    </span>
  )
}

// ── Avatar stack (contacts linked to a property — mirrors PropertyThumbStack) ─

export interface AvatarStackPerson {
  id?: string
  initials: string
  identity?: IdentityState
}

export function AvatarStack({
  people,
  max = 3,
}: {
  people: AvatarStackPerson[]
  max?: number
}) {
  if (!people || people.length === 0) {
    return <span style={{ fontSize: 12, color: '#8C7B6B', fontStyle: 'italic' }}>anonymous only</span>
  }
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((p, i) => {
        const cfg = IDENTITY[p.identity ?? 'known']
        return (
          <div
            key={p.id ?? i}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: cfg.bg,
              color: cfg.fg,
              fontSize: 9,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: i === 0 ? 0 : -7,
              border: '2px solid #FAF7F2',
              flexShrink: 0,
              fontFamily: 'var(--font-body)',
            }}
            aria-hidden
          >
            {p.initials}
          </div>
        )
      })}
      {extra > 0 && (
        <div
          style={{
            minWidth: 22,
            height: 22,
            padding: '0 5px',
            borderRadius: 9999,
            background: 'rgba(140,123,107,0.14)',
            color: '#5E5246',
            fontSize: 9,
            fontWeight: 600,
            marginLeft: -7,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #FAF7F2',
            fontFamily: 'var(--font-mono)',
          }}
        >
          +{extra}
        </div>
      )}
    </div>
  )
}

// ── Role badge (contacts) ─────────────────────────────────────────────────────
// Three roles: Seller (durable past sale), Buyer (durable past purchase),
// Engaged (transient — recent property_view events). Optional count when the
// contact holds the same role on multiple properties.

export type ContactRole = 'seller' | 'buyer' | 'engaged'

const ROLE_STYLE: Record<ContactRole, { label: string; icon: typeof Home; fg: string; bg: string }> = {
  seller:  { label: 'Seller',  icon: Home,     fg: '#C4622D', bg: 'rgba(196,98,45,0.12)' },
  buyer:   { label: 'Buyer',   icon: KeyRound, fg: '#3D5246', bg: 'rgba(61,82,70,0.12)' },
  engaged: { label: 'Engaged', icon: Eye,      fg: '#5E5246', bg: 'rgba(140,123,107,0.14)' },
}

export function RoleBadge({
  role,
  count,
  size = 'sm',
}: {
  role: ContactRole
  count?: number
  size?: 'sm' | 'lg'
}) {
  const r = ROLE_STYLE[role] ?? ROLE_STYLE.engaged
  const Icon = r.icon
  const iconSize = size === 'lg' ? 11 : 10
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: size === 'lg' ? 11 : 10.5,
        fontWeight: 500,
        padding: size === 'lg' ? '3px 9px' : '2.5px 7px',
        borderRadius: 4,
        background: r.bg,
        color: r.fg,
        fontFamily: 'var(--font-body)',
        whiteSpace: 'nowrap',
        lineHeight: 1.3,
      }}
    >
      <Icon style={{ width: iconSize, height: iconSize }} aria-hidden />
      {r.label}
      {count != null && count > 0 && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: size === 'lg' ? 10 : 9.5,
            opacity: 0.7,
            marginLeft: 1,
          }}
        >
          · {count}
        </span>
      )}
    </span>
  )
}

// ── Engagement intensity indicator ────────────────────────────────────────────
// Three-cell bar reading "Quiet → Low → Medium → High" at a glance. Used in
// both contact and property rows. Single visual element — no sparklines.

const ENGAGEMENT_LABELS = ['Quiet', 'Low', 'Medium', 'High'] as const
const ENGAGEMENT_COLORS = ['rgba(140,123,107,0.28)', '#8C7B6B', '#B5922A', '#C4622D'] as const

export type EngagementValue = 0 | 1 | 2 | 3

export function EngagementIndicator({
  value = 0,
  showLabel = false,
  layout = 'inline',
}: {
  value?: EngagementValue
  showLabel?: boolean
  layout?: 'inline' | 'block'
}) {
  const v = Math.max(0, Math.min(3, value)) as EngagementValue
  const fillColor = ENGAGEMENT_COLORS[v]
  const cells = [0, 1, 2].map((i) => (
    <span
      key={i}
      style={{
        width: 5,
        height: 12,
        borderRadius: 1.5,
        background: i < v ? fillColor : 'rgba(140,123,107,0.16)',
        transition: 'background 180ms',
      }}
    />
  ))

  if (layout === 'block') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 2 }}>{cells}</div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.04em',
            color: v > 0 ? fillColor : '#8C7B6B',
          }}
        >
          {ENGAGEMENT_LABELS[v]}
        </span>
      </div>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>{cells}</span>
      {showLabel && (
        <span style={{ fontSize: 11, fontWeight: 500, color: v > 0 ? fillColor : '#8C7B6B' }}>
          {ENGAGEMENT_LABELS[v]}
        </span>
      )}
    </span>
  )
}

// ── Person avatar (initials, intent-tinted) ───────────────────────────────────
// Renders a dashed-circle eye icon when identity is 'anonymous' or 'email'
// (HOR-135: don't imply we know the agent's first name when we only have an
// email like email+arnold@andytwomey.com). Otherwise tints the bg using the
// identity palette and shows initials.
//
// The explicit `anonymous` prop is preserved as an override for callers that
// know better (e.g. stitched-but-still-unconfirmed visitors). Anyone passing
// `identity={deriveIdentity(contact)}` gets the right behaviour for free.

export function PersonAvatar({
  initials,
  identity = 'known',
  size = 32,
  anonymous,
}: {
  initials: string
  identity?: IdentityState
  size?: number
  anonymous?: boolean
}) {
  const showAnonShape =
    anonymous === true ||
    (anonymous !== false && (identity === 'anonymous' || identity === 'email'))

  if (showAnonShape) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'rgba(140,123,107,0.12)',
          border: '1px dashed rgba(140,123,107,0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#8C7B6B',
          flexShrink: 0,
          fontSize: size * 0.36,
          fontFamily: 'var(--font-body)',
        }}
        aria-hidden
      >
        <Eye style={{ width: size * 0.45, height: size * 0.45 }} />
      </div>
    )
  }
  const cfg = IDENTITY[identity] ?? IDENTITY.known
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: cfg.bg,
        color: cfg.fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.36,
        fontWeight: 600,
        flexShrink: 0,
        fontFamily: 'var(--font-body)',
      }}
      aria-hidden
    >
      {initials}
    </div>
  )
}

// ── Property thumb stack (mirrors AvatarStack for properties) ────────────────
// Linear-gradient "photo" placeholders, overlapped by 6px each. Tone is a
// deterministic two-colour palette derived from the property record (see
// `paletteForProperty` in lib/design/property-tone.ts when introduced).

export interface PropertyThumbInfo {
  address: string
  /** Two-colour tone — derived deterministically from the property id. */
  tone: [string, string]
}

export function PropertyThumbStack({
  properties,
  max = 3,
}: {
  properties: PropertyThumbInfo[]
  max?: number
}) {
  if (!properties || properties.length === 0) {
    return <span style={{ fontSize: 12, color: '#8C7B6B' }}>—</span>
  }
  const shown = properties.slice(0, max)
  const extra = properties.length - shown.length
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((p, i) => (
        <div
          key={i}
          title={p.address}
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            background: `linear-gradient(135deg, ${p.tone[0]} 0%, ${p.tone[1]} 100%)`,
            marginLeft: i === 0 ? 0 : -6,
            border: '2px solid #FAF7F2',
            flexShrink: 0,
            boxShadow: 'inset 0 -4px 8px rgba(26,22,18,0.18)',
          }}
        />
      ))}
      {extra > 0 && (
        <div
          style={{
            minWidth: 24,
            height: 24,
            borderRadius: 4,
            padding: '0 5px',
            background: 'rgba(140,123,107,0.14)',
            color: '#5E5246',
            fontSize: 9,
            fontWeight: 600,
            marginLeft: -6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid #FAF7F2',
            fontFamily: 'var(--font-mono)',
          }}
        >
          +{extra}
        </div>
      )}
    </div>
  )
}

// ── Property thumb (single) ───────────────────────────────────────────────────
// Larger version of the stack item, used in detail panes and add-property
// candidate rows. Deterministic gradient + the property's leading digit
// rendered in Playfair.

export function PropertyThumb({
  tone,
  address,
  size = 44,
}: {
  tone: [string, string]
  address: string
  size?: number
}) {
  const initial = address.match(/^\d+\s+(\S)/)?.[1] ?? address[0] ?? '·'
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        flexShrink: 0,
        background: `linear-gradient(135deg, ${tone[0]} 0%, ${tone[1]} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-display)',
        fontSize: size * 0.45,
        color: 'rgba(245,240,232,0.85)',
        fontWeight: 500,
        boxShadow: 'inset 0 -10px 20px rgba(26,22,18,0.18)',
        position: 'relative',
        overflow: 'hidden',
      }}
      aria-hidden
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'absolute', inset: 0, opacity: 0.18 }}
      >
        <path
          d={`M0 ${size * 0.7} L${size * 0.5} ${size * 0.4} L${size} ${size * 0.7} L${size} ${size} L0 ${size} Z`}
          fill="rgba(245,240,232,0.9)"
        />
      </svg>
      <span style={{ position: 'relative', zIndex: 1 }}>{initial}</span>
    </div>
  )
}

/**
 * Deterministic two-colour tone palette for property thumbs. Uses a stable
 * hash of the property id so the same property always gets the same colours.
 */
const TONE_PALETTES: Array<[string, string]> = [
  ['#C4622D', '#E8956D'], // terracotta
  ['#3D5246', '#6B8472'], // moss
  ['#8C7B6B', '#B5A091'], // stone
  ['#B5922A', '#D4B250'], // ochre
  ['#2E2823', '#5C4F44'], // charcoal
  ['#5C4F44', '#8C7B6B'], // warm stone
]

export function toneFor(id: string | null | undefined): [string, string] {
  if (!id) return TONE_PALETTES[0]
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i)
  return TONE_PALETTES[Math.abs(hash) % TONE_PALETTES.length]
}
