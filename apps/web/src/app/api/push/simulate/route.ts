import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scoreEventsForContact, getAgentScoringOverrides } from '@/lib/scoring/engine'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

/**
 * POST /api/push/simulate
 * Directly fires a return_visit event for the agent's highest-scoring contact.
 * Used to verify the scoring → notification pipeline works end-to-end,
 * bypassing the tracker and identity_map lookup.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const agent = await resolvePrimaryAgent(admin, user.id)

  if (!agent) return NextResponse.json({ error: 'No agent found' }, { status: 400 })

  // Pick the highest-scoring identified contact
  const { data: contact } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email')
    .eq('agent_id', agent.id)
    .not('identified_at', 'is', null)
    .order('score', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!contact) {
    return NextResponse.json({
      error: 'No identified contacts found. A contact must have submitted a form on your site first.',
    }, { status: 400 })
  }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || 'Contact'

  const overrides = await getAgentScoringOverrides(admin, agent.id)
  const result = await scoreEventsForContact(
    admin,
    agent.id,
    contact.id,
    [{ session_id: 'simulate-' + Date.now(), event_type: 'return_visit', properties: { url: '/simulate' } }],
    overrides,
  )

  return NextResponse.json({
    ok: true,
    contact: name,
    contactId: contact.id,
    scoreDelta: result.delta,
    newScore: result.newScore,
  })
}
