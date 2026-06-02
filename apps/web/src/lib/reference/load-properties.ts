import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { PropertyRow } from '@/components/reference/types'
import { derivePropertySignal } from './derive-signal'
import { formatTimestamptz } from './format'

type Admin = ReturnType<typeof createAdminClient>

// PostgREST caps every request at `max_rows` (1000 on this project — see
// supabase/config.toml), so a single .limit(N) silently truncates at 1000 no
// matter how high N is. The substrate table renders its row count + "of N"
// footer straight from the loaded array, so a truncated load = a wrong count.
// We therefore page through the workspace with .range() (PAGE_SIZE-sized
// requests, fetched in parallel) up to a safety ceiling. GNAF core-market
// imports push a single workspace well past 10k live properties; CAP sits
// above real volumes with headroom. If a workspace ever approaches CAP, move
// to true server-side range pagination (load only the visible page).
const PAGE_SIZE = 1000
const CAP = 25000

interface EngagementRow {
  property_id: string
  views_7d: number
  visitors: number
  last_viewed: string | null
  top_viewer_score: number
}

type Base = {
  id: string
  street_number: string | null
  street_name: string | null
  suburb: string | null
  last_activity_at: string | null
}

/**
 * Real data for the properties substrate table.
 *
 * Base rows come from `properties` (all workspace properties, including quiet
 * ones); `views_7d` / `visitors` / `last_viewed` and the top viewer score come
 * from the `get_reference_property_engagement_7d` RPC, left-joined in. Quiet
 * properties (no 7-day views) read as 0 views / `watching`. If the RPC isn't
 * applied yet the engagement columns degrade to 0 rather than erroring.
 */
export async function loadReferenceProperties(
  admin: Admin,
  opts: { workspaceId: string },
): Promise<PropertyRow[]> {
  const { workspaceId } = opts

  // Exact live count, so we know how many pages to pull (and the count is
  // truthful even in the rare case we hit CAP). head:true transfers no rows.
  const { count } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('properties' as any)
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  const total = Math.min(count ?? 0, CAP)
  const pageCount = Math.ceil(total / PAGE_SIZE)

  // Fetch every page in parallel. The secondary `id` sort is a stable
  // tiebreaker so range windows never overlap or skip rows when many rows
  // share a `last_activity_at` (e.g. the null-activity GNAF import set).
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) =>
      admin
        // latitude/longitude etc. lag the generated types — cast the from()
        // ref, same convention as the old properties page.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('properties' as any)
        .select('id, street_number, street_name, suburb, last_activity_at')
        .eq('workspace_id', workspaceId)
        .is('deleted_at', null)
        .order('last_activity_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .range(i * PAGE_SIZE, i * PAGE_SIZE + PAGE_SIZE - 1),
    ),
  )
  const base = pages.flatMap((r) => (r.data as Base[] | null) ?? [])

  const eng = new Map<string, EngagementRow>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await admin.rpc('get_reference_property_engagement_7d' as any, {
    p_workspace_id: workspaceId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  if (!error && Array.isArray(data)) {
    for (const r of data as EngagementRow[]) eng.set(r.property_id, r)
  }

  return base.map((p) => {
    const e = eng.get(p.id)
    const street = [p.street_number, p.street_name].filter(Boolean).join(' ').trim()
    const address = street
      ? (p.suburb ? `${street}, ${p.suburb}` : street)
      : (p.suburb || 'Address pending')
    return {
      id: p.id,
      address,
      views_7d: e?.views_7d ?? 0,
      visitors: e?.visitors ?? 0,
      top_signal: derivePropertySignal(e?.top_viewer_score ?? 0),
      last_viewed: formatTimestamptz(e?.last_viewed ?? p.last_activity_at),
    }
  })
}
