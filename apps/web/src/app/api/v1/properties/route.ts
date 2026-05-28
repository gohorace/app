import { withApiV1 } from '@/lib/api-v1/auth'
import { ApiError, apiList } from '@/lib/api-v1/respond'
import { parseLimit, parseTimestamp, cursorOrExpr, sliceCursor } from '@/lib/api-v1/cursor'
import { mapProperty, type PropertyRow } from '@/lib/api-v1/mappers'

const PROPERTY_COLUMNS =
  'id, gnaf_address_detail_pid, street_number, street_name, suburb, state, postcode, created_at'

// GET /v1/properties — only properties with >=1 relationship to the agency's
// contacts (i.e. present in the engagement rollup). Ordered by created_at ASC.
export const GET = withApiV1(async ({ req, workspaceId, db }) => {
  const sp = req.nextUrl.searchParams
  const limit = parseLimit(sp.get('limit'))
  const updatedSince = parseTimestamp(sp.get('updated_since'), 'updated_since')
  const suburb = sp.get('suburb')?.trim() || undefined

  // Scope to engaged properties. Workspace property counts are capped (~500),
  // so the id set stays small; revisit with a join/RPC if that cap lifts.
  const { data: engaged, error: eErr } = await db
    .from('contact_property_engagement')
    .select('property_id')
    .eq('workspace_id', workspaceId)
  if (eErr) throw new ApiError('server_error', eErr.message)

  const propIds = Array.from(new Set((engaged ?? []).map((r) => r.property_id as string)))
  if (propIds.length === 0) return apiList([], null)

  let q = db
    .from('properties')
    .select(PROPERTY_COLUMNS)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .in('id', propIds)

  if (updatedSince) q = q.gte('updated_at', updatedSince)
  if (suburb) q = q.ilike('suburb', suburb)

  const orExpr = cursorOrExpr('created_at', sp.get('cursor'))
  if (orExpr) q = q.or(orExpr)

  q = q.order('created_at', { ascending: true }).order('id', { ascending: true })

  const { data, error } = await q.limit(limit + 1)
  if (error) throw new ApiError('server_error', error.message)

  const { rows, nextCursor } = sliceCursor(data as PropertyRow[], limit, 'created_at')
  return apiList(rows.map(mapProperty), nextCursor)
})
