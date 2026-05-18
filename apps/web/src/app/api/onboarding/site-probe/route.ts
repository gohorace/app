import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { detectCms, countListings, nextPageUrl } from './detect'
import { classifyError, normaliseUrl, type SiteProbeResponse } from './validate'

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
 * have telemetry; the response shape (defined in ./validate) stays
 * fixed.
 *
 * Auth-gated to match every other onboarding endpoint.
 *
 * Types + helpers live in ./validate. Next.js 14 App Router only
 * permits a fixed export surface from route.ts (HTTP verbs + config
 * exports like `runtime`); the type aliases and normaliseUrl /
 * classifyError helpers would otherwise trip the type check.
 */

export const runtime = 'nodejs'

const schema = z.object({
  url: z.string().min(1).max(2048),
})

const FETCH_TIMEOUT_MS = 8_000
const BODY_CAP_BYTES = 1_048_576 // 1 MiB
const USER_AGENT = 'HoraceBot/1.0 (+https://gohorace.com)'
const LISTING_CAP = 200

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
