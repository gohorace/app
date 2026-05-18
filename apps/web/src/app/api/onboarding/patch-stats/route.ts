import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { PatchStat, PatchStatsResponse } from './types'

/**
 * GET /api/onboarding/patch-stats?pid=…&pid=…  — stub.
 *
 * Returns per-locality sales/median stubs the Turn 3 (HOR-210) pill row
 * uses to render placeholder values until a real property-data vendor
 * is wired. The brief's verbatim copy ("312 sales across those three
 * in the last 12 months. Median $X") needs sales count + median price
 * per locality — neither of which we have in G-NAF.
 *
 * The vendor selection is still an open question in CLAUDE.md
 * ("Property data vendor (CoreLogic / Domain / PropTrack / other)").
 * This route exists so:
 *   1. Turn 3 doesn't carry a TODO branch — it always fetches a
 *      well-formed response and renders dashes when the values are null.
 *   2. When the vendor lands, swapping the body in here is the entire
 *      integration change; no UI work needed.
 *
 * Repeats `pid` for multiple localities: `?pid=loc_a&pid=loc_b`.
 * Returns `{ stats: Array<{ pid, sales_90d, median_price }> }`.
 *
 * Auth-gated to match every other onboarding endpoint.
 *
 * Types live in ./types — Next.js 14 disallows non-route exports from
 * route.ts.
 */

const MAX_PIDS = 3 // matches the SuburbPicker hard cap

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const pids = url.searchParams.getAll('pid').map((p) => p.trim()).filter(Boolean)
  if (pids.length === 0) {
    const res: PatchStatsResponse = { stats: [] }
    return NextResponse.json(res)
  }
  if (pids.length > MAX_PIDS) {
    return NextResponse.json(
      { error: `At most ${MAX_PIDS} pids per request` },
      { status: 400 },
    )
  }

  // Stub: real vendor integration replaces this body. The endpoint
  // contract is the entire commitment — UI never changes when the data
  // lights up.
  const stats: PatchStat[] = pids.map((pid) => ({
    pid,
    sales_90d: null,
    median_price: null,
  }))

  return NextResponse.json({ stats } satisfies PatchStatsResponse)
}
