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

  return out
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
