import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

/**
 * POST /api/onboarding/site-probe — stub.
 *
 * PR 3 (this file) ships the contract; PR 4 fills in the real fetcher,
 * CMS heuristics, listings counter, and the failure reasons that drive
 * the "two probe fails → bail" rule.
 *
 * The stub validates URL shape (so the client can exercise the
 * "unreachable" path with garbage input in dev) and otherwise returns
 * a happy-path response with listings=0, cms='unknown'. The UI is
 * already designed to handle those values gracefully — pills render
 * "Site found" rather than "47 listings · WordPress" until PR 4.
 *
 * Auth-gated to match every other onboarding endpoint.
 */

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

export type SiteProbeResponse =
  | { ok: true; finalUrl: string; host: string; listings: number; cms: CmsKind }
  | { ok: false; reason: 'unreachable' | 'blocked' | 'parse' | 'timeout' }

const schema = z.object({
  url: z.string().min(1).max(2048),
})

function normaliseUrl(input: string): URL | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    // Reject obvious LANs even at validation time — PR 4 will tighten this.
    const host = u.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.endsWith('.local')
    ) {
      return null
    }
    return u
  } catch {
    return null
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

  // PR 3 stub — always happy path. PR 4 swaps this for the real fetch
  // + CMS detection + listings count + structured error reasons.
  const res: SiteProbeResponse = {
    ok: true,
    finalUrl: url.toString(),
    host: url.hostname,
    listings: 0,
    cms: 'unknown',
  }
  return NextResponse.json(res, { status: 200 })
}
