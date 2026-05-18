/**
 * Shared types for /api/onboarding/patch-stats.
 *
 * Lives in a sibling module rather than in route.ts because Next.js 14
 * App Router only permits a fixed export surface from route.ts files
 * (HTTP verbs + `runtime` + a handful of config exports). Type-aliases
 * and helper exports get flagged as invalid route exports — see the
 * site-probe/validate.ts split for the same reason.
 */

export interface PatchStat {
  /** G-NAF locality_pid. */
  pid: string
  /** Sales in the last 90 days for this locality. Null until a
   *  property-data vendor (CoreLogic / Domain / PropTrack — still an
   *  open question in CLAUDE.md) is wired. */
  sales_90d: number | null
  /** Median sale price for the locality, AUD whole-dollars. Null
   *  under the same vendor-pending caveat as sales_90d. */
  median_price: number | null
}

export interface PatchStatsResponse {
  stats: PatchStat[]
}
