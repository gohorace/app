import { withApiV1 } from '@/lib/api-v1/auth'
import { ApiError } from '@/lib/api-v1/respond'
import { decodeId } from '@/lib/api-v1/ids'
import { queryEngagementList } from '@/lib/api-v1/engagement'

// GET /v1/contacts/{id}/relationships
export const GET = withApiV1(async ({ req, workspaceId, db, params }) => {
  const contactId = decodeId('con', params.id ?? '')
  if (!contactId) throw new ApiError('not_found', 'Contact not found.')

  const { data: contact } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!contact) throw new ApiError('not_found', 'Contact not found.')

  return queryEngagementList({ req, db, workspaceId, contactId })
})
