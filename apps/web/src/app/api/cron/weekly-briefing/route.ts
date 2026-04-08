import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildWeeklyBriefingEmail } from '@/lib/notifications/email'

export async function GET(request: NextRequest) {
  // Verify this is called by Vercel Cron (or manually with the secret)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey || resendKey === 'your-resend-key') {
    console.log('[weekly-briefing] Resend not configured — skipping')
    return NextResponse.json({ ok: true, skipped: true })
  }

  const admin = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const today = new Date().getDay() // 0=Sun, 1=Mon, ...

  // Find all agents whose briefing day matches today and have an agent_email
  const { data: agentSettings } = await admin
    .from('agent_settings')
    .select('agent_id, agent_email, weekly_briefing_day, agents(first_name, last_name, email)')
    .eq('weekly_briefing_day', today)
    .not('agent_email', 'is', null)

  if (!agentSettings || agentSettings.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 })
  }

  const { Resend } = await import('resend')
  const resend = new Resend(resendKey)

  let sent = 0
  const errors: string[] = []

  for (const settings of agentSettings) {
    try {
      const agent = settings.agents as { first_name: string | null; last_name: string | null; email: string | null } | null
      const agentName =
        [agent?.first_name, agent?.last_name].filter(Boolean).join(' ') ||
        agent?.email ||
        'Your Agent'

      // Fetch top leads for this agent (last 7 days activity)
      const { data: leads } = await admin.rpc('get_weekly_briefing_data', {
        p_agent_id: settings.agent_id,
      })

      const { subject, html } = buildWeeklyBriefingEmail(
        agentName,
        leads ?? [],
        appUrl,
      )

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? 'briefing@realestate-insights.app',
        to: settings.agent_email!,
        subject,
        html,
      })

      // Log it
      await admin.from('notification_log').insert({
        agent_id: settings.agent_id,
        contact_id: null,
        type: 'email_briefing',
      })

      sent++
    } catch (err) {
      console.error(`Briefing failed for agent ${settings.agent_id}:`, err)
      errors.push(settings.agent_id)
    }
  }

  return NextResponse.json({ ok: true, sent, errors })
}
