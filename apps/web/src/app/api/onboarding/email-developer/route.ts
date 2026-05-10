import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const schema = z.object({
  to: z.string().email().max(254),
  message: z.string().min(1).max(8000),
})

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[email-developer] RESEND_API_KEY not set')
    return NextResponse.json({ error: 'Email is not configured. Please contact support.' }, { status: 500 })
  }

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('first_name, last_name, email, workspace_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: workspace } = agent?.workspace_id
    ? await admin.from('workspaces').select('name').eq('id', agent.workspace_id).maybeSingle()
    : { data: null }

  const agentName = [agent?.first_name, agent?.last_name].filter(Boolean).join(' ').trim() || (user.email ?? 'a Horace user')
  const agencyName = workspace?.name ?? 'their agency'
  const subject = `${agentName} — install Horace on ${agencyName}'s website`

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F5F0E8;padding:32px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" role="presentation" style="max-width:580px;width:100%;">
        <tr><td style="background:#2E2823;border-radius:12px 12px 0 0;padding:18px 28px;">
          <span style="font-size:18px;font-weight:700;color:#FAF7F2;letter-spacing:-0.01em;">Horace</span>
        </td></tr>
        <tr><td style="background:#FAF7F2;padding:28px;border-left:1px solid #E4DCDA;border-right:1px solid #E4DCDA;">
          <p style="margin:0 0 16px;font-size:13px;color:#8C7B6B;">
            ${escapeHtml(agentName)} sent you this from Horace. Reply directly to reach them.
          </p>
          <pre style="margin:0;font-family:inherit;font-size:14px;color:#1A1612;line-height:1.65;white-space:pre-wrap;">${escapeHtml(parsed.data.message)}</pre>
        </td></tr>
        <tr><td style="background:#F5F0E8;border:1px solid #E4DCDA;border-top:none;border-radius:0 0 12px 12px;padding:16px 28px;">
          <p style="margin:0;font-size:11px;color:#8C7B6B;">
            Sent on behalf of ${escapeHtml(agentName)} via Horace · gohorace.com
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const replyTo = agent?.email ?? user.email ?? undefined
  const from = process.env.RESEND_FROM_EMAIL ?? 'Horace <hello@gohorace.com>'

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: parsed.data.to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  })

  if (error) {
    console.error('[email-developer] Resend error:', error)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
