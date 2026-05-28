import { withApiV1 } from '@/lib/api-v1/auth'
import { ApiError } from '@/lib/api-v1/respond'
import { parseTimestamp, parseEnum } from '@/lib/api-v1/cursor'
import { decodeId } from '@/lib/api-v1/ids'
import { queryEngagementList } from '@/lib/api-v1/engagement'

const TYPES = [
  'doorstep_buyer_enquiry',
  'doorstep_appraisal_request',
  'website_engagement',
] as const

// GET /v1/relationships — filters: contact_id, property_id, type, updated_since.
export const GET = withApiV1(async ({ req, workspaceId, db }) => {
  const sp = req.nextUrl.searchParams
  const type = parseEnum(sp.get('type'), TYPES, 'type')
  const updatedSince = parseTimestamp(sp.get('updated_since'), 'updated_since')

  let contactId: string | undefined
  const rawContact = sp.get('contact_id')
  if (rawContact) {
    const d = decodeId('con', rawContact)
    if (!d) throw new ApiError('validation_error', 'Invalid contact_id.', { field: 'contact_id' })
    contactId = d
  }

  let propertyId: string | undefined
  const rawProp = sp.get('property_id')
  if (rawProp) {
    const d = decodeId('prp', rawProp)
    if (!d) throw new ApiError('validation_error', 'Invalid property_id.', { field: 'property_id' })
    propertyId = d
  }

  return queryEngagementList({ req, db, workspaceId, contactId, propertyId, type, updatedSince })
})
