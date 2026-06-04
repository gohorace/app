/**
 * Content extraction — HOR-385.
 *
 * Given a fetched page + its classified type, pull the fields the outreach
 * drafter needs. Priority: schema.org JSON-LD (most reliable, and the only
 * source of a STRUCTURED address — which is what lets a crawled listing match
 * a G-NAF property row by address_hash), then Open Graph / meta tags, then a
 * couple of bounded regex fallbacks.
 *
 * Pure given (html, url, type) so it's the unit-test surface. Returns the
 * jsonb payload `upsert_agent_site_content` expects (minus workspace/agent).
 * Anything we can't find stays undefined → omitted, never guessed.
 */

import * as cheerio from 'cheerio'
import type { CrawlContentType } from './classify'

export interface ExtractedContent {
  content_type: CrawlContentType
  source_url: string
  suburb?: string
  address?: string
  street_number?: string
  street_name?: string
  state?: string
  postcode?: string
  price_text?: string
  bed?: number
  bath?: number
  car?: number
  hero_image_url?: string
  sold_price_text?: string
  sold_date?: string
  listed_date?: string
  title?: string
  published_date?: string
  still_active?: boolean
  /** Stable per-property ID from the URL when present (e.g. Rex CRM exposes
   *  /properties/<address>/<rex-ID>). A far more reliable reconciliation key
   *  than the address hash — stored in `raw` for now; promoting it to the
   *  primary match key is a tracked follow-up. */
  external_id?: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const SOLD_BANNER_RE = /\b(sold|under\s*offer|under\s*contract)\b/i

function asArray(v: any): any[] {
  if (Array.isArray(v)) return v
  if (v == null) return []
  return [v]
}

/** Flatten JSON-LD: handle arrays, @graph, and nested node refs. */
function collectNodes(json: any, out: any[]): void {
  for (const node of asArray(json)) {
    if (node && typeof node === 'object') {
      out.push(node)
      if (node['@graph']) collectNodes(node['@graph'], out)
    }
  }
}

function typeMatches(node: any, names: RegExp): boolean {
  const t = node['@type']
  const types = asArray(t).map((x) => String(x))
  return types.some((x) => names.test(x))
}

const ADDRESS_TYPES = /RealEstateListing|Residence|SingleFamilyResidence|House|Apartment|Place|Product|Offer|Accommodation/i

function firstString(v: any): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = firstString(x)
      if (s) return s
    }
    return undefined
  }
  if (v && typeof v === 'object') {
    // ImageObject / Offer-ish wrappers.
    return firstString(v.url ?? v.contentUrl ?? v.price ?? v.name)
  }
  return undefined
}

function toInt(v: any): number | undefined {
  const s = firstString(v)
  if (!s) return undefined
  const n = parseInt(s.replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) ? n : undefined
}

/** Split "5/12 Smith Street" → { number: "5/12", name: "Smith Street" }. */
function splitStreet(streetAddress: string): { number?: string; name?: string } {
  const s = streetAddress.trim()
  const m = s.match(/^(\S*\d\S*)\s+(.+)$/)
  if (m) return { number: m[1], name: m[2] }
  return { name: s || undefined }
}

function parseJsonLd($: cheerio.CheerioAPI): any[] {
  const nodes: any[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text()
    if (!raw) return
    try {
      collectNodes(JSON.parse(raw), nodes)
    } catch {
      /* malformed JSON-LD — skip */
    }
  })
  return nodes
}

export function extractContent(html: string, url: string, type: CrawlContentType): ExtractedContent {
  const $ = cheerio.load(html)
  const out: ExtractedContent = { content_type: type, source_url: url }

  const meta = (sel: string): string | undefined => {
    const v = $(sel).attr('content')
    return v ? v.trim() || undefined : undefined
  }

  // ── schema.org JSON-LD (primary) ──────────────────────────────────
  const nodes = parseJsonLd($)
  const propertyNode = nodes.find((n) => typeMatches(n, ADDRESS_TYPES) && (n.address || n.name))
  const articleNode = nodes.find((n) => typeMatches(n, /Article|BlogPosting|WebPage|Report/i))

  if (propertyNode) {
    const addr = propertyNode.address
    if (addr && typeof addr === 'object') {
      const street = firstString(addr.streetAddress)
      if (street) {
        const { number, name } = splitStreet(street)
        out.street_number = number
        out.street_name = name
      }
      out.suburb = firstString(addr.addressLocality) ?? out.suburb
      out.state = firstString(addr.addressRegion) ?? out.state
      out.postcode = firstString(addr.postalCode) ?? out.postcode
    } else if (typeof addr === 'string') {
      out.address = addr.trim()
    }
    out.address = out.address ?? firstString(propertyNode.name)

    const price = firstString(propertyNode.offers ?? propertyNode.price)
    if (price) {
      if (type === 'sold') out.sold_price_text = price
      else out.price_text = price
    }
    out.hero_image_url = out.hero_image_url ?? firstString(propertyNode.image)
    out.bed = out.bed ?? toInt(propertyNode.numberOfBedrooms ?? propertyNode.numberOfRooms)
    out.bath = out.bath ?? toInt(propertyNode.numberOfBathroomsTotal ?? propertyNode.numberOfBathrooms)

    const posted = firstString(propertyNode.datePosted ?? propertyNode.datePublished)
    if (posted) out.listed_date = isoDate(posted)
  }

  if (articleNode && type === 'suburb_report') {
    out.title = out.title ?? firstString(articleNode.headline ?? articleNode.name)
    const pub = firstString(articleNode.datePublished)
    if (pub) out.published_date = isoDate(pub)
  }

  // ── Open Graph / meta fallbacks ───────────────────────────────────
  out.title = out.title ?? meta('meta[property="og:title"]') ?? ($('h1').first().text().trim() || undefined)
  out.hero_image_url = out.hero_image_url ?? meta('meta[property="og:image"]')
  out.address = out.address ?? meta('meta[property="og:title"]')

  if (type === 'suburb_report' && !out.published_date) {
    const pub = meta('meta[property="article:published_time"]')
    if (pub) out.published_date = isoDate(pub)
  }

  // Suburb fallback for reports: trailing slug of the URL, title-cased.
  if (type === 'suburb_report' && !out.suburb) {
    out.suburb = suburbFromUrl(url)
  }

  // bed/bath/car regex fallback over visible text (bounded scan).
  if (out.bed === undefined || out.bath === undefined || out.car === undefined) {
    const text = $('body').text().slice(0, 20_000)
    out.bed = out.bed ?? matchCount(text, /(\d+)\s*(?:bed|bd|bedroom)/i)
    out.bath = out.bath ?? matchCount(text, /(\d+)\s*(?:bath|ba|bathroom)/i)
    out.car = out.car ?? matchCount(text, /(\d+)\s*(?:car|garage|parking)/i)
  }

  // still_active: a listing page showing a sold/under-offer banner is no
  // longer live. Sold pages don't carry this flag (handled by sold_date).
  if (type === 'listing') {
    const heading = `${$('h1').text()} ${$('.status, .property-status, [class*="status"]').first().text()}`
    out.still_active = !SOLD_BANNER_RE.test(heading)
  }

  if (type === 'listing' || type === 'sold') {
    // Locate the address slug + any trailing stable ID. Handles both
    // /listing/<address-slug>/ and the Rex convention
    // /properties/<address-slug>/<rex-ID> (where the ID is the LAST segment,
    // so the address is the prior one).
    const { slug, externalId } = listingUrlParts(url)
    out.external_id = externalId

    // Street-completeness guard + URL-slug recovery. Some themes emit a
    // truncated schema.org streetAddress (e.g. "61", rest only in the slug).
    // A bare-number street would create a junk `properties` row that can't
    // match G-NAF — bias to omission. Recover the real street from the address
    // slug, anchored on the known suburb/state/postcode; if that fails, drop
    // the structured street so the upsert RPC skips property reconciliation
    // (the content row is still captured + suburb-matchable).
    if (!isCompleteStreet(out.street_name)) {
      const recovered = recoverStreetFromSlug(slug, out.suburb, out.state, out.postcode)
      if (recovered && isCompleteStreet(recovered.name)) {
        out.street_number = recovered.number
        out.street_name = recovered.name
      } else {
        out.street_number = undefined
        out.street_name = undefined
      }
    }
  }

  return out
}

// A trailing path segment that's a stable ID, not an address slug:
// "rex-12345", "12345", "p-12345" — mostly numeric, no multi-word address.
const EXTERNAL_ID_RE = /^[a-z]{0,4}[-_]?\d{4,}$/i

// Category prefixes that sit BEFORE a detail slug — never an address segment.
// Guards against /listing/12345 treating "listing" as the address.
const CATEGORY_SEGMENTS = new Set([
  'listing', 'listings', 'property', 'properties', 'for-sale', 'buy', 'sold',
  'recently-sold', 'sold-properties',
])

/** Split a listing URL into its address slug + any trailing stable ID.
 *  /properties/12-smith-st-glebe-nsw-2037/rex-12345
 *    → { slug: '12-smith-st-glebe-nsw-2037', externalId: 'rex-12345' }
 *  /listing/759-61-noosa-springs-drive-noosa-heads-qld-4567/
 *    → { slug: '759-61-...-4567' } (last segment is the address)
 *  /listing/12345
 *    → { slug: '12345' } (prior segment is a category word, not an address). */
function listingUrlParts(url: string): { slug: string; externalId?: string } {
  let segs: string[]
  try {
    segs = new URL(url).pathname.split('/').filter(Boolean)
  } catch {
    return { slug: '' }
  }
  if (segs.length === 0) return { slug: '' }
  const last = segs[segs.length - 1].replace(/\.(html?|php)$/i, '')
  if (segs.length >= 2 && EXTERNAL_ID_RE.test(last)) {
    const prior = segs[segs.length - 2]
    // Only treat `last` as an ID tail when the prior segment is a real address
    // slug (multi-token), not a category prefix like /listing/.
    if (!CATEGORY_SEGMENTS.has(prior.toLowerCase()) && prior.includes('-')) {
      return { slug: prior, externalId: last }
    }
  }
  return { slug: last }
}

/** A street looks usable only if it has letters and some length — a purely
 *  numeric "61" (truncated source data) does not and must not seed a property. */
function isCompleteStreet(name: string | undefined): boolean {
  if (!name) return false
  const t = name.trim()
  return t.length >= 3 && /[a-z]/i.test(t)
}

const STATE_TOKENS = new Set(['qld', 'nsw', 'vic', 'sa', 'wa', 'tas', 'nt', 'act'])

/** Recover { number, name } from a listing URL slug, anchored on the known
 *  suburb/state/postcode tail. Slugs like
 *  "759-61-noosa-springs-drive-noosa-heads-qld-4567" → number "61", name
 *  "Noosa Springs Drive": strip postcode + state + the trailing suburb words,
 *  drop a leading listing-id (a numeric token followed by another number), and
 *  title-case what remains. Returns undefined when there's nothing usable. */
function recoverStreetFromSlug(
  slug: string,
  suburb?: string,
  state?: string,
  postcode?: string,
): { number?: string; name?: string } | undefined {
  if (!slug) return undefined

  let tokens = slug
    .replace(/\.(html?|php)$/i, '')
    .toLowerCase()
    .split('-')
    .filter(Boolean)

  // Strip trailing postcode + state.
  if (postcode && tokens[tokens.length - 1] === postcode.toLowerCase()) tokens.pop()
  else if (/^\d{4}$/.test(tokens[tokens.length - 1] ?? '')) tokens.pop()
  if (STATE_TOKENS.has(tokens[tokens.length - 1] ?? '')) tokens.pop()
  else if (state && tokens[tokens.length - 1] === state.toLowerCase()) tokens.pop()

  // Strip the trailing suburb words (matched from the end, so a suburb word
  // that also appears in the street name — "noosa" — is left intact).
  if (suburb) {
    const subTokens = suburb.toLowerCase().split(/\s+/).filter(Boolean)
    for (let i = subTokens.length - 1; i >= 0; i--) {
      if (tokens[tokens.length - 1] === subTokens[i]) tokens.pop()
      else break
    }
  }

  // Drop a leading listing-id: a numeric token immediately followed by another
  // numeric token (the street number). "759-61-..." → drop "759".
  if (tokens.length >= 2 && /^\d+$/.test(tokens[0]) && /^\d+$/.test(tokens[1])) {
    tokens.shift()
  }
  if (tokens.length === 0) return undefined

  let number: string | undefined
  if (/^\d+[a-z]?$/.test(tokens[0])) {
    number = tokens[0]
    tokens = tokens.slice(1)
  }
  if (tokens.length === 0) return undefined

  const name = tokens.map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase())).join(' ')
  return { number, name }
}

function matchCount(text: string, re: RegExp): number | undefined {
  const m = text.match(re)
  if (!m) return undefined
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : undefined
}

function suburbFromUrl(url: string): string | undefined {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    const slug = parts[parts.length - 1]
    if (!slug) return undefined
    const name = slug
      .replace(/\.(html?|php)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim()
    return name || undefined
  } catch {
    return undefined
  }
}

/** Coerce a date-ish string to YYYY-MM-DD, or undefined if unparseable.
 *  Prefer a literal date prefix so a timezone-offset timestamp keeps its
 *  written calendar date (e.g. "2026-04-01T09:00:00+10:00" → "2026-04-01",
 *  not the UTC-shifted previous day). */
function isoDate(s: string): string | undefined {
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[0]
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString().slice(0, 10)
}
