import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/agent/flow  { flow: 'agentic' | 'classic' }
 *
 * Persists the agent's preferred onboarding shell. Called fire-and-
 * forget by the v2 escape hatch + inline bail prompt so subsequent
 * reloads of /onboarding go straight to the classic wizard (rather
 * than re-routing to /agentic and forcing the agent to click bail
 * again).
 *
 * Mirror of the v1-bail experience: the click that takes you to the
 * classic flow also locks it in. The chooser at /onboarding reads
 * agents.onboarding_flow and respects the value.
 *
 * Returns 200 with `{ ok: true }` so the caller can fire-and-forget
 * without checking the response. Auth-gated.
 */

const schema = z.object({
  flow: z.enum(['agentic', 'classic']),
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid flow' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // database.types.ts lags the 20260518000040 migration. Cast at the
  // boundary until next `supabase gen types` regen — same pattern as
  // lib/onboarding/state.ts:57.
  const { error } = await admin
    .from('agents')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ onboarding_flow: parsed.data.flow } as any)
    .eq('id', agent.id)

  if (error) {
    console.error('[agent/flow] update error', error)
    return NextResponse.json({ error: 'Failed to update flow' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
