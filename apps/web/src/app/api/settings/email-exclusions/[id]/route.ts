/**
 * DELETE /api/settings/email-exclusions/[id]
 *
 * Removes an exclusion row. The agent CAN delete a seeded AU-default row
 * if they really want to (e.g. they genuinely send to *@realestate.com.au)
 * — we don't make it a hard refusal. The UI surfaces "you removed a
 * seeded default" wording so the consequence is obvious.
 *
 * 204 on success; 404 if the row doesn't exist or isn't owned by the
 * caller's agent.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!params?.id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const admin = createAdminClient()
  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })
  if (!agent) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  // Scope the delete by agent_id so a leaked id from another agent's row
  // can't be removed by this caller. service-role bypasses RLS so we enforce
  // ownership explicitly.
  const { data: row, error } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('agent_email_exclusions' as any)
    .delete()
    .eq('id', params.id)
    .eq('agent_id', agent.id)
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to remove exclusion' }, { status: 500 })
  }
  if (!row) {
    return NextResponse.json({ error: 'Exclusion not found' }, { status: 404 })
  }
  return new NextResponse(null, { status: 204 })
}
