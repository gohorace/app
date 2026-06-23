/**
 * Settings → Core markets (HOR-196)
 *
 * Lets an agent manage their core_markets outside the onboarding flow:
 * view current selections, archive one, add another. Mirrors the
 * pattern of the other settings sub-pages — server component loads
 * data, hands to a client component for interaction.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  CoreMarketsSettings,
  type CoreMarketRow,
} from '@/components/settings/core-markets-settings'

export const dynamic = 'force-dynamic'

export default async function CoreMarketsSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user!.id)
    .maybeSingle()

  if (!agent) {
    return <CoreMarketsSettings markets={[]} />
  }

  // Active markets. Most recent first so the agent sees their latest
  // pick at the top of the list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawMarkets } = await admin
    .from('core_markets' as any)
    .select('id, granularity, locality_pid, locality_name, state_abbrev, postcode, street_locality_pid, building_number_first, street_name, created_at')
    .eq('agent_id', agent.id)
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  type MarketRow = {
    id:                    string
    granularity:           CoreMarketRow['granularity']
    locality_pid:          string
    locality_name:         string
    state_abbrev:          string
    postcode:              string | null
    street_locality_pid:   string | null
    building_number_first: string | null
    street_name:           string | null
    created_at:            string
  }
  const marketRows = (rawMarkets as MarketRow[] | null) ?? []

  // Latest import status per market — drives the per-row status pill
  // (Importing… / Ready / Error). One query covers all markets.
  let statusByMarket = new Map<string, string>()
  if (marketRows.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: imports } = await admin
      .from('core_market_imports' as any)
      .select('core_market_id, status, enqueued_at')
      .in('core_market_id', marketRows.map((m) => m.id))
      .order('enqueued_at', { ascending: false })
    type ImportRow = { core_market_id: string; status: string }
    for (const i of (imports as ImportRow[] | null) ?? []) {
      // First seen (highest enqueued_at) wins because the order desc.
      if (!statusByMarket.has(i.core_market_id)) {
        statusByMarket.set(i.core_market_id, i.status)
      }
    }
  }

  const markets: CoreMarketRow[] = marketRows.map((m) => ({
    id:                    m.id,
    granularity:           m.granularity ?? 'suburb',
    locality_pid:          m.locality_pid,
    locality_name:         m.locality_name,
    state_abbrev:          m.state_abbrev,
    postcode:              m.postcode,
    street_locality_pid:   m.street_locality_pid,
    building_number_first: m.building_number_first,
    street_name:           m.street_name,
    created_at:            m.created_at,
    import_status: (statusByMarket.get(m.id) as CoreMarketRow['import_status']) ?? null,
  }))

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <CoreMarketsSettings markets={markets} />
    </div>
  )
}
