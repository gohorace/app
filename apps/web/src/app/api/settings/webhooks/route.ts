/**
 * HOR-323 · Webhook endpoint management (admin-only, workspace-scoped).
 *
 * GET  — list the agency's webhook endpoints (no secret).
 * POST — create an endpoint; the signing secret is generated, stored in Vault,
 *        and returned ONCE so the receiver can verify signatures.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createApiV1Db } from '@/lib/api-v1/db'
import { resolveAdminContext } from '@/lib/api-v1/admin-guard'
import { mintWebhookSecret } from '@/lib/api-v1/webhooks'

const createSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), 'Webhook URL must be https.'),
  events: z
    .array(
      z.enum([
        'contact.created',
        'contact.updated',
        'relationship.created',
        'relationship.updated',
      ]),
    )
    .min(1, 'Pick at least one event.'),
  description: z.string().max(200).optional(),
})

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createApiV1Db()
  const ctx = await resolveAdminContext(db, user.id)
  if (!ctx) return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  if (!ctx.isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const { data, error } = await db
    .from('webhook_endpoints')
    .select(
      'id, url, description, events, enabled, status, last_delivery_at, last_error, created_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to load webhooks' }, { status: 500 })
  return NextResponse.json({ endpoints: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json({ error: issue?.message ?? 'Invalid input' }, { status: 400 })
  }

  const db = createApiV1Db()
  const ctx = await resolveAdminContext(db, user.id)
  if (!ctx) return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  if (!ctx.isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  // Generate + vault-store the signing secret.
  const secret = mintWebhookSecret()
  const { data: secretId, error: secretErr } = await db.rpc('store_integration_secret', {
    p_secret_text: secret,
    p_name: `webhook_signing_secret_${ctx.workspaceId}`,
  })
  if (secretErr || !secretId) {
    return NextResponse.json({ error: 'Failed to store signing secret' }, { status: 500 })
  }

  const { data: row, error } = await db
    .from('webhook_endpoints')
    .insert({
      workspace_id: ctx.workspaceId,
      url: parsed.data.url,
      description: parsed.data.description ?? null,
      events: parsed.data.events,
      secret_id: secretId,
      created_by_agent_id: ctx.agentId,
    })
    .select('id, url, description, events, enabled, status, created_at')
    .single()

  if (error || !row) {
    // Don't leave an orphaned vault secret behind.
    await db.rpc('delete_integration_secret', { p_secret_id: secretId })
    return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 })
  }

  // Secret shown exactly once.
  return NextResponse.json({ endpoint: row, secret })
}
