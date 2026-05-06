import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildDailyBriefingEmail } from '@/lib/notifications/email'
import { generateContactInsight, generateBriefingNarrative } from '@/lib/ai/briefing'
import type { LeadWithInsight, ContactEvent } from '@/lib/ai/briefing'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey || resendKey === 'your-resend-key') {
    console.log('[daily-briefing] Resend not configured — skipping')
    return NextResponse.json({ ok: true, skipped: true })
  }

  const admin = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  // Find agents who have configured at least one recipient (briefing_emails or agent_email)
  const { data: agentSettings } = await admin
    .from('agent_settings')
    .select('agent_id, agent_email, briefing_emails, timezone, daily_briefing_hour, agents(first_name, last_name, email)')

  if (!agentSettings || agentSettings.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 })
  }

  // Filter to agents who have recipients and whose local hour matches their configured send hour
  const nowUtcMs = Date.now()
  const eligibleAgents = agentSettings.filter((s) => {
    // Must have at least one recipient configured
    const hasRecipients =
      (Array.isArray(s.briefing_emails) && s.briefing_emails.length > 0) ||
      !!s.agent_email
    if (!hasRecipients) return false

    try {
      const localHour = new Date(nowUtcMs).toLocaleString('en-AU', {
        timeZone: s.timezone ?? 'Australia/Sydney',
        hour: 'numeric',
        hour12: false,
      })
      return parseInt(localHour, 10) === (s.daily_briefing_hour ?? 17)
    } catch {
      return false
    }
  })

  if (eligibleAgents.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 })
  }

  const { Resend } = await import('resend')
  const resend = new Resend(resendKey)

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  let anthropic: import('@anthropic-ai/sdk').default | null = null
  if (anthropicKey) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    anthropic = new Anthropic({ apiKey: anthropicKey })
  }

  let sent = 0
  const errors: string[] = []

  for (const settings of eligibleAgents) {
    try {
      const agent = settings.agents as { first_name: string | null; last_name: string | null; email: string | null } | null
      const agentName =
        [agent?.first_name, agent?.last_name].filter(Boolean).join(' ') ||
        agent?.email ||
        'Your Agent'

      // Top contacts with activity in the last 24 hours
      const { data: rawLeads } = await admin.rpc('get_daily_briefing_data', {
        p_agent_id: settings.agent_id,
      })

      const leads = rawLeads ?? []

      // Generate per-contact AI insights
      const leadsWithInsights: LeadWithInsight[] = await Promise.all(
        leads.map(async (lead) => {
          const { data: events } = await admin.rpc('get_contact_events', {
            p_contact_id: lead.contact_id,
          })

          const recentEvents: ContactEvent[] = (events ?? [])
            .slice(0, 10)
            .map((e) => ({
              event_type: e.event_type,
              properties: (e.properties ?? {}) as Record<string, unknown>,
              score_delta: e.score_delta,
              occurred_at: e.occurred_at,
            }))

          const insight = anthropic
            ? await generateContactInsight(anthropic, agentName, lead, recentEvents)
            : {
                why_now: `${[lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'This contact'} was active on your website today.`,
                action: `Follow up with ${lead.first_name ?? lead.email ?? 'this contact'} today.`,
              }

          return { ...lead, insight }
        }),
      )

      // Generate Horace-voiced narrative intro
      const narrative = anthropic
        ? await generateBriefingNarrative(anthropic, agentName, leads, 'today')
        : `${leads.length} contact${leads.length === 1 ? '' : 's'} worth your attention today.`

      const { subject, html } = buildDailyBriefingEmail(agentName, leadsWithInsights, narrative, appUrl)

      // Prefer briefing_emails list, fall back to agent_email
      const recipients: string[] = Array.isArray(settings.briefing_emails) && settings.briefing_emails.length > 0
        ? settings.briefing_emails
        : settings.agent_email ? [settings.agent_email] : []

      if (recipients.length === 0) continue

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? 'Horace <briefing@gohorace.com>',
        to: recipients,
        subject,
        html,
      })

      await admin.from('notification_log').insert({
        agent_id: settings.agent_id,
        contact_id: null,
        type: 'email_daily_brief',
      })

      sent++
    } catch (err) {
      console.error(`Daily briefing failed for agent ${settings.agent_id}:`, err)
      errors.push(settings.agent_id)
    }
  }

  return NextResponse.json({ ok: true, sent, errors })
}
