import { withApiV1 } from '@/lib/api-v1/auth'
import { ApiError } from '@/lib/api-v1/respond'
import { decodeId } from '@/lib/api-v1/ids'
import { queryEngagementList } from '@/lib/api-v1/engagement'

// GET /v1/properties/{id}/relationships
export const GET = withApiV1(async ({ req, workspaceId, db, params }) => {
  const propertyId = decodeId('prp', params.id ?? '')
  if (!propertyId) throw new ApiError('not_found', 'Property not found.')

  const { data: property } = await db
    .from('properties')
    .select('id')
    .eq('id', propertyId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!property) throw new ApiError('not_found', 'Property not found.')

  return queryEngagementList({ req, db, workspaceId, propertyId })
})
