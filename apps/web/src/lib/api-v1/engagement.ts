/**
 * HOR-321 · Public API v1 — shared relationship (engagement) list query.
 *
 * Backs three endpoints: GET /v1/relationships, GET /v1/contacts/{id}/relationships,
 * and GET /v1/properties/{id}/relationships. Cursor-paginated over
 * (last_engaged_at ASC, id ASC); optional contact/property/type/updated_since
 * filters are AND-ed in by the caller.
 */
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError, apiList } from './respond'
import { parseLimit, cursorOrExpr, sliceCursor } from './cursor'
import { mapRelationship, type EngagementRow, type RelationshipType } from './mappers'

const ENGAGEMENT_COLUMNS =
  'id, contact_id, property_id, type, first_engaged_at, last_engaged_at, engagement_count'

export async function queryEngagementList(opts: {
  req: NextRequest
  db: SupabaseClient
  workspaceId: string
  contactId?: string
  propertyId?: string
  type?: RelationshipType
  updatedSince?: string
}): Promise<NextResponse> {
  const { req, db, workspaceId } = opts
  const sp = req.nextUrl.searchParams
  const limit = parseLimit(sp.get('limit'))

  let q = db
    .from('contact_property_engagement')
    .select(ENGAGEMENT_COLUMNS)
    .eq('workspace_id', workspaceId)

  if (opts.contactId) q = q.eq('contact_id', opts.contactId)
  if (opts.propertyId) q = q.eq('property_id', opts.propertyId)
  if (opts.type) q = q.eq('type', opts.type)
  if (opts.updatedSince) q = q.gte('updated_at', opts.updatedSince)

  const orExpr = cursorOrExpr('last_engaged_at', sp.get('cursor'))
  if (orExpr) q = q.or(orExpr)

  q = q.order('last_engaged_at', { ascending: true }).order('id', { ascending: true })

  const { data, error } = await q.limit(limit + 1)
  if (error) throw new ApiError('server_error', error.message)

  const { rows, nextCursor } = sliceCursor(data as EngagementRow[], limit, 'last_engaged_at')
  return apiList(rows.map(mapRelationship), nextCursor)
}
