/**
 * Outreach content freshness — HOR-386.
 *
 * The app-side companions to the `fresh_agent_site_content` SQL view (the
 * source of truth for pool freshness, queried by P3 matching):
 *
 *   • isFreshCandidate — same rule, in memory, for filtering rows we already
 *     hold (kept in sync with the view).
 *   • verifyUrlsForDraft — the JUST-IN-TIME gate (P4): re-verify the 1–5 URLs
 *     actually about to go into a draft, write the result back, and return only
 *     those still live. This closes the window between the nightly crawl and
 *     the moment of send (a listing sold at 2pm, draft fired at 4pm).
 *
 * Bias to omission throughout: anything uncertain is dropped, never inserted.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyContentUrl } from '@/lib/crawler/verify'
import { mapWithConcurrency } from '@/lib/crawler/fetch'

export const FRESHNESS_MAX_AGE_DAYS = 14
const VERIFY_CONCURRENCY = 6

export type FreshContentType = 'listing' | 'sold' | 'suburb_report'

export interface FreshnessRow {
  id: string
  content_type: FreshContentType
  source_url: string
  last_http_status: number | null
  last_crawled_at: string
  last_verified_at: string | null
  sold_date: string | null
  still_active: boolean | null
}

/** Mirror of the fresh_agent_site_content view: 200 on last check, touched
 *  within the window, sold rows have a sold_date, listings are still_active. */
export function isFreshCandidate(row: FreshnessRow, maxAgeDays = FRESHNESS_MAX_AGE_DAYS): boolean {
  if (row.last_http_status !== 200) return false

  const crawled = Date.parse(row.last_crawled_at)
  const verified = row.last_verified_at ? Date.parse(row.last_verified_at) : crawled
  const lastTouch = Math.max(crawled, Number.isNaN(verified) ? crawled : verified)
  if (Number.isNaN(lastTouch)) return false
  const ageDays = (Date.now() - lastTouch) / 86_400_000
  if (ageDays > maxAgeDays) return false

  if (row.content_type === 'sold') return row.sold_date != null
  if (row.content_type === 'listing') return row.still_active === true
  return true
}

/** Persist a fresh verification result onto the content row. */
export async function recordVerification(
  admin: SupabaseClient,
  contentId: string,
  result: { httpStatus: number; stillActive: boolean },
): Promise<void> {
  await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('agent_site_content' as any)
    .update({
      last_verified_at: new Date().toISOString(),
      last_http_status: result.httpStatus,
      still_active: result.stillActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contentId)
}

/** Just-in-time gate: re-verify each candidate's URL right before it goes into
 *  a draft, write the result back, and return only the rows that are still
 *  live (200 + active for listings, sold_date present for sold). */
export async function verifyUrlsForDraft(
  admin: SupabaseClient,
  rows: FreshnessRow[],
): Promise<FreshnessRow[]> {
  const checked = await mapWithConcurrency(rows, VERIFY_CONCURRENCY, async (row) => {
    const result = await verifyContentUrl(row.source_url, row.content_type)
    await recordVerification(admin, row.id, result)
    const live =
      result.httpStatus === 200 &&
      (row.content_type !== 'listing' || result.stillActive) &&
      (row.content_type !== 'sold' || row.sold_date != null)
    return live ? row : null
  })
  return checked.filter((r): r is FreshnessRow => r !== null)
}
