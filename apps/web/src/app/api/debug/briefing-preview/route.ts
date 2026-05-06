import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildDailyBriefingEmail } from '@/lib/notifications/email'
import { generateContactInsight, generateBriefingNarrative } from '@/lib/ai/briefing'
import type { LeadWithInsight, ContactEvent } from '@/lib/ai/briefing'

/**
 * GET /api/debug/briefing-preview?to=email@example.com
 *
 * Sends a real daily briefing email to the specified address using live agent
 * data. Requires an active session. Remove this route after preview is done.
 */
export async function GET(request: NextRequest) {
  // Auth — must be a logged-in agent
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const to = request.nextUrl.searchParams.get('to')
  const render = request.nextUrl.searchParams.get('render')

  // ?to= only required when actually sending
  if (!render && !to) return NextResponse.json({ error: 'Missing ?to= param' }, { status: 400 })

  const resendKey = process.env.RESEND_API_KEY

  const admin = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://horace.app'

  // Fetch agent
  const { data: agent } = await admin
    .from('agents')
    .select('id, first_name, last_name, email')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const agentName = [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.email || 'Agent'

  // Fetch top contacts by score with recent activity
  const { data: rawLeads } = await admin.rpc('get_daily_briefing_data', {
    p_agent_id: agent.id,
  })

  // Fall back to top contacts by score if no daily activity data
  let leads = rawLeads ?? []
  if (leads.length === 0) {
    const { data: topContacts } = await admin
      .from('contacts')
      .select('id, first_name, last_name, email, score')
      .eq('agent_id', agent.id)
      .gte('score', 5)
      .order('score', { ascending: false })
      .limit(3)

    leads = (topContacts ?? []).map(c => ({
      contact_id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      score: c.score,
      score_change: 0,
      event_count: 0,
      last_seen_at: null,
    }))
  }

  // Init Anthropic
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  let anthropic: import('@anthropic-ai/sdk').default | null = null
  if (anthropicKey) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    anthropic = new Anthropic({ apiKey: anthropicKey })
  }

  // Generate per-contact insights
  const leadsWithInsights: LeadWithInsight[] = await Promise.all(
    leads.map(async (lead) => {
      const { data: events } = await admin.rpc('get_contact_events', {
        p_contact_id: lead.contact_id,
      })

      const recentEvents: ContactEvent[] = (events ?? []).slice(0, 10).map((e) => ({
        event_type: e.event_type,
        properties: (e.properties ?? {}) as Record<string, unknown>,
        score_delta: e.score_delta,
        occurred_at: e.occurred_at,
      }))

      const insight = anthropic
        ? await generateContactInsight(anthropic, agentName, lead, recentEvents)
        : {
            why_now: `${[lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'This contact'} has been active on your website.`,
            action: `Follow up with ${lead.first_name ?? 'this contact'} today.`,
          }

      return { ...lead, insight }
    }),
  )

  // Generate narrative intro
  const narrative = anthropic
    ? await generateBriefingNarrative(anthropic, agentName, leads, 'today')
    : `${leads.length} contact${leads.length === 1 ? '' : 's'} worth your attention today.`

  const { subject, html } = buildDailyBriefingEmail(agentName, leadsWithInsights, narrative, appUrl)

  // ?render=1 — return HTML directly in the browser (no email needed)
  if (render === '1') {
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  // Send via Resend
  if (!resendKey || resendKey === 'your-resend-key') {
    return NextResponse.json({ error: 'Resend not configured' }, { status: 500 })
  }

  const { Resend } = await import('resend')
  const resend = new Resend(resendKey)

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'Horace <briefing@gohorace.com>',
    to,
    subject: `[Preview] ${subject}`,
    html,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    to,
    subject: `[Preview] ${subject}`,
    leads: leads.length,
    aiEnabled: !!anthropic,
  })
}
