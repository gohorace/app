/**
 * URL classification — HOR-385.
 *
 * Maps a same-origin page URL to one of the three content types the outreach
 * drafter pulls from, by path heuristics. Pure + deterministic so it's the
 * unit-test surface for sitemap coverage. Returns null for pages we don't
 * index (home, contact, bios, blogs — out of v1 scope per the brief).
 *
 * Order matters: `sold` and `suburb_report` paths are more specific than the
 * broad listing path, so they're tested first (a /sold/ URL must not be
 * mis-tagged as an active listing).
 */

export type CrawlContentType = 'listing' | 'sold' | 'suburb_report'

// Sold results: /sold/, /recently-sold/, /sales/, /sold-properties/.
const SOLD_RE = /\/(sold|recently-sold|sold-properties|sale-results|past-sales)(\/|$)/i

// Suburb reports / area guides / market updates.
const REPORT_RE =
  /\/(suburb-(report|profile|guide)|area-(guide|profile)|market-(report|update|insights|wrap)|locality-report)(\/|$)/i

// Active listings: /listing(s)/, /property|properties/, /for-sale/, /buy/.
// `/rent/` and `/leasing/` deliberately excluded — v1 is sales outreach only.
const LISTING_RE = /\/(listings?|propert(y|ies)|for-sale|buy|residential-for-sale)(\/|$)/i

// Index/landing pages under a listing path that aren't a single listing
// (e.g. /properties/ or /for-sale/ with no slug after). We want detail pages.
const INDEX_TAIL_RE = /\/(listings?|properties|for-sale|buy|sold|recently-sold)\/?$/i

export function classifyUrl(rawUrl: string): CrawlContentType | null {
  let path: string
  try {
    path = new URL(rawUrl).pathname
  } catch {
    return null
  }
  if (!path || path === '/') return null

  // Skip bare index/landing pages — we index detail pages, not list views.
  if (INDEX_TAIL_RE.test(path)) return null

  if (SOLD_RE.test(path)) return 'sold'
  if (REPORT_RE.test(path)) return 'suburb_report'
  if (LISTING_RE.test(path)) return 'listing'
  return null
}

/** True when `candidate` is on the same registrable host as `base` (ignoring a
 *  leading www.). Third-party "view on Domain" links are CMS markers, not the
 *  agent's own content. */
export function isSameSite(candidate: string, base: string): boolean {
  try {
    const c = new URL(candidate).hostname.replace(/^www\./, '').toLowerCase()
    const b = new URL(base).hostname.replace(/^www\./, '').toLowerCase()
    return c === b
  } catch {
    return false
  }
}
