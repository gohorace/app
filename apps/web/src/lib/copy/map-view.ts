/**
 * HOR-217 — Horace-voice copy for the Properties Map View.
 *
 * Single source of every UI string the map view (and its panel surfaces)
 * displays. Brief insists on no hardcoded strings in components — if a
 * label needs to change tone, edit it here, not in JSX.
 *
 * Used by:
 *   - `components/properties/properties-view.tsx` (header + summary)
 *   - `components/properties/time-scrubber.tsx`   (scrubber labels)
 *   - `components/properties/signal-panel.tsx`    (HOR-219 — eyebrows)
 *   - `lib/ai/map-summary.ts`                     (fallback strings)
 */

export const MAP_COPY = {
  /** Page header subtitle that replaces the existing "Your patch — what's…" line. */
  headerSubtitle: 'Where signal is concentrating across your market.',

  /** Empty state when the workspace has zero events + zero plottable signal. */
  emptyState: 'Horace is watching. Nothing stirring yet.',

  /** Counter chip labels. Brief: no plural logic — same word at 1 and 12. */
  counterLabels: {
    warm:     'warm',
    active:   'active',
    stirring: 'stirring',
  },

  /** Eyebrow text for the slide-in signal panel (lands in HOR-219). */
  panelEyebrow: {
    property: 'PROPERTY · SIGNAL STORY',
    suburb:   'SUBURB · SIGNAL STORY',
  },

  /** "• HORACE" tag in front of the summary line. */
  horaceTag: 'HORACE',

  /** Time scrubber positions — label is the active state, caption sits beneath. */
  scrubber: {
    '24h': { label: 'Today',      caption: 'Last 24 hours' },
    '7d':  { label: 'This week',  caption: 'Last 7 days'   },
    '30d': { label: 'This month', caption: 'Last 30 days'  },
  },

  /** CTA in the property panel (lands in HOR-219). */
  panelCta: 'View property',
} as const

export type MapCopy = typeof MAP_COPY
