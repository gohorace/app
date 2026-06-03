import type { createAdminClient } from '@/lib/supabase/admin'
import { buildWelcomeEmail } from './email'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Send the one-time new-user welcome email and audit it.
 *
 * Called from lib/onboarding/bootstrap.ts the first (and only) time an
 * account provisions — see the `!membership` branch there, which already
 * runs exactly once per self-serve signup. We don't add our own dedup
 * here; that branch is the guard.
 *
 * Best-effort, like the signup Slack ping and the push helpers: this
 * swallows its own errors and never throws, so a Resend/network blip can't
 * block onboarding from rendering.
 */
export async function sendWelcomeEmail(args: {
  admin: AdminClient
  agentId: string
  email: string
  firstName: string | null
}): Promise<void> {
  if (!args.email) {
    console.warn('[welcome] no email on user — skipping welcome email')
    return
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[welcome] RESEND_API_KEY not set — skipping welcome email')
    return
  }

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)

    const { subject, html, text } = buildWelcomeEmail({
      firstName: args.firstName,
      email: args.email,
    })

    const { error } = await resend.emails.send({
      // Welcome mail comes from Horace personally, not the generic noreply.
      from: 'Horace <team@gohorace.com>',
      to: args.email,
      subject,
      html,
      text,
    })

    if (error) {
      console.error('[welcome] resend send failed:', error)
      return
    }

    // Audit row (also feeds dedup/visibility consistency with other sends).
    // workspace_id is auto-filled from agent_id by the notification_log
    // BEFORE INSERT trigger (20260513000010).
    const { error: logError } = await args.admin.from('notification_log').insert({
      agent_id: args.agentId,
      contact_id: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: 'email_welcome' as any,
    })
    if (logError) {
      console.error('[welcome] notification_log insert failed:', logError)
    }
  } catch (err) {
    console.error('[welcome] send threw:', err)
  }
}
