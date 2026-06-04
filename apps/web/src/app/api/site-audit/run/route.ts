/**
 * POST /api/site-audit/run  — public.
 *
 * Runs the five-check audit against an agent's website and returns the
 * assembled, Horace-voiced report. Speed + Mobile come from one Google
 * PageSpeed Insights (mobile) call; Forms + Tracking + Discovery come from a
 * lightweight crawl. Both run in parallel; whichever flakes degrades to a
 * "couldn't read" finding rather than failing the whole audit.
 *
 * Auth: none — this is a public marketing surface. Guarded by a soft in-memory
 * IP rate limit; the upstream cost (PSI quota, one outbound fetch) is the only
 * thing worth protecting and it's bounded per request.
 *
 * Errors are returned as `{ error: 'invalid' | 'unreachable' | 'timeout' }`
 * (HTTP 200/422/504) so the client can render the matching in-voice copy.
 */

import { NextRequest, NextResponse } from 'next/server'
import { cleanDomain, isValidDomain } from '@/lib/audit/domain'
import { runPageSpeed, type PageSpeedMetrics } from '@/lib/audit/pagespeed'
import { crawlSite, type CrawlResult } from '@/lib/audit/crawl'
import { buildAuditResult } from '@/lib/audit/findings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The audit's long pole is PSI (~20–40s on a cold site). Give the whole thing
// headroom under the handoff's 90s ceiling.
export const maxDuration = 90

// ── Soft IP rate limit (per-instance, best-effort) ──────────────────────────
const IP_LIMIT_PER_MIN = 6
const ONE_MIN_MS = 60_000
const ipHits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < ONE_MIN_MS)
  hits.push(now)
  ipHits.set(ip, hits)
  return hits.length > IP_LIMIT_PER_MIN
}

export async function POST(req: NextRequest) {
  let body: { domain?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 422 })
  }

  const raw = typeof body.domain === 'string' ? body.domain : ''
  if (!isValidDomain(raw)) {
    return NextResponse.json({ error: 'invalid' }, { status: 422 })
  }
  const domain = cleanDomain(raw)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'timeout' }, { status: 429 })
  }

  // Run both probes in parallel; tolerate either failing.
  const [crawlSettled, psiSettled] = await Promise.allSettled([
    crawlSite(domain),
    runPageSpeed(domain),
  ])

  const crawl: CrawlResult =
    crawlSettled.status === 'fulfilled'
      ? crawlSettled.value
      : {
          ok: false,
          resolved: false,
          blocked: false,
          networkError: true,
          maxFormFields: null,
          formSource: null,
          hasAnalytics: false,
          hasPixel: false,
          trackingTools: [],
          h1Count: 0,
          hasH2: false,
          hasSchema: false,
        }

  const psi: PageSpeedMetrics | null =
    psiSettled.status === 'fulfilled' ? psiSettled.value : null

  // The site genuinely isn't reachable: the crawl hit a DNS/connection error
  // AND PageSpeed couldn't load it either. Send them back to the input.
  if (crawl.networkError && !crawl.resolved && psi == null) {
    return NextResponse.json({ error: 'unreachable' }, { status: 422 })
  }

  const result = buildAuditResult({ domain, psi, crawl })
  return NextResponse.json(result, { status: 200 })
}
