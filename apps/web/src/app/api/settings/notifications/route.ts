import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const schema = z.object({
  sms_enabled: z.boolean(),
  agent_phone: z.string().max(20).nullable(),
  sms_threshold_score: z.number().int().min(1).max(999),
  agent_email: z.string().email().nullable(),
  weekly_briefing_day: z.number().int().min(0).max(6),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No organisation' }, { status: 400 })

  const { error } = await admin
    .from('org_settings')
    .update(parsed.data)
    .eq('org_id', membership.org_id)

  if (error) {
    console.error('Settings update error:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
