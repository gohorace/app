import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { PropertyRow } from '@/components/reference/types'
import { derivePropertySignal } from './derive-signal'
import { formatTimestamptz } from './format'

type Admin = ReturnType<typeof createAdminClient>

const CAP = 500

interface EngagementRow {
  property_id: string
  views_7d: number
  visitors: number
  last_viewed: string | null
  top_viewer_score: number
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

  const { data: rows } = await admin
    // latitude/longitude etc. lag the generated types — cast the from() ref,
    // same convention as the old properties page.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('properties' as any)
    .select('id, street_number, street_name, suburb, last_activity_at')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .limit(CAP)
  type Base = {
    id: string
    street_number: string | null
    street_name: string | null
    suburb: string | null
    last_activity_at: string | null
  }
  const base = (rows as Base[] | null) ?? []

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
