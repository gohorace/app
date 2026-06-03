/**
 * Sitemap discovery — HOR-385.
 *
 * Sitemap-first (the brief's recommendation): read robots' Sitemap: lines plus
 * the conventional locations (including WordPress core's /wp-sitemap.xml, since
 * most agents are on WordPress), follow one level of <sitemapindex> nesting,
 * collect <loc> page URLs, and keep the ones that classify as content.
 *
 * Falls back to a one-level homepage link scan when no sitemap yields content
 * URLs — enough for small sites without a sitemap, and bounded so a JS-rendered
 * SPA (which won't expose links in static HTML) simply yields nothing rather
 * than hanging. JS-rendered listings are an accepted v1 coverage gap.
 */

import * as cheerio from 'cheerio'
import { fetchPage } from './fetch'
import { classifyUrl, isSameSite, type CrawlContentType } from './classify'

export interface DiscoveredUrl {
  url: string
  type: CrawlContentType
}

const CONVENTIONAL_SITEMAPS = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']
const MAX_CHILD_SITEMAPS = 50
const ACCEPT_XML = 'application/xml,text/xml,*/*'

/** Parse a sitemap or sitemap-index document. Returns child sitemap URLs and
 *  page <loc> URLs separately so the caller controls recursion depth. */
export function parseSitemapXml(xml: string): { sitemaps: string[]; pages: string[] } {
  const $ = cheerio.load(xml, { xmlMode: true })
  const sitemaps: string[] = []
  const pages: string[] = []

  $('sitemapindex > sitemap > loc').each((_, el) => {
    const loc = $(el).text().trim()
    if (loc) sitemaps.push(loc)
  })
  $('urlset > url > loc').each((_, el) => {
    const loc = $(el).text().trim()
    if (loc) pages.push(loc)
  })
  // Some sitemaps omit the namespaced wrappers; fall back to any <loc>.
  if (sitemaps.length === 0 && pages.length === 0) {
    $('loc').each((_, el) => {
      const loc = $(el).text().trim()
      if (loc) pages.push(loc)
    })
  }
  return { sitemaps, pages }
}

function dedupeTyped(urls: string[], baseUrl: string, robotsAllowed: (p: string) => boolean): DiscoveredUrl[] {
  const seen = new Set<string>()
  const out: DiscoveredUrl[] = []
  for (const u of urls) {
    if (!isSameSite(u, baseUrl)) continue
    let path: string
    try {
      path = new URL(u).pathname
    } catch {
      continue
    }
    if (!robotsAllowed(path)) continue
    const type = classifyUrl(u)
    if (!type) continue
    const key = u.split('#')[0].toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ url: u.split('#')[0], type })
  }
  return out
}

/** Discover content URLs for a site, capped at `maxUrls`. */
export async function discoverContentUrls(
  baseUrl: string,
  declaredSitemaps: string[],
  robotsAllowed: (path: string) => boolean,
  maxUrls: number,
): Promise<{ urls: DiscoveredUrl[]; truncated: boolean }> {
  let origin: string
  try {
    origin = new URL(baseUrl).origin
  } catch {
    return { urls: [], truncated: false }
  }

  const candidates = Array.from(
    new Set([...declaredSitemaps, ...CONVENTIONAL_SITEMAPS.map((p) => origin + p)]),
  )

  const pageUrls: string[] = []
  let childCount = 0

  for (const sm of candidates) {
    const res = await fetchPage(sm, { accept: ACCEPT_XML })
    if (!res.ok || !res.html) continue
    const { sitemaps, pages } = parseSitemapXml(res.html)
    pageUrls.push(...pages)
    for (const child of sitemaps) {
      if (childCount >= MAX_CHILD_SITEMAPS) break
      childCount++
      const cres = await fetchPage(child, { accept: ACCEPT_XML })
      if (!cres.ok || !cres.html) continue
      pageUrls.push(...parseSitemapXml(cres.html).pages)
    }
    // Early exit once we clearly have enough content URLs.
    if (dedupeTyped(pageUrls, baseUrl, robotsAllowed).length >= maxUrls) break
  }

  let typed = dedupeTyped(pageUrls, baseUrl, robotsAllowed)

  // Fallback: no sitemap content → one-level homepage link scan.
  if (typed.length === 0) {
    const home = await fetchPage(baseUrl, { accept: 'text/html,*/*' })
    if (home.ok && home.html) {
      const $ = cheerio.load(home.html)
      const hrefs: string[] = []
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')
        if (!href) return
        try {
          hrefs.push(new URL(href, home.finalUrl).toString())
        } catch {
          /* skip */
        }
      })
      typed = dedupeTyped(hrefs, baseUrl, robotsAllowed)
    }
  }

  const truncated = typed.length > maxUrls
  return { urls: typed.slice(0, maxUrls), truncated }
}
