import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiV1 } from '@/lib/api-v1/auth'
import { ApiError, apiData } from '@/lib/api-v1/respond'
import { decodeId, encodeId } from '@/lib/api-v1/ids'
import { mapContact, type ContactRow } from '@/lib/api-v1/mappers'

const CONTACT_COLUMNS =
  'id, email, phone, first_name, last_name, source, ingestion_method, external_ids, created_at, updated_at'

// GET /v1/contacts/{id}
export const GET = withApiV1(async ({ workspaceId, db, params }) => {
  const id = decodeId('con', params.id ?? '')
  if (!id) throw new ApiError('not_found', 'Contact not found.')

  const { data, error } = await db
    .from('contacts')
    .select(CONTACT_COLUMNS)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new ApiError('server_error', error.message)
  if (!data) throw new ApiError('not_found', 'Contact not found.')

  return apiData(mapContact(data as ContactRow))
})

// Partial update. Only provided fields change; a provided `external_ids`
// replaces the whole map (per "only provided fields are updated").
const UpdateContactSchema = z.object({
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  external_ids: z.record(z.string()).optional(),
})

// PATCH /v1/contacts/{id}
export const PATCH = withApiV1(async ({ req, workspaceId, db, params }) => {
  const id = decodeId('con', params.id ?? '')
  if (!id) throw new ApiError('not_found', 'Contact not found.')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ApiError('validation_error', 'Request body must be valid JSON.')
  }

  const parsed = UpdateContactSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ApiError('validation_error', issue?.message ?? 'Invalid request body.', {
      field: issue?.path.join('.') || undefined,
    })
  }
  const v = parsed.data

  const update: Record<string, unknown> = {}
  if ('email' in v) update.email = v.email ? v.email.toLowerCase().trim() : null
  if ('phone' in v) update.phone = v.phone ? v.phone.trim() : null
  if ('first_name' in v) update.first_name = v.first_name?.trim() || null
  if ('last_name' in v) update.last_name = v.last_name?.trim() || null
  if ('external_ids' in v && v.external_ids) update.external_ids = v.external_ids

  if (Object.keys(update).length === 0) {
    throw new ApiError('validation_error', 'No updatable fields provided.')
  }

  if (typeof update.email === 'string') {
    const { data: existing } = await db
      .from('contacts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('email', update.email)
      .is('deleted_at', null)
      .neq('id', id)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        {
          error: {
            type: 'conflict',
            message: 'A contact with this email already exists.',
            field: 'email',
          },
          existing_id: encodeId('con', existing.id as string),
        },
        { status: 409 },
      )
    }
  }

  const { data, error } = await db
    .from('contacts')
    .update(update)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .select(CONTACT_COLUMNS)
    .maybeSingle()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json(
        {
          error: {
            type: 'conflict',
            message: 'A contact with this email already exists.',
            field: 'email',
          },
        },
        { status: 409 },
      )
    }
    throw new ApiError('server_error', error.message)
  }
  if (!data) throw new ApiError('not_found', 'Contact not found.')

  return apiData(mapContact(data as ContactRow))
})
