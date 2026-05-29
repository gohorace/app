/**
 * HOR-323 · Update (pause/resume, edit) or delete a webhook endpoint. Admin-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), 'Webhook URL must be https.')
    .optional(),
  events: z
    .array(
      z.enum([
        'contact.created',
        'contact.updated',
        'relationship.created',
        'relationship.updated',
      ]),
    )
    .min(1)
    .optional(),
  description: z.string().max(200).nullable().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ error: issue?.message ?? 'Invalid input' }, { status: 400 })
  }

  const db = createApiV1Db()
  const ctx = await resolveAdminContext(db, user.id)
  if (!ctx) return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  if (!ctx.isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const v = parsed.data
  const update: Record<string, unknown> = {}
  if ('url' in v) update.url = v.url
  if ('events' in v) update.events = v.events
  if ('description' in v) update.description = v.description
  if ('enabled' in v) {
    update.enabled = v.enabled
    // Pausing disables; resuming clears a failing state.
    update.status = v.enabled ? 'active' : 'disabled'
    if (v.enabled) update.last_error = null
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await db
    .from('webhook_endpoints')
    .update(update)
    .eq('id', params.id)
    .eq('workspace_id', ctx.workspaceId)
    .select(
      'id, url, description, events, enabled, status, last_delivery_at, last_error, created_at',
    )
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  return NextResponse.json({ endpoint: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createApiV1Db()
  const ctx = await resolveAdminContext(db, user.id)
  if (!ctx) return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  if (!ctx.isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  // Grab the secret pointer first so we can clean up Vault after the row goes.
  const { data: existing } = await db
    .from('webhook_endpoints')
    .select('secret_id')
    .eq('id', params.id)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

  const { error } = await db
    .from('webhook_endpoints')
    .delete()
    .eq('id', params.id)
    .eq('workspace_id', ctx.workspaceId)
  if (error) return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 })

  if (existing.secret_id) {
    await db.rpc('delete_integration_secret', { p_secret_id: existing.secret_id })
  }
  return NextResponse.json({ ok: true })
}
