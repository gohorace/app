/**
 * HOR-203 — POST /api/billing/seats/support
 *
 * Explicit add/remove of support seats on a workspace's subscription.
 * Most paths go through the invite flow (which calls `adjustSupportSeats`
 * directly), but this endpoint exists for:
 *   - admin tooling
 *   - reconciliation when invite UI gets out of sync with Stripe
 *   - tests
 *
 * Body: { delta: number } — positive = add, negative = remove.
 *
 * ACL: owner/admin on workspace_members for the caller's workspace.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adjustSupportSeats } from '@/lib/stripe/support-seats'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

const bodySchema = z.object({
  delta: z.number().int(),
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let parsed
  try {
    parsed = bodySchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }
  const { delta } = parsed.data
  if (delta === 0) {
    return NextResponse.json({ quantity: 0, subscriptionItemId: null })
  }

  const admin = createAdminClient()

  // Resolve the caller's own workspace via their agent seat.
  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })

  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  // ACL: billing/seat management is Admin-only (HOR-377; canonical agents.role).
  if (agent.role !== 'admin') {
    return NextResponse.json({ error: 'Billing is managed by an admin.' }, { status: 403 })
  }

  try {
    const result = await adjustSupportSeats(agent.workspace_id, delta)
    if (!result) {
      // No subscription yet — nothing to bill against. Caller treats as a
      // no-op; the invite/seat row still exists in the db.
      return NextResponse.json({ quantity: 0, subscriptionItemId: null, note: 'no_subscription' })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('adjustSupportSeats failed', { workspaceId: agent.workspace_id, delta, err })
    return NextResponse.json({ error: 'Stripe call failed' }, { status: 502 })
  }
}
