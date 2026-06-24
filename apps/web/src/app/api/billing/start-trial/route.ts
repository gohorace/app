import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { startTrialForUser } from '@/lib/billing/start-trial'

const bodySchema = z.object({
  plan: z.enum(['pro_monthly', 'pro_annual']),
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
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const admin = createAdminClient()

  const result = await startTrialForUser({
    admin,
    userId: user.id,
    email: user.email ?? null,
    plan: parsed.data.plan,
  })

  if (!result.ok) {
    const status =
      result.code === 'already_active' ? 409 :
      result.code === 'no_workspace' ? 400 :
      500
    return NextResponse.json(
      result.code === 'already_active'
        ? { error: result.message, subscription_status: result.subscription_status }
        : { error: result.message },
      { status },
    )
  }

  return NextResponse.json({
    subscription_id: result.subscription_id,
    status: result.status,
  })
}
