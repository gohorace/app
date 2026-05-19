'use client'

import Link from 'next/link'
import { ArrowUpRight, X } from 'lucide-react'
import { QuillIcon } from '@/components/ui/quill-icon'
import { useCompanion } from '@/components/companion/companion-context'
import type { PropertySignal } from '@/lib/map/rpc-types'

/**
 * PropertyOverlay — the v2 `/market` right-side panel that slides in
 * when an agent taps a pin. **New shape, not the HOR-219 signal panel.**
 *
 * Layout per the v2 prototype:
 *   - Header photo (200px gradient placeholder + engagement pill + close)
 *   - Address + suburb
 *   - Specs grid — placeholder for now (beds/baths/land/sold isn't
 *     stored on the property row in v2.0; flagged in the M4 PR as a
 *     follow-up once spec data lands)
 *   - "Inside this property" charcoal Horace card + Ask Horace button
 *   - Open property + Ask Horace buttons
 *   - Linked contacts (when known)
 *   - Last activity strip
 *
 * Hash routing: opens when `#signal=<id>` is in the URL — same
 * mechanism HOR-219's signal-panel used, so deep links survive the
 * panel swap.
 */

interface PropertyOverlayProps {
  property: PropertySignal
  onClose: () => void
}

export function PropertyOverlay({ property, onClose }: PropertyOverlayProps) {
  const { openCompanion } = useCompanion()

  const askHorace = () => {
    openCompanion({
      prompt: `What changed on ${property.address} since I last looked?`,
      contextLabel: `Property: ${property.address}`,
    })
  }

  return (
    <aside
      role="dialog"
      aria-label={`${property.address} — property overlay`}
      className="flex flex-col w-full md:w-[380px]"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        background: '#FAF7F2',
        borderLeft: '1px solid rgba(140,123,107,0.25)',
        boxShadow: '-12px 0 32px rgba(26,22,18,0.18)',
        overflowY: 'auto',
        animation: 'drawer-slide-in 280ms var(--ease-out)',
        zIndex: 5,
      }}
    >
      {/* ── Header photo + close + engagement pill ───────────────── */}
      <header
        style={{
          height: 200,
          position: 'relative',
          flexShrink: 0,
          overflow: 'hidden',
          background: gradientFromAddress(property.address),
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close overlay"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'rgba(26,22,18,0.6)',
            border: 'none',
            color: '#FAF7F2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
            backdropFilter: 'blur(8px)',
          }}
        >
          <X size={14} />
        </button>
        <EngagementPill state={property.state} />
      </header>

      {/* ── Address + suburb ───────────────────────────────────── */}
      <div style={{ padding: '18px 22px 6px' }}>
        <h2
          className="font-display"
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            color: '#1A1612',
            letterSpacing: '-0.015em',
            lineHeight: 1.2,
          }}
        >
          {property.address}
        </h2>
        {property.suburb && (
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 13,
              color: '#8C7B6B',
              fontFamily: 'var(--font-body)',
            }}
          >
            {property.suburb}
          </p>
        )}
      </div>

      {/* ── Specs grid — placeholder for v2.0 ───────────────────── */}
      <SpecsGrid property={property} />

      {/* ── Inside this property — charcoal Horace card ─────────── */}
      <div style={{ padding: '6px 22px 0' }}>
        <section
          style={{
            background: '#2E2823',
            color: '#F5F0E8',
            borderRadius: 12,
            padding: '16px 18px',
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
              color: 'rgba(245,240,232,0.55)',
              marginBottom: 8,
            }}
          >
            <QuillIcon size={11} color="#E8956D" strokeWidth={1.75} aria-hidden />
            Inside this property
          </div>
          <p
            className="font-display"
            style={{
              margin: 0,
              fontStyle: 'italic',
              fontSize: 14,
              lineHeight: 1.55,
              color: 'rgba(245,240,232,0.92)',
            }}
          >
            {property.story.lead}
          </p>
          <button
            type="button"
            onClick={askHorace}
            style={{
              marginTop: 12,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'rgba(232,149,109,0.18)',
              color: '#E8956D',
              border: '1px solid rgba(232,149,109,0.35)',
              borderRadius: 7,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}
          >
            <QuillIcon size={12} color="#E8956D" strokeWidth={1.75} aria-hidden />
            Ask Horace
          </button>
        </section>
      </div>

      {/* ── Open property + Ask Horace primary buttons ──────────── */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '14px 22px 14px',
        }}
      >
        <Link
          href={`/properties/${property.id}`}
          style={{
            flex: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            padding: '10px 14px',
            background: '#C4622D',
            color: '#FAF7F2',
            border: 'none',
            borderRadius: 7,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            textDecoration: 'none',
            fontFamily: 'var(--font-body)',
          }}
        >
          Open property
          <ArrowUpRight size={13} />
        </Link>
        <button
          type="button"
          onClick={askHorace}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '10px 14px',
            background: '#FAF7F2',
            color: '#5E5246',
            border: '1px solid rgba(140,123,107,0.3)',
            borderRadius: 7,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
          }}
        >
          <QuillIcon size={13} color="#A85220" strokeWidth={1.75} aria-hidden />
          Ask Horace
        </button>
      </div>

      {/* ── Linked contacts ─────────────────────────────────────── */}
      {property.knownContact && (
        <div style={{ padding: '0 22px 14px' }}>
          <SectionLabel>Linked contacts</SectionLabel>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              background: '#FAF7F2',
              border: '1px solid rgba(140,123,107,0.2)',
              borderRadius: 8,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'rgba(196,98,45,0.22)',
                color: '#C4622D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                fontWeight: 600,
                flexShrink: 0,
              }}
              aria-hidden
            >
              {initialsFor(property.knownContact.name)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#1A1612',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {property.knownContact.name}
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: '#8C7B6B',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                Known since {formatDate(property.knownContact.since)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Last activity strip ─────────────────────────────────── */}
      <div style={{ padding: '0 22px 22px' }}>
        <SectionLabel>Last activity</SectionLabel>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: '#1A1612',
            lineHeight: 1.5,
          }}
        >
          {property.story.pattern}
        </p>
        {property.lastSeen && (
          <p
            style={{
              marginTop: 4,
              fontSize: 11,
              color: '#8C7B6B',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Last seen {formatRelative(property.lastSeen)} · {property.sessionCount} session
            {property.sessionCount === 1 ? '' : 's'}
          </p>
        )}
      </div>
    </aside>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function EngagementPill({ state }: { state: PropertySignal['state'] }) {
  const labels: Record<PropertySignal['state'], string> = {
    hot: 'Hot',
    active: 'Active',
    quiet: 'Quiet',
  }
  const colors: Record<PropertySignal['state'], { bg: string; fg: string }> = {
    hot: { bg: 'rgba(196,98,45,0.92)', fg: '#FAF7F2' },
    active: { bg: 'rgba(181,146,42,0.92)', fg: '#FAF7F2' },
    quiet: { bg: 'rgba(94,82,70,0.85)', fg: '#FAF7F2' },
  }
  const c = colors[state]
  return (
    <span
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        padding: '4px 10px',
        background: c.bg,
        color: c.fg,
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-body)',
        backdropFilter: 'blur(6px)',
      }}
    >
      {labels[state]}
    </span>
  )
}

function SpecsGrid({ property: _property }: { property: PropertySignal }) {
  // v2.0 stub — the v2 prototype shows beds/baths/land/sold, but the
  // properties schema doesn't carry those today. Render a single
  // session-count cell so the visual rhythm is preserved; full grid
  // wires when spec data lands (out of scope for HOR-245).
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 0,
        margin: '10px 22px 4px',
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.2)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <SpecCell label="Beds" value="—" />
      <SpecCell label="Baths" value="—" />
      <SpecCell label="Land" value="—" />
      <SpecCell label="Status" value={specStatus(_property.state)} />
    </div>
  )
}

function SpecCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '10px 8px',
        textAlign: 'center',
        borderRight: '1px solid rgba(140,123,107,0.12)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16,
          fontWeight: 600,
          color: '#1A1612',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#8C7B6B',
        }}
      >
        {label}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: '0 0 8px',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: '#8C7B6B',
      }}
    >
      {children}
    </p>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function gradientFromAddress(address: string): string {
  // Deterministic-but-varied warm gradient seeded by the address so each
  // overlay reads distinct without needing real photos.
  let hash = 0
  for (let i = 0; i < address.length; i++) {
    hash = (hash << 5) - hash + address.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 60 // warm range only (0-60° red→yellow)
  return `linear-gradient(135deg, hsl(${hue} 45% 62%) 0%, hsl(${(hue + 20) % 360} 35% 48%) 100%)`
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime()
    const diff = Date.now() - then
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return formatDate(iso)
  } catch {
    return iso
  }
}

function specStatus(state: PropertySignal['state']): string {
  return state === 'hot' ? 'Hot' : state === 'active' ? 'Active' : 'Quiet'
}
