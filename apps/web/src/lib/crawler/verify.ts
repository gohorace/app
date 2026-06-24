/**
 * Content verification — HOR-386.
 *
 * The point-of-use freshness check: re-fetch a stored content URL and report
 * whether it's still a live 200 and (for listings) still active — used by the
 * just-in-time check at draft time (lib/outreach/freshness.ts) and reusable by
 * any sweep. The sold/under-offer banner detection is shared with extract.ts
 * so "is this listing still active?" has one definition.
 */

import * as cheerio from 'cheerio'
import { fetchPage } from './fetch'

/** A listing page showing a sold / under-offer / under-contract banner is no
 *  longer live. Shared by extraction (initial crawl) and verification. */
const SOLD_BANNER_RE = /\b(sold|under\s*offer|under\s*contract|under\s*contract)\b/i

export function isStillActive(html: string): boolean {
  const $ = cheerio.load(html)
  const heading = `${$('h1').text()} ${$('.status, .property-status, [class*="status"]').first().text()}`
  return !SOLD_BANNER_RE.test(heading)
}

export interface VerifyResult {
  httpStatus: number
  /** Listings: false when the page 404s or shows a sold banner. Non-listings:
   *  true while the URL resolves 200 (validity is carried by sold_date etc.). */
  stillActive: boolean
}

/** Re-verify a single content URL. Never throws — a network failure resolves to
 *  status 0 / not-active so the caller can drop the candidate. */
export async function verifyContentUrl(
  url: string,
  type: 'listing' | 'sold' | 'suburb_report',
): Promise<VerifyResult> {
  const res = await fetchPage(url)
  if (!res.ok) {
    // 404/410/5xx/network → not a usable candidate.
    return { httpStatus: res.status, stillActive: false }
  }
  if (type === 'listing') {
    return { httpStatus: res.status, stillActive: isStillActive(res.html) }
  }
  return { httpStatus: res.status, stillActive: true }
}
