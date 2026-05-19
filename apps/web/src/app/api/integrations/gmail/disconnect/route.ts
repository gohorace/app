/**
 * POST /api/integrations/gmail/disconnect
 *
 * Flips the agent's Gmail integration to `disconnected`, deletes the vault
 * secret, and best-effort revokes the refresh_token with Google. The
 * agent_integrations row is retained for history (audit trail of past
 * connections).
 *
 * Idempotent: 200 even when there was nothing to disconnect.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { disconnectGmail } from '@/lib/email/integrations'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .not('workspace_id', 'is', null)
    .maybeSingle()

  if (!agent) {
    return NextResponse.json({ error: 'No agent found' }, { status: 400 })
  }

  try {
    await disconnectGmail(admin, agent.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[gmail/disconnect] error:', err)
    return NextResponse.json({ error: 'Disconnect failed' }, { status: 500 })
  }
}
