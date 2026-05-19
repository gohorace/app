'use client'

/**
 * HOR-219 — Signal panel (slide-in from right).
 *
 * Opens when the map writes `#signal=<property_id>` or `#suburb=<suburb_id>`
 * to the URL hash (set by HOR-218's pin/label click handlers). Reads the
 * current `MapPayload` via prop — same shape the map renders, no extra
 * fetch. Closes via Esc, scrim, or × button.
 *
 * Two render kinds:
 *   - 'property' — eyebrow + address + Horace lead + sessions + pattern +
 *     intensity bar + known contact row + 'View property' CTA
 *   - 'suburb'   — eyebrow + name + headline + body + stats row +
 *     known contacts list + active properties list
 *
 * Pattern mirrors `notifications/slide-over.tsx` (hash routing, scrim, Esc).
 * Per the ticket's open-question note: we deliberately duplicate the
 * primitive rather than extract a shared `SlideOver` — a follow-up should
 * pull it out once both surfaces are stable. Surfaced in the PR description.
 *
 * No CRM affordances (CLAUDE.md hard rule #2) — the panel is a "signal
 * story" surface. No notes, no follow-up tasks, no deal stages.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, MapPin, X } from 'lucide-react'
import { MAP_COPY } from '@/lib/copy/map-view'
import type { MapPayload, PropertySignal, SuburbSignal } from '@/lib/map/rpc-types'

interface Props {
  payload: MapPayload | null
}

type Selection =
  | { kind: 'property'; id: string }
  | { kind: 'suburb';   id: string }
  | null

export function SignalPanel({ payload }: Props) {
  const router = useRouter()
  const [selection, setSelection] = useState<Selection>(null)

  // ─── Hash sync ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    function syncFromHash() {
      const h = window.location.hash
      if (h.startsWith('#signal=')) {
        setSelection({ kind: 'property', id: decodeURIComponent(h.slice('#signal='.length)) })
      } else if (h.startsWith('#suburb=')) {
        setSelection({ kind: 'suburb', id: decodeURIComponent(h.slice('#suburb='.length)) })
      } else {
        setSelection(null)
      }
    }
    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [])

  // ─── Close ──────────────────────────────────────────────────────────────
  const close = useCallback(() => {
    if (typeof window === 'undefined') return
    history.replaceState(null, '', window.location.pathname + window.location.search)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [])

  // ─── Esc-to-close ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!selection) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, close])

  // ─── Resolve selection → entity ─────────────────────────────────────────
  const property = useMemo<PropertySignal | null>(() => {
    if (!payload || selection?.kind !== 'property') return null
    return payload.properties.find((p) => p.id === selection.id) ?? null
  }, [payload, selection])

  const suburb = useMemo<SuburbSignal | null>(() => {
    if (!payload || selection?.kind !== 'suburb') return null
    return payload.suburbs.find((s) => s.id === selection.id) ?? null
  }, [payload, selection])

  if (!selection) return null

  // If the hash references an id that isn't in the current payload (e.g.
  // a stale link after the time window changed), close silently.
  if (!property && !suburb) {
    close()
    return null
  }

  return (
    <>
      {/* Scrim */}
      <div
        onClick={close}
        className="hidden md:block"
        style={{
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          right: 380,
          background: 'rgba(26,22,18,0.18)',
          backdropFilter: 'blur(1px)',
          WebkitBackdropFilter: 'blur(1px)',
          zIndex: 50,
        }}
        aria-hidden
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="signal-panel-eyebrow"
        className="hidden md:flex"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 380,
          background: '#F5F0E8',
          boxShadow: '-12px 0 32px rgba(26,22,18,0.18)',
          borderLeft: '1px solid rgba(140,123,107,0.18)',
          flexDirection: 'column',
          zIndex: 51,
          overflow: 'hidden',
        }}
      >
        <CloseButton onClick={close} />
        <div style={{ overflowY: 'auto', flex: 1, padding: '40px 24px 24px' }}>
          {property
            ? <PropertyView signal={property} onView={() => { close(); router.push(`/properties/${property.id}`) }} />
            : suburb
              ? <SuburbView signal={suburb} onOpenProperty={(id) => { close(); router.push(`/properties/${id}`) }} />
              : null}
        </div>
      </aside>
    </>
  )
}

// ─── Reusable bits ──────────────────────────────────────────────────────────

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={MAP_COPY.panel.close}
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        width: 32,
        height: 32,
        borderRadius: 6,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#5E5246',
        zIndex: 1,
      }}
    >
      <X style={{ width: 16, height: 16 }} />
    </button>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      id="signal-panel-eyebrow"
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#8C7B6B',
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  )
}

function HoraceLead({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        marginTop: 14,
        marginBottom: 16,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: muted ? '#8C7B6B' : '#C4622D',
          marginTop: 6,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontSize: 14.5,
          lineHeight: 1.45,
          color: '#1A1612',
          letterSpacing: '-0.005em',
        }}
      >
        {text}
      </span>
    </div>
  )
}

function IconLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: '#3a342d', marginBottom: 8 }}>
      <span style={{ color: '#8C7B6B', display: 'inline-flex', alignItems: 'center' }}>{icon}</span>
      <span>{children}</span>
    </div>
  )
}

// ─── Property render ────────────────────────────────────────────────────────

function PropertyView({ signal, onView }: { signal: PropertySignal; onView: () => void }) {
  const { story, knownContact, intensity, state } = signal
  const isMuted = state === 'quiet'

  return (
    <>
      <Eyebrow>{MAP_COPY.panelEyebrow.property}</Eyebrow>
      <h2
        className="font-display"
        style={{
          margin: 0,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: '#1A1612',
        }}
      >
        {signal.address}
      </h2>
      {signal.suburb && (
        <div style={{ fontSize: 12, color: '#8C7B6B', marginTop: 2 }}>{signal.suburb}</div>
      )}

      <HoraceLead text={story.lead} muted={isMuted} />

      <div style={{ marginTop: 4, marginBottom: 18 }}>
        <IconLine icon={<RepeatIcon />}>{story.sessions}</IconLine>
        <IconLine icon={<PulseIcon />}>{story.pattern}</IconLine>
      </div>

      <IntensityBar intensity={intensity} />

      {knownContact && (
        <KnownContactRow name={knownContact.name} since={knownContact.since} />
      )}

      <button
        type="button"
        onClick={onView}
        style={{
          marginTop: 22,
          width: '100%',
          padding: '12px 16px',
          borderRadius: 8,
          background: '#1A1612',
          color: '#FAF7F2',
          border: 'none',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 500,
          fontFamily: 'var(--font-body)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {MAP_COPY.panelCta}
        <ArrowRight style={{ width: 14, height: 14 }} />
      </button>
    </>
  )
}

function IntensityBar({ intensity }: { intensity: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(intensity * 100)))
  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#8C7B6B',
          marginBottom: 6,
        }}
      >
        {MAP_COPY.panel.signalStrength}
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={MAP_COPY.panel.signalStrength}
        style={{
          height: 6,
          borderRadius: 3,
          background: 'rgba(140,123,107,0.18)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'linear-gradient(90deg, rgba(196,98,45,0.6), #C4622D)',
            transition: 'width 320ms cubic-bezier(0.16,1,0.3,1)',
          }}
        />
      </div>
    </div>
  )
}

function KnownContactRow({ name, since }: { name: string; since: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
  const sinceLabel = relativeSince(since)
  return (
    <div
      style={{
        marginTop: 18,
        padding: '12px 14px',
        background: 'rgba(196,98,45,0.06)',
        border: '1px solid rgba(196,98,45,0.18)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#C4622D',
          color: '#FAF7F2',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'var(--font-body)',
          flexShrink: 0,
        }}
      >
        {initials || '?'}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1612' }}>{name}</div>
        <div style={{ fontSize: 11, color: '#8C7B6B', fontFamily: 'var(--font-mono)', letterSpacing: '0.02em' }}>
          {MAP_COPY.panel.knownSince} · {sinceLabel}
        </div>
      </div>
    </div>
  )
}

// ─── Suburb render ──────────────────────────────────────────────────────────

function SuburbView({
  signal,
  onOpenProperty,
}: {
  signal: SuburbSignal
  onOpenProperty: (id: string) => void
}) {
  const { story, state } = signal
  const isMuted = state === 'quiet'

  return (
    <>
      <Eyebrow>{MAP_COPY.panelEyebrow.suburb}</Eyebrow>
      <h2
        className="font-display"
        style={{
          margin: 0,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: '#1A1612',
        }}
      >
        {signal.name}
      </h2>
      {signal.stateAbbrev && (
        <div style={{ fontSize: 12, color: '#8C7B6B', marginTop: 2 }}>{signal.stateAbbrev}</div>
      )}

      <HoraceLead text={story.headline} muted={isMuted} />

      <p style={{ margin: '0 0 18px', fontSize: 13.5, lineHeight: 1.55, color: '#3a342d' }}>
        {story.body}
      </p>

      <StatsRow stats={story.stats} />

      <SectionTitle>{MAP_COPY.panel.knownContactsActive}</SectionTitle>
      {story.contacts.length === 0 ? (
        <EmptyLine>{MAP_COPY.panel.noKnownContacts}</EmptyLine>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {story.contacts.map((c) => (
            <li key={c.id} style={{ marginBottom: 8 }}>
              <KnownContactRowCompact name={c.name} lastActiveAt={c.lastActiveAt} />
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>{MAP_COPY.panel.activeProperties}</SectionTitle>
      {story.topProperties.length === 0 ? (
        <EmptyLine>{MAP_COPY.panel.noActiveProperties}</EmptyLine>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {story.topProperties.map((p) => (
            <li key={p.id} style={{ marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => onOpenProperty(p.id)}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  margin: '0 -10px',
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'var(--font-body)',
                }}
              >
                <MapPin style={{ width: 13, height: 13, color: '#8C7B6B', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#1A1612' }}>{p.address}</span>
                {p.state === 'hot' && (
                  <span
                    aria-label="hot"
                    style={{
                      marginLeft: 'auto',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: '#C4622D',
                    }}
                  >
                    hot
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function StatsRow({ stats }: { stats: Array<{ label: string; value: string }> }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
        gap: 12,
        marginBottom: 22,
        padding: '12px 14px',
        background: '#FAF7F2',
        border: '1px solid rgba(140,123,107,0.18)',
        borderRadius: 8,
      }}
    >
      {stats.map((s) => (
        <div key={s.label} style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 15,
              fontWeight: 600,
              color: '#1A1612',
              letterSpacing: '-0.01em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {s.value}
          </div>
          <div
            style={{
              fontSize: 10,
              color: '#8C7B6B',
              marginTop: 4,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
            }}
          >
            {s.label}
          </div>
        </div>
      ))}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 18,
        marginBottom: 10,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: '#8C7B6B',
      }}
    >
      {children}
    </div>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: '#8C7B6B', fontStyle: 'italic' }}>
      {children}
    </div>
  )
}

function KnownContactRowCompact({ name, lastActiveAt }: { name: string; lastActiveAt: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: 'rgba(196,98,45,0.85)',
          color: '#FAF7F2',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {initials || '?'}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#1A1612' }}>{name}</div>
        <div style={{ fontSize: 10, color: '#8C7B6B', fontFamily: 'var(--font-mono)' }}>
          {relativeSince(lastActiveAt)}
        </div>
      </div>
    </div>
  )
}

// ─── Inline SVG icons ──────────────────────────────────────────────────────
// Inline rather than pulling lucide so the panel ships with zero new icon
// imports — keeps the diff tight.

function RepeatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <polyline points="7 23 3 19 7 15"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  )
}

function PulseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function relativeSince(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  if (diff < 60_000)       return 'just now'
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`
  const d = Math.floor(diff / 86_400_000)
  if (d === 1)             return 'yesterday'
  if (d < 7)               return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 4)               return `${w}w ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
