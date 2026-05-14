/**
 * Moment types for the Notifications stream. Per the design brief:
 *   1. newly_known       — anonymous session now identified
 *   2. high_intent       — strong signal (form hover, sustained read)
 *   3. returning         — known contact back for another session
 *   4. worth_watching    — property-level engagement spike
 *   5. ownership_changed — property title transferred
 *
 * Each type owns:
 *  - a lucide icon (rendered at 13px inside a 22px tinted tile)
 *  - a single accent colour (`ink`) — the icon tint only, never the card
 *  - a `dim` (~12% alpha) — the tile background behind the icon
 *  - a `fg` — uppercase-label colour used in the type chip / anatomy view
 *  - a human-readable label
 *
 * The accent lives in the icon, never the whole card. The card stays paper;
 * the signal is in the read, not the chrome. (Brief, "Moment card anatomy".)
 *
 * Colours are sourced from the existing palette in
 * `apps/web/src/lib/design/intent.ts` (terracotta, ochre/mid, moss, stone)
 * — no new colours introduced.
 */

export type MomentType =
  | 'newly_known'
  | 'high_intent'
  | 'returning'
  | 'worth_watching'
  | 'ownership_changed'

export interface MomentTone {
  /** Lucide icon name */
  icon: 'user-check' | 'flame' | 'arrow-up-right' | 'eye' | 'key'
  /** Icon stroke colour */
  ink: string
  /** Soft tinted background for the icon tile + (optionally) avatar fill */
  dim: string
  /** Uppercase-label foreground (slightly darker than `ink` for AA contrast) */
  fg: string
  /** Short human label — used in the anatomy panel + the More menu */
  label: string
}

export const MOMENT_TONES: Record<MomentType, MomentTone> = {
  newly_known:       { icon: 'user-check',     ink: '#C4622D', dim: 'rgba(196,98,45,0.12)',  fg: '#C4622D', label: 'Newly known'       },
  high_intent:       { icon: 'flame',          ink: '#B5922A', dim: 'rgba(181,146,42,0.12)', fg: '#8A6A00', label: 'High intent'       },
  returning:         { icon: 'arrow-up-right', ink: '#3D5246', dim: 'rgba(61,82,70,0.12)',   fg: '#3D5246', label: 'Returning'         },
  worth_watching:    { icon: 'eye',            ink: '#C4622D', dim: 'rgba(196,98,45,0.12)',  fg: '#C4622D', label: 'Worth watching'    },
  ownership_changed: { icon: 'key',            ink: '#8C7B6B', dim: 'rgba(140,123,107,0.15)', fg: '#5A4D40', label: 'Ownership changed' },
}

/** Time-window buckets shown as sticky section headers in the stream. */
export type Bucket = 'today' | 'yesterday' | 'week' | 'earlier'

export const BUCKET_LABELS: Record<Bucket, string> = {
  today:     'Today',
  yesterday: 'Yesterday',
  week:      'This week',
  earlier:   'Earlier',
}

/** Subject is either a contact (initials avatar) or a property (home thumb). */
export type MomentSubject =
  | {
      kind: 'contact'
      id: string
      name: string
      initials: string
      /** One-line context, e.g. "Paddington · Active 2h ago" */
      context: string
    }
  | {
      kind: 'property'
      id: string
      address: string
      context: string
    }

/**
 * View-model consumed by MomentCard. The page-level adapter
 * (`lib/notifications/to-stream-moment.ts`) converts a `notification_log`
 * row into this shape; the fixtures file constructs them directly.
 *
 * `time` is pre-formatted (e.g. "12m", "2h", "Yesterday") — the card never
 * computes time itself, keeping it pure-presentational.
 */
export interface StreamMoment {
  id: string
  type: MomentType
  unread: boolean
  bucket: Bucket
  time: string
  /** Short observational headline — one line, max ~60 chars */
  headline: string
  /** Italic editorial read — Horace's voice; one short sentence */
  editorial: string
  /** Optional signal tags rendered as small pill chips */
  tags: string[]
  subject: MomentSubject
  /** Primary CTA label, e.g. "Add to list", "View contact", "Add to Watching" */
  primary: string
  /** If multiple moments fired on this subject inside the batching window. */
  stack?: { count: number; headlines: string[] }
}

/**
 * Default primary-action copy per moment type. Used by the adapter when
 * the underlying row doesn't carry an explicit override. The values match
 * the brief's Moment-types table.
 */
export const DEFAULT_PRIMARY_BY_TYPE: Record<MomentType, string> = {
  newly_known:       'View contact',
  high_intent:       'Add to list',
  returning:         'Add to list',
  worth_watching:    'Add to Watching',
  ownership_changed: 'Add to Watching',
}
