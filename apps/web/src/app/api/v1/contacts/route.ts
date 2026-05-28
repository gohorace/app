import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiV1 } from '@/lib/api-v1/auth'
import { ApiError, apiData, apiList } from '@/lib/api-v1/respond'
import {
  parseLimit,
  parseTimestamp,
  parseEnum,
  cursorOrExpr,
  sliceCursor,
} from '@/lib/api-v1/cursor'
import { mapContact, ingestionMethodsForSource, type ContactRow } from '@/lib/api-v1/mappers'
import { encodeId } from '@/lib/api-v1/ids'

const CONTACT_COLUMNS =
  'id, email, phone, first_name, last_name, source, ingestion_method, external_ids, created_at, updated_at'

const SOURCES = [
  'doorstep_buyer_enquiry',
  'doorstep_appraisal_request',
  'manual',
  'api',
  'crm_sync',
] as const

// GET /v1/contacts — agency-wide list, newest-changed-last (updated_at ASC).
export const GET = withApiV1(async ({ req, workspaceId, db }) => {
  const sp = req.nextUrl.searchParams
  const limit = parseLimit(sp.get('limit'))
  const updatedSince = parseTimestamp(sp.get('updated_since'), 'updated_since')
  const source = parseEnum(sp.get('source'), SOURCES, 'source')

  let q = db
    .from('contacts')
    .select(CONTACT_COLUMNS)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  if (updatedSince) q = q.gte('updated_at', updatedSince)
  if (source) {
    if (source === 'manual') {
      // NULL ingestion_method also projects to 'manual'.
      q = q.or('ingestion_method.in.(manual,csv_import),ingestion_method.is.null')
    } else {
      const methods = ingestionMethodsForSource(source)
      q = q.in('ingestion_method', methods.length ? methods : ['__none__'])
    }
  }

  const orExpr = cursorOrExpr('updated_at', sp.get('cursor'))
  if (orExpr) q = q.or(orExpr)

  q = q.order('updated_at', { ascending: true }).order('id', { ascending: true })

  const { data, error } = await q.limit(limit + 1)
  if (error) throw new ApiError('server_error', error.message)

  const { rows, nextCursor } = sliceCursor(data as ContactRow[], limit, 'updated_at')
  return apiList(rows.map(mapContact), nextCursor)
})

const CreateContactSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  external_ids: z.record(z.string()).optional(),
})

// POST /v1/contacts — create. email or phone required; source becomes 'api'.
export const POST = withApiV1(async ({ req, workspaceId, db }) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ApiError('validation_error', 'Request body must be valid JSON.')
  }

  const parsed = CreateContactSchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ApiError('validation_error', issue?.message ?? 'Invalid request body.', {
      field: issue?.path.join('.') || undefined,
    })
  }
  const v = parsed.data
  const email = v.email ? v.email.toLowerCase().trim() : null
  const phone = v.phone ? v.phone.trim() : null
  if (!email && !phone) {
    throw new ApiError('validation_error', 'Provide an email or a phone number.', {
      field: 'email',
    })
  }

  // Agency-pushed contacts have no specific agent — they're owned by the
  // workspace default agent, the same routing embed captures use.
  const { data: ws, error: wsErr } = await db
    .from('workspaces')
    .select('default_agent_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (wsErr) throw new ApiError('server_error', wsErr.message)
  const ownerAgentId = ws?.default_agent_id as string | undefined
  if (!ownerAgentId) {
    throw new ApiError('server_error', 'This agency has no default agent to own the contact.')
  }

  if (email) {
    const { data: existing } = await db
      .from('contacts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .is('deleted_at', null)
      .maybeSingle()
    if (existing) {
      // 409 carries the existing contact's ID so the caller can PATCH instead.
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

  const fullName =
    [v.first_name, v.last_name]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(' ') || null

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      workspace_id: workspaceId,
      agent_id: ownerAgentId,
      owner_agent_id: ownerAgentId,
      created_by_agent_id: ownerAgentId,
      email,
      phone,
      first_name: v.first_name?.trim() || null,
      last_name: v.last_name?.trim() || null,
      full_name_raw: fullName,
      source: 'manual',
      ingestion_method: 'api',
      external_ids: v.external_ids ?? {},
      identified_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .select(CONTACT_COLUMNS)
    .single()

  if (error || !created) {
    // UNIQUE(agent_id, email) also covers soft-deleted rows the pre-check skips.
    if ((error as { code?: string } | null)?.code === '23505') {
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
    throw new ApiError('server_error', error?.message ?? 'Failed to create contact.')
  }

  return apiData(mapContact(created as ContactRow), { status: 201 })
})
