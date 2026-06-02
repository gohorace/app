'use client'

import Link from 'next/link'
import { ArrowRight, BarChart2, Clock, MapPin, Repeat, X } from 'lucide-react'
import type { PropertySignal, SuburbSignal } from '@/lib/map/rpc-types'
import styles from './market-map.module.css'

/**
 * DetailPanel — the `/market` glass detail panel (HOR-370 hero re-skin).
 *
 * Two variants sharing the design's `.map-panel` glass shell:
 *   - **Property** (`#signal=<id>`): signal story + strength bar + CTA.
 *     Replaces the HOR-245 `PropertyOverlay` full-height drawer with the
 *     design's compact glass card. (The drawer's photo header, specs grid,
 *     Ask-Horace/companion affordance, linked-contacts + last-activity
 *     strips are not in the design and are dropped — flagged in the PR.)
 *   - **Suburb** (`#suburb=<id>`): re-added (HOR-245 dropped it). Reads the
 *     `suburb.story` the payload already composes (`headline`, `body`,
 *     `stats`, `contacts`, `topProperties`).
 *
 * Both are 340px, scrollable, top-right, with a `panel-in` entry. The
 * caller owns selection state + hash sync.
 */

export type Selection =
  | { kind: 'pin'; id: string }
  | { kind: 'suburb'; id: string }

interface DetailPanelProps {
  selection: Selection
  property: PropertySignal | null
  suburb: SuburbSignal | null
  onClose: () => void
}

export function DetailPanel({ selection, property, suburb, onClose }: DetailPanelProps) {
  if (selection.kind === 'pin') {
    if (!property) return null
    return <PropertyPanel property={property} onClose={onClose} />
  }
  if (!suburb) return null
  return <SuburbPanel suburb={suburb} onClose={onClose} />
}

// ─── Property variant ─────────────────────────────────────────────────────────

function PropertyPanel({ property, onClose }: { property: PropertySignal; onClose: () => void }) {
  const hasSignal = property.state !== 'quiet'
  const intensityPct = Math.round(Math.max(0, Math.min(1, property.intensity)) * 100)

  return (
    <aside
      className={styles.panel}
      role="dialog"
      aria-label={`${property.address} — property signal`}
    >
      <CloseButton onClose={onClose} />
      <div className={styles.panelEyebrow}>Property · signal story</div>
      <h2 className={styles.panelTitle}>{property.address}</h2>
      {property.suburb && <p className={styles.panelSubtitle}>{property.suburb}</p>}

      {hasSignal ? (
        <>
          <div className={styles.horace}>
            <span className={styles.horaceDot} aria-hidden />
            <span>{property.story.lead}</span>
          </div>

          <div className={styles.pinLines}>
            <div className={styles.pinLine}>
              <Repeat size={14} color="#8C7B6B" aria-hidden />
              <span>{property.story.sessions}</span>
            </div>
            <div className={styles.pinLine}>
              <BarChart2 size={14} color="#8C7B6B" aria-hidden />
              <span>{property.story.pattern}</span>
            </div>
          </div>

          <div className={styles.intensity}>
            <div className={styles.intensityLabel}>Signal strength</div>
            <div className={styles.intensityBar}>
              <div className={styles.intensityFill} style={{ width: `${intensityPct}%` }} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className={`${styles.horace} ${styles.horaceQuiet}`}>
            <span className={`${styles.horaceDot} ${styles.horaceDotQuiet}`} aria-hidden />
            <span>Quiet. Nothing worth your attention here.</span>
          </div>
          <div className={styles.pinLines}>
            <div className={styles.pinLine}>
              <Clock size={14} color="#8C7B6B" aria-hidden />
              <span>No activity in the selected window</span>
            </div>
          </div>
        </>
      )}

      <Link href={`/properties/${property.id}`} className={styles.cta}>
        View property
        <ArrowRight size={14} />
      </Link>
    </aside>
  )
}

// ─── Suburb variant ───────────────────────────────────────────────────────────

function SuburbPanel({ suburb, onClose }: { suburb: SuburbSignal; onClose: () => void }) {
  const { story } = suburb
  return (
    <aside
      className={styles.panel}
      role="dialog"
      aria-label={`${suburb.name ?? 'Suburb'} — suburb signal`}
    >
      <CloseButton onClose={onClose} />
      <div className={styles.panelEyebrow}>Suburb · last 7 days</div>
      <h2 className={styles.panelTitle}>{suburb.name ?? 'Suburb'}</h2>

      <div className={styles.horace}>
        <span className={styles.horaceDot} aria-hidden />
        <span>{story.headline}</span>
      </div>
      <p className={styles.body}>{story.body}</p>

      {story.stats.length > 0 && (
        <div className={styles.stats}>
          {story.stats.map((st) => (
            <div className={styles.stat} key={st.label}>
              <div className={styles.statValue}>{st.value}</div>
              <div className={styles.statLabel}>{st.label}</div>
            </div>
          ))}
        </div>
      )}

      {story.contacts.length > 0 && (
        <>
          <div className={styles.section}>Known contacts active</div>
          <div className={styles.contacts}>
            {story.contacts.map((c) => (
              <div className={styles.contact} key={c.id}>
                <div className={styles.contactAvatar} aria-hidden>
                  {initialsFor(c.name)}
                </div>
                <div>
                  <div className={styles.contactName}>{c.name}</div>
                  <div className={styles.contactDetail}>
                    Active {formatRelative(c.lastActiveAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {story.topProperties.length > 0 && (
        <>
          <div className={styles.section}>Active properties</div>
          <div className={styles.pinRows}>
            {story.topProperties.map((p) => (
              <Link key={p.id} href={`/properties/${p.id}`} className={styles.pinRow}>
                <MapPin size={13} color="#8C7B6B" style={{ flexShrink: 0 }} aria-hidden />
                <span>{p.address}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className={styles.panelClose} onClick={onClose} aria-label="Close panel">
      <X size={16} />
    </button>
  )
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return 'recently'
    const diff = Date.now() - then
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return 'recently'
  }
}
