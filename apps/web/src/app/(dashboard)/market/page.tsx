import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAttentionCount } from '@/lib/notifications/attention-count'
import { MarketView } from '@/components/market/market-view'
// isTimeWindow is imported straight from the lib — NOT re-exported through
// market-view.tsx. That file is `'use client'`, and a server component
// importing any value from a client module receives a client-reference
// proxy, not the real function (crashes with "c is not a function" at
// render). Pure helpers a server page needs must come from a server-safe
// (or shared) module.
import { isTimeWindow, type TimeWindow } from '@/lib/map/rpc-types'

/**
 * /market — the v2 dedicated Market route (HOR-245).
 *
 * Replaces the v2-M1 stub. Lifts the shipped HOR-215 map surface out of
 * `/properties` and restyles pins/overlay/slider for v2 fidelity. The
 * underlying `MapPayload` shape, RPCs, and `PropertiesMap` heat/cluster
 * infrastructure carry over unchanged — only the pin geometry, the
 * overlay shape, and the slider rail visual are different.
 *
 * Server work: resolve agent + workspace, compute the map's fallback
 * centroid from the agent's first core market (so a no-property
 * workspace still sees their patch of Australia), and fetch the bell
 * attention count. The map payload itself is fetched client-side on
 * mount to keep this page snappy + cookie-aware.
 */

export const dynamic = 'force-dynamic'

interface SearchParams {
  timeWindow?: string
}

export default async function MarketPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent?.workspace_id) redirect('/signup')

  const attentionCount = await fetchAttentionCount(admin, agent.id)
  const fallbackCenter = await resolveFallbackCenter(admin, agent.id)

  const initialTimeWindow: TimeWindow = isTimeWindow(searchParams.timeWindow)
    ? searchParams.timeWindow
    : '7d'

  return (
    <MarketView
      initialPayload={null}
      initialTimeWindow={initialTimeWindow}
      fallbackCenter={fallbackCenter}
      attentionCount={attentionCount}
    />
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the agent's first core market's centroid for the map fallback.
 * Same pattern `/properties/page.tsx` uses for the embedded map view.
 * Returns null when the agent has no core market set; PropertiesMap
 * falls back to its own default (HORACE_HQ_FALLBACK) in that case.
 */
async function resolveFallbackCenter(
  admin: ReturnType<typeof createAdminClient>,
  agentId: string,
): Promise<{ lat: number; lng: number } | null> {
  const { data: rawMarkets } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('core_markets' as any)
    .select('locality_pid')
    .eq('agent_id', agentId)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(1)

  type MarketRow = { locality_pid: string }
  const first = (rawMarkets as MarketRow[] | null)?.[0]
  if (!first) return null

  const { data: localities } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .schema('gnaf' as any)
    .from('localities' as any)
    .select('latitude, longitude')
    .eq('locality_pid', first.locality_pid)
    .maybeSingle()

  type LocalityRow = { latitude: number | null; longitude: number | null }
  const l = localities as LocalityRow | null
  if (!l || l.latitude == null || l.longitude == null) return null

  return { lat: l.latitude, lng: l.longitude }
}
