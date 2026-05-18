import type { CmsKind } from './validate'

/**
 * Pure HTML heuristics for the site-probe response.
 *
 * Kept separate from the route handler so we can unit-test against
 * HTML fixtures without mocking fetch. PR 9 may swap the listings
 * counter for a sitemap-driven count once we have telemetry — the
 * route contract stays the same, this function changes in isolation.
 */

interface DetectResult {
  cms: CmsKind
  listings: number
}

const LISTING_PATH_RE = /\/(listings?|property|properties|for-sale|sale)\//i

/** Map detection markers to CMS kinds. Order matters: the first match
 *  wins so portal hits (which sit inside a wrapper site) supersede
 *  generic indicators. */
const CMS_MARKERS: ReadonlyArray<{ kind: CmsKind; markers: RegExp[] }> = [
  {
    kind: 'rea_portal',
    markers: [/realestate\.com\.au/i],
  },
  {
    kind: 'domain_portal',
    markers: [/\bdomain\.com\.au\b/i],
  },
  {
    kind: 'wordpress',
    markers: [
      /wp-content\//i,
      /wp-includes\//i,
      /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i,
    ],
  },
  {
    kind: 'wix',
    markers: [
      /static\.wixstatic\.com/i,
      /<meta[^>]+name=["']generator["'][^>]+content=["']Wix\.com/i,
    ],
  },
  {
    kind: 'squarespace',
    markers: [/static1\.squarespace\.com/i, /squarespace-cdn\.com/i],
  },
  {
    kind: 'shopify',
    markers: [/cdn\.shopify\.com/i],
  },
  {
    kind: 'webflow',
    markers: [/assets\.website-files\.com/i, /webflow\.com/i],
  },
]

export function detectCms(html: string): CmsKind {
  for (const { kind, markers } of CMS_MARKERS) {
    if (markers.some((re) => re.test(html))) return kind
  }
  return 'unknown'
}

/** Count distinct listing-detail URLs on the page. Dedupes by pathname
 *  so the same listing linked from a card + a thumbnail counts once.
 *  Caller may follow rel="next" once and merge the result if needed. */
export function countListings(html: string, baseUrl: URL): number {
  const seen = new Set<string>()
  // Restrict to <a href="…"> only. <link rel="next">, <area>, and
  // <base> href attributes don't represent listing links and would
  // otherwise inflate the count — rel="next" pagination markers get
  // picked up separately by nextPageUrl().
  const hrefRe = /<a\b[^>]*\shref=["']([^"'#]+)["']/gi
  let m: RegExpExecArray | null
  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1]
    if (!raw) continue
    let parsed: URL
    try {
      parsed = new URL(raw, baseUrl)
    } catch {
      continue
    }
    // Only count same-origin links — third-party "view on Domain" cards
    // are interesting CMS markers but not the agent's own listings.
    if (parsed.host !== baseUrl.host) continue
    if (!LISTING_PATH_RE.test(parsed.pathname)) continue
    seen.add(parsed.pathname.toLowerCase())
  }
  return seen.size
}

/** Look for a `<link rel="next">` or `<a rel="next">` to merge a second
 *  page of listings into the count. Returns absolute URL or null. */
export function nextPageUrl(html: string, baseUrl: URL): URL | null {
  const linkRe = /<(?:link|a)[^>]+rel=["']next["'][^>]+href=["']([^"'#]+)["']/i
  const altRe = /<(?:link|a)[^>]+href=["']([^"'#]+)["'][^>]+rel=["']next["']/i
  const match = linkRe.exec(html) ?? altRe.exec(html)
  if (!match) return null
  try {
    return new URL(match[1], baseUrl)
  } catch {
    return null
  }
}

export function detectAll(html: string, baseUrl: URL): DetectResult {
  return { cms: detectCms(html), listings: countListings(html, baseUrl) }
}
