import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import { buildStirringEmail } from '@/lib/notifications/email'

/**
 * GET /api/debug/briefing-preview?render=1[&familiar=N&anonymous=M][&to=email]
 *
 * Previews the "Something's stirring" notification email. By default the texture
 * line is keyed to the agent's live firing contacts (familiar = resolved
 * identity, anonymous = activity with no name yet). Pass ?familiar= / ?anonymous=
 * to force a specific variant and eyeball the copy table. ?render=1 returns the
 * HTML in the browser; ?to= sends a real (subject-prefixed) email via Resend.
 * Requires an active session. Remove this route after preview is done.
 */
export async function GET(request: NextRequest) {
  // Auth — must be a logged-in agent
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const to = request.nextUrl.searchParams.get('to')
  const render = request.nextUrl.searchParams.get('render')
  const familiarOverride = request.nextUrl.searchParams.get('familiar')
  const anonymousOverride = request.nextUrl.searchParams.get('anonymous')

  // ?to= only required when actually sending
  if (!render && !to) return NextResponse.json({ error: 'Missing ?to= param' }, { status: 400 })

  const resendKey = process.env.RESEND_API_KEY

  const admin = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://horace.app'

  // Fetch agent (resolve primary seat, then re-fetch name/email by id)
  const resolved = await resolvePrimaryAgent(admin, user.id)
  if (!resolved) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const { data: agent } = await admin
    .from('agents')
    .select('id, first_name, last_name, email')
    .eq('id', resolved.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Live bucket from the same RPC the cron uses.
  const { data: rawLeads } = await admin.rpc('get_daily_briefing_data', {
    p_agent_id: agent.id,
  })
  const leads = rawLeads ?? []
  const liveFamiliar = leads.filter(
    (l) => (l as { identified_at?: string | null }).identified_at != null,
  ).length
  const liveAnonymous = leads.length - liveFamiliar

  const familiar = familiarOverride != null
    ? Math.max(0, parseInt(familiarOverride, 10) || 0)
    : liveFamiliar
  const anonymous = anonymousOverride != null
    ? Math.max(0, parseInt(anonymousOverride, 10) || 0)
    : liveAnonymous

  const { subject, html } = buildStirringEmail({
    firstName: agent.first_name,
    familiar,
    anonymous,
    appUrl,
  })

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
    to: to ?? '',
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
    familiar,
    anonymous,
  })
}
