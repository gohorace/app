/**
 * DELETE /api/core-markets/[id]
 *
 * Archive a core market. Calls the SECURITY DEFINER
 * `archive_core_market(p_core_market_id, p_agent_id)` RPC, which:
 *   1. Verifies the row belongs to the calling agent and isn't already
 *      archived. RAISES on mismatch — surfaced as a 404 here.
 *   2. Soft-deletes properties in that locality that have no linked
 *      contacts (residence_property_id or contact_property_relationships).
 *   3. Sets archived_at on the core_markets row.
 *   4. Returns the count of properties archived.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // The RPC handles ownership + state checks. We only need to surface
  // the RAISE EXCEPTION cleanly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await admin.rpc('archive_core_market' as any, {
    p_core_market_id: id,
    p_agent_id:       agent.id,
  })

  if (error) {
    // SQLSTATE 02000 = no_data_found (raised by the RPC when the
    // market isn't found / not owned / already archived).
    if ((error as { code?: string }).code === '02000') {
      return NextResponse.json({ error: 'Core market not found' }, { status: 404 })
    }
    console.error('[core-markets/delete] rpc error', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const archivedProperties = typeof data === 'number' ? data : 0
  return NextResponse.json({ archived_properties: archivedProperties })
}
