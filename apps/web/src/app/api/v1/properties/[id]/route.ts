import { withApiV1 } from '@/lib/api-v1/auth'
import { ApiError, apiData } from '@/lib/api-v1/respond'
import { decodeId } from '@/lib/api-v1/ids'
import { mapProperty, type PropertyRow } from '@/lib/api-v1/mappers'

const PROPERTY_COLUMNS =
  'id, gnaf_address_detail_pid, street_number, street_name, suburb, state, postcode, created_at'

// GET /v1/properties/{id} — direct lookup within the agency's workspace.
export const GET = withApiV1(async ({ workspaceId, db, params }) => {
  const id = decodeId('prp', params.id ?? '')
  if (!id) throw new ApiError('not_found', 'Property not found.')

  const { data, error } = await db
    .from('properties')
    .select(PROPERTY_COLUMNS)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new ApiError('server_error', error.message)
  if (!data) throw new ApiError('not_found', 'Property not found.')

  return apiData(mapProperty(data as PropertyRow))
})
