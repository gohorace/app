import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { detectCms, countListings, nextPageUrl } from './detect'

/**
 * POST /api/onboarding/site-probe
 *
 * Takes an agent-supplied URL, fetches the homepage with a User-Agent
 * that identifies as HoraceBot, and returns a structured signal the
 * Turn 2 UI uses to render pills ("47 live listings · WordPress").
 *
 * Errors return `{ ok: false, reason }` with 200 so the client doesn't
 * have to distinguish HTTP-level vs domain-level failures — the turn
 * counts two non-ok responses to flip the bail prompt. HOR-214 (PR 9)
 * may swap the listings heuristic for a sitemap-driven count once we
 * have telemetry; the response shape stays fixed.
 *
 * Auth-gated to match every other onboarding endpoint.
 */

export const runtime = 'nodejs'

export type CmsKind =
  | 'wordpress'
  | 'wix'
  | 'squarespace'
  | 'domain_portal'
  | 'rea_portal'
  | 'shopify'
  | 'webflow'
  | 'custom'
  | 'unknown'

export type SiteProbeFailReason = 'unreachable' | 'blocked' | 'parse' | 'timeout'

export type SiteProbeResponse =
  | { ok: true; finalUrl: string; host: string; listings: number; cms: CmsKind }
  | { ok: false; reason: SiteProbeFailReason }

const schema = z.object({
  url: z.string().min(1).max(2048),
})

const FETCH_TIMEOUT_MS = 8_000
const BODY_CAP_BYTES = 1_048_576 // 1 MiB
const USER_AGENT = 'HoraceBot/1.0 (+https://gohorace.com)'
const LISTING_CAP = 200

export function normaliseUrl(input: string): URL | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // Only prepend https:// when the input has no scheme at all. If the
  // agent typed file:// / ftp:// / javascript:, we keep the scheme so
  // the protocol check below can reject it explicitly — otherwise
  // "https://file:///etc/passwd" parses as host=file, which is sneaky.
  const hasAnyScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  const withScheme = hasAnyScheme ? trimmed : `https://${trimmed}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()
  // Reject LANs and internal networks even at validation time, before
  // we ever issue the outbound fetch. Belt-and-braces against SSRF.
  if (
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.endsWith('.local') ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)
  ) {
    return null
  }
  return u
}

/**
 * Fetch a URL with a hard timeout + body cap. Returns the decoded text
 * and the final URL after redirects. Throws with `.name === 'AbortError'`
 * on timeout, `.name === 'BlockedError'` on >= 400, and other errors
 * bubble up via classifyError as 'unreachable'.
 */
async function fetchHtml(url: URL): Promise<{ html: string; finalUrl: URL }> {
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
    })
    if (res.status >= 400) {
      const e = new Error(`status ${res.status}`)
      e.name = 'BlockedError'
      throw e
    }
    // Stream-read with body cap. Avoid pulling unbounded HTML into
    // memory for sites that respond with a huge page.
    const reader = res.body?.getReader()
    const decoder = new TextDecoder()
    let html = ''
    let bytes = 0
    if (reader) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        html += decoder.decode(value, { stream: true })
        if (bytes >= BODY_CAP_BYTES) {
          await reader.cancel().catch(() => {})
          break
        }
      }
      html += decoder.decode()
    } else {
      html = await res.text()
    }
    return { html, finalUrl: new URL(res.url || url.toString()) }
  } finally {
    clearTimeout(timeout)
  }
}

export function classifyError(err: unknown): SiteProbeFailReason {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; code?: string; cause?: { code?: string } }
    if (e.name === 'AbortError') return 'timeout'
    if (e.name === 'BlockedError') return 'blocked'
    // node's undici surfaces DNS/connect failures as TypeError with a
    // .cause.code like ENOTFOUND / ECONNREFUSED — call that unreachable.
    const code = e.code ?? e.cause?.code
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN') {
      return 'unreachable'
    }
  }
  return 'unreachable'
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const res: SiteProbeResponse = { ok: false, reason: 'parse' }
    return NextResponse.json(res, { status: 200 })
  }

  const url = normaliseUrl(parsed.data.url)
  if (!url) {
    const res: SiteProbeResponse = { ok: false, reason: 'unreachable' }
    return NextResponse.json(res, { status: 200 })
  }

  let html: string
  let finalUrl: URL
  try {
    const out = await fetchHtml(url)
    html = out.html
    finalUrl = out.finalUrl
  } catch (err) {
    const reason = classifyError(err)
    const res: SiteProbeResponse = { ok: false, reason }
    return NextResponse.json(res, { status: 200 })
  }

  // CMS + listings on the first page.
  const cms = detectCms(html)
  let listings = countListings(html, finalUrl)

  // Follow rel="next" once, merge the count. Cap the total so a
  // misconfigured paginated site can't push the chip label past 200.
  if (listings < LISTING_CAP) {
    const next = nextPageUrl(html, finalUrl)
    if (next && next.host === finalUrl.host) {
      try {
        const second = await fetchHtml(next)
        const more = countListings(second.html, finalUrl)
        listings = Math.min(LISTING_CAP, listings + more)
      } catch {
        // Soft failure — keep the first-page count.
      }
    }
  }

  const res: SiteProbeResponse = {
    ok: true,
    finalUrl: finalUrl.toString(),
    host: finalUrl.hostname,
    listings,
    cms,
  }
  return NextResponse.json(res, { status: 200 })
}
