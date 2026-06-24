import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

const schema = z.object({
  push_alert_mode:     z.enum(['threshold', 'all', 'hourly_digest']),
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
  const agentRow = await resolvePrimaryAgent(admin, user.id)

  if (!agentRow) return NextResponse.json({ error: 'No agent found' }, { status: 400 })

  const { error } = await admin
    .from('agent_settings')
    .upsert(
      { agent_id: agentRow.id, ...parsed.data },
      { onConflict: 'agent_id' },
    )

  if (error) {
    console.error('Settings update error:', error)
    return NextResponse.json({ error: error.message ?? 'Failed to save settings' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// Partial update — used by the Profile section (HOR-329), which edits the
// agent's time zone (canonical on agent_settings, shared with the daily
// briefing) without touching the rest of the notification config.
const patchSchema = z
  .object({
    timezone: z.string().min(1).max(100).optional(),
  })
  .strict()

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const admin = createAdminClient()
  const agentRow = await resolvePrimaryAgent(admin, user.id)
  if (!agentRow) return NextResponse.json({ error: 'No agent found' }, { status: 400 })

  const { error } = await admin
    .from('agent_settings')
    .upsert({ agent_id: agentRow.id, ...parsed.data }, { onConflict: 'agent_id' })

  if (error) {
    console.error('Settings patch error:', error)
    return NextResponse.json({ error: error.message ?? 'Failed to save settings' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
