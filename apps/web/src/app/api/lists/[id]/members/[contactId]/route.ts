import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// HOR-142  DELETE /api/lists/[id]/members/[contactId]
//
// Remove a single contact from a list. Idempotent — deleting a non-member is
// a 200, not a 404, so the AddToListSheet can flip checkboxes optimistically
// without racing.

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; contactId: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // Ownership check on the list before we touch the membership table.
  const { data: list } = await admin
    .from('lists')
    .select('id')
    .eq('id', params.id)
    .eq('workspace_id', agent.workspace_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 })

  const { error } = await admin
    .from('contact_list_membership')
    .delete()
    .eq('list_id', list.id)
    .eq('contact_id', params.contactId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Surface change reflected in list ordering.
  await admin
    .from('lists')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', list.id)

  return NextResponse.json({ ok: true })
}
