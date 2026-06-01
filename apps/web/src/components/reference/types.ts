/* Horace reference tables — shared types + signal config.
 *
 * The substrate layer is a read-only "infrastructure, not UI" view of the
 * contacts / properties data. These types are the data contract the table
 * components render against. The server loaders (`lib/reference/load-contacts`,
 * `load-properties`) produce these rows from real Supabase data; the table
 * sorts / filters / paginates over them in-component. */

export type SignalValue =
  | 'high intent'
  | 'serious buyer'
  | 'pre-appraisal'
  | 'benchmarking'
  | 'watching'

/** Canonical enum order — also the filter-dropdown order. */
export const SIGNALS: SignalValue[] = [
  'high intent',
  'serious buyer',
  'pre-appraisal',
  'benchmarking',
  'watching',
]

/** Self-contained pill styling (light fill + same-family dark text) so the
 *  pills read correctly in BOTH themes — they do NOT swap between light/dark. */
export const SIGNAL_STYLES: Record<SignalValue, { fill: string; text: string }> = {
  'high intent':   { fill: '#FAEEDA', text: '#854F0B' },
  'serious buyer': { fill: '#E6F1FB', text: '#185FA5' },
  'pre-appraisal': { fill: '#EEEDFE', text: '#534AB7' },
  'benchmarking':  { fill: '#E1F5EE', text: '#0F6E56' },
  'watching':      { fill: '#F1EFE8', text: '#5F5E5A' },
}

/** Rank for sorting the enum column (high intent → watching). */
export const SIGNAL_ORDER: Record<SignalValue, number> = {
  'high intent': 5,
  'serious buyer': 4,
  'pre-appraisal': 3,
  'benchmarking': 2,
  'watching': 1,
}

export interface ContactRow {
  id: string
  name: string
  email: string | null
  intent: number
  signal: SignalValue
  sessions_7d: number
  /** postgres timestamptz string, e.g. `2026-06-01 10:52:00+10`; null if never seen */
  last_seen: string | null
}

export interface PropertyRow {
  id: string
  address: string
  views_7d: number
  visitors: number
  top_signal: SignalValue
  /** postgres timestamptz string, e.g. `2026-06-01 10:52:00+10`; null if never viewed */
  last_viewed: string | null
}
