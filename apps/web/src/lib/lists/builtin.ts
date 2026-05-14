// HOR-144  Built-in dynamic lists.
//
// Two slugs ship in V1 — they're computed at query time from contacts.score
// rather than stored in the `lists` table. The score thresholds mirror the
// intent buckets from apps/web/src/lib/design/intent.ts:
//
//   • Watch closely  → score >= 50   (high intent)
//   • Warming up     → score >= 20 && score < 50   (mid intent)
//
// Anything below 20 is "Quietly circling" / "Quiet" — useful for the timeline
// but not interesting enough to warrant its own list.
//
// To add a new built-in, append to BUILTIN_LISTS — it powers both the
// overview page panel and the /lists/[slug] route resolver.

export type BuiltinListSlug = 'watch-closely' | 'warming-up'

export interface BuiltinListDef {
  slug: BuiltinListSlug
  name: string
  /** Single-line italic copy shown under the name on cards. */
  blurb: string
  /** Min score (inclusive). */
  minScore: number
  /** Max score (exclusive). null = no upper bound. */
  maxScoreExclusive: number | null
}

export const BUILTIN_LISTS: BuiltinListDef[] = [
  {
    slug: 'watch-closely',
    name: 'Watch closely',
    blurb: 'High-intent contacts — call-ready.',
    minScore: 50,
    maxScoreExclusive: null,
  },
  {
    slug: 'warming-up',
    name: 'Warming up',
    blurb: 'Mid-intent — pattern is real but pre-action.',
    minScore: 20,
    maxScoreExclusive: 50,
  },
]

export function isBuiltinSlug(id: string): id is BuiltinListSlug {
  return BUILTIN_LISTS.some((b) => b.slug === id)
}

export function findBuiltin(slug: string): BuiltinListDef | undefined {
  return BUILTIN_LISTS.find((b) => b.slug === slug)
}
