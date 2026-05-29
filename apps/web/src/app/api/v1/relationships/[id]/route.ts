import { withApiV1 } from '@/lib/api-v1/auth'
import { ApiError, apiData } from '@/lib/api-v1/respond'
import { decodeId } from '@/lib/api-v1/ids'
import { mapRelationship, type EngagementRow } from '@/lib/api-v1/mappers'

const ENGAGEMENT_COLUMNS =
  'id, contact_id, property_id, type, first_engaged_at, last_engaged_at, engagement_count'

// GET /v1/relationships/{id}
export const GET = withApiV1(async ({ workspaceId, db, params }) => {
  const id = decodeId('rel', params.id ?? '')
  if (!id) throw new ApiError('not_found', 'Relationship not found.')

  const { data, error } = await db
    .from('contact_property_engagement')
    .select(ENGAGEMENT_COLUMNS)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw new ApiError('server_error', error.message)
  if (!data) throw new ApiError('not_found', 'Relationship not found.')

  return apiData(mapRelationship(data as EngagementRow))
})
