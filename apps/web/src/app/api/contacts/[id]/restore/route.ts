import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/contacts/:id/restore
 * Clears `deleted_at` if the contact was soft-deleted within the last 30 days.
 *
 * - 404 if the contact doesn't exist or isn't owned by the requesting agent.
 * - 200 + { mode: 'noop' } if the contact wasn't deleted to begin with.
 * - 410 Gone if the 30-day window has expired (the cron will hard-delete it).
 * - 200 + { mode: 'restored' } on success.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
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

  const { data: contact } = await admin
    .from('contacts')
    .select('id, deleted_at')
    .eq('id', params.id)
    .eq('agent_id', agent.id)
    .maybeSingle()

  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!contact.deleted_at) {
    return NextResponse.json({ ok: true, mode: 'noop' })
  }

  // 30-day window enforced server-side rather than via DB constraint so we can
  // return a meaningful 410. Keeps deterministic with the cron's purge cutoff.
  const deletedAtMs = new Date(contact.deleted_at).getTime()
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  if (Date.now() - deletedAtMs > thirtyDaysMs) {
    return NextResponse.json(
      {
        error: 'Restore window expired',
        deleted_at: contact.deleted_at,
        window_days: 30,
      },
      { status: 410 },
    )
  }

  const { error } = await admin
    .from('contacts')
    .update({ deleted_at: null })
    .eq('id', params.id)
    .eq('agent_id', agent.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mode: 'restored' })
}
