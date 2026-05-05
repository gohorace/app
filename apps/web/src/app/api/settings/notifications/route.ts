import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'

const schema = z.object({
  push_alert_mode:     z.enum(['threshold', 'all', 'hourly_digest']),
  alert_threshold:     z.number().int().min(1).max(999),
  briefing_emails:     z.array(z.string().email()).max(20),
  timezone:            z.string().min(1).max(100),
  daily_briefing_hour: z.number().int().min(0).max(23),
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
  const { data: agentRow } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agentRow) return NextResponse.json({ error: 'No agent found' }, { status: 400 })

  const { alert_threshold, ...rest } = parsed.data

  const { error } = await admin
    .from('agent_settings')
    .upsert(
      {
        agent_id: agentRow.id,
        ...rest,
        sms_threshold_score: alert_threshold,
      },
      { onConflict: 'agent_id' },
    )

  if (error) {
    console.error('Settings update error:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
