import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { markStepComplete, type OnboardingStep } from '@/lib/onboarding/state'

const ALLOWED: OnboardingStep[] = ['profile', 'script', 'contacts', 'notify', 'done']
const schema = z.object({
  step: z.enum(ALLOWED as [OnboardingStep, ...OnboardingStep[]]),
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  await markStepComplete(agent.id, parsed.data.step)
  return NextResponse.json({ ok: true })
}
