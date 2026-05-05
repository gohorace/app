import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'No agent found' }, { status: 400 })

  // Check VAPID config
  const vapidPublic  = process.env.VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  const vapidEmail   = process.env.VAPID_EMAIL ?? 'mailto:hello@horace.app'

  if (!vapidPublic || !vapidPrivate) {
    return NextResponse.json({
      error: 'VAPID keys are not set. Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to your environment variables.',
    }, { status: 500 })
  }

  // Fetch subscriptions
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('agent_id', agent.id)

  if (!subs || subs.length === 0) {
    return NextResponse.json({
      error: 'No push subscription found. Enable alerts in your browser first — go to Settings → Alerts & briefing and grant notification permission.',
    }, { status: 400 })
  }

  // Send test notification to all subscriptions
  const webpush = await import('web-push')
  webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate)

  const payload = JSON.stringify({
    title: 'Horace is watching.',
    body: 'Push notifications are set up correctly. Seize the moment.',
    url: '/dashboard',
    tag: 'horace-test',
  })

  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
    )
  )

  const succeeded = results.filter((r) => r.status === 'fulfilled').length
  const failed    = results.filter((r) => r.status === 'rejected').length

  // Clean up any expired subscriptions (410/404)
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'rejected') {
      const status = (r.reason as { statusCode?: number })?.statusCode
      if (status === 410 || status === 404) {
        await admin.from('push_subscriptions').delete().eq('endpoint', subs[i].endpoint)
      }
    }
  }

  if (succeeded === 0) {
    return NextResponse.json({
      error: `All ${failed} subscription(s) failed. The subscription may have expired — try re-enabling notifications.`,
    }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    sent: succeeded,
    failed,
    subscriptions: subs.length,
  })
}

/** Diagnostic: returns push setup status without sending anything */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'No agent found' }, { status: 400 })

  const { count } = await admin
    .from('push_subscriptions')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agent.id)

  return NextResponse.json({
    vapidConfigured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    clientKeyConfigured: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    subscriptionCount: count ?? 0,
  })
}
