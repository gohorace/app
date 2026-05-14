import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
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

  const body = await req.json()
  const { endpoint, keys, deviceKind } = body as {
    endpoint: string
    keys: { p256dh: string; auth: string }
    deviceKind?: 'desktop' | 'mobile' | 'tablet' | 'other'
  }

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  // HOR-164: device_kind is optional on the column (nullable). Only
  // pass it through when the client supplies a recognised value; we
  // intentionally ignore unknown values rather than 400-ing so older
  // clients (pre-HOR-164) keep working.
  const allowedKinds = ['desktop', 'mobile', 'tablet', 'other'] as const
  const safeDeviceKind =
    deviceKind && (allowedKinds as readonly string[]).includes(deviceKind)
      ? deviceKind
      : null

  const { error } = await admin.from('push_subscriptions').upsert(
    {
      agent_id: agent.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      ...(safeDeviceKind ? { device_kind: safeDeviceKind } : {}),
    },
    { onConflict: 'agent_id,endpoint' },
  )

  if (error) {
    console.error('[push/subscribe] upsert error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
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

  const body = await req.json().catch(() => ({}))
  const endpoint = (body as { endpoint?: string }).endpoint

  const q = admin.from('push_subscriptions').delete().eq('agent_id', agent.id)
  if (endpoint) q.eq('endpoint', endpoint)

  await q
  return NextResponse.json({ ok: true })
}
