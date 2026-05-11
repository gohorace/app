import { createAdminClient } from '@/lib/supabase/admin'
import { buildAlertEmail } from '@/lib/notifications/email'

const DEDUP_MINUTES = 30

export type AlertType = 'alert_score_threshold' | 'alert_form_submit' | 'alert_return_visit'

interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
}

async function sendWebPush(endpoint: string, p256dh: string, auth: string, payload: PushPayload): Promise<boolean> {
  const webpush = await import('web-push')

  const vapidPublic  = process.env.VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  const vapidEmail   = process.env.VAPID_EMAIL ?? 'mailto:hello@horace.app'

  if (!vapidPublic || !vapidPrivate) {
    console.warn('[push] VAPID keys not set — skipping push')
    return false
  }

  webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate)

  try {
    await webpush.sendNotification(
      { endpoint, keys: { p256dh, auth } },
      JSON.stringify(payload),
    )
    return true
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 410 || status === 404) {
      // Subscription expired — clean it up
      const admin = createAdminClient()
      await admin.from('push_subscriptions').delete().eq('endpoint', endpoint)
    } else {
      console.error('[push] send failed', err)
    }
    return false
  }
}

async function isRecentlySent(agentId: string, contactId: string | null, type: AlertType): Promise<boolean> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - DEDUP_MINUTES * 60_000).toISOString()
  const q = admin
    .from('notification_log')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('type', type)
    .gte('sent_at', since)

  if (contactId) q.eq('contact_id', contactId)

  const { count } = await q
  return (count ?? 0) > 0
}

async function logAlert(agentId: string, contactId: string | null, type: AlertType): Promise<void> {
  const admin = createAdminClient()
  await admin.from('notification_log').insert({ agent_id: agentId, contact_id: contactId, type })
}

async function emailAgent(
  agentId: string,
  type: import('./email').AlertEmailType,
  contactName: string,
  contactId: string,
  extra?: { score?: number; formName?: string | null },
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey || resendKey === 'your-resend-key') return

  const admin = createAdminClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  // Get agent email + briefing_emails recipients
  const { data: settings } = await admin
    .from('agent_settings')
    .select('agent_email, briefing_emails')
    .eq('agent_id', agentId)
    .maybeSingle()

  const recipients: string[] = []
  if (settings?.briefing_emails?.length) {
    recipients.push(...settings.briefing_emails)
  } else if (settings?.agent_email) {
    recipients.push(settings.agent_email)
  }

  if (recipients.length === 0) return

  const { subject, html } = buildAlertEmail(type, contactName, contactId, appUrl, extra)

  const { Resend } = await import('resend')
  const resend = new Resend(resendKey)

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'Horace <alerts@gohorace.com>',
    to: recipients,
    subject,
    html,
  }).catch((err) => console.error('[email] alert send failed:', err))
}

async function pushToAgent(agentId: string, payload: PushPayload): Promise<void> {
  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('agent_id', agentId)

  if (!subs || subs.length === 0) return

  await Promise.all(subs.map((s) => sendWebPush(s.endpoint, s.p256dh, s.auth, payload)))
}

export async function sendScoreThresholdAlert(
  agentId: string,
  contactId: string,
  contactName: string,
  scoreAfter: number,
  scoreBefore: number,
): Promise<void> {
  const admin = createAdminClient()
  const { data: settings } = await admin
    .from('agent_settings')
    .select('sms_threshold_score')
    .eq('agent_id', agentId)
    .maybeSingle()

  const threshold = settings?.sms_threshold_score ?? 50
  if (!(scoreBefore < threshold && scoreAfter >= threshold)) return
  if (await isRecentlySent(agentId, contactId, 'alert_score_threshold')) return

  const score = scoreAfter
  const firstName = contactName.split(' ')[0]
  await Promise.all([
    pushToAgent(agentId, {
      title: "Something's stirring.",
      body: `${firstName} just crossed your threshold. Might be worth a call.`,
      url: `/contacts/${contactId}`,
      tag: `score-${contactId}`,
    }),
    emailAgent(agentId, 'score_threshold', contactName, contactId, { score: scoreAfter }),
  ])

  await logAlert(agentId, contactId, 'alert_score_threshold')
}

export async function sendFormSubmitAlert(
  agentId: string,
  contactId: string,
  contactName: string,
  formName: string | null,
): Promise<void> {
  if (await isRecentlySent(agentId, contactId, 'alert_form_submit')) return

  const firstName = contactName.split(' ')[0]
  await Promise.all([
    pushToAgent(agentId, {
      title: 'They raised their hand.',
      body: `${firstName} just submitted${formName ? ` "${formName}"` : ' a form'}. Worth a follow-up now.`,
      url: `/contacts/${contactId}`,
      tag: `form-${contactId}`,
    }),
    emailAgent(agentId, 'form_submit', contactName, contactId, { formName }),
  ])

  await logAlert(agentId, contactId, 'alert_form_submit')
}

export async function sendReturnVisitAlert(
  agentId: string,
  contactId: string,
  contactName: string,
): Promise<void> {
  if (await isRecentlySent(agentId, contactId, 'alert_return_visit')) return

  const firstName = contactName.split(' ')[0]
  await Promise.all([
    pushToAgent(agentId, {
      title: "Something's stirring.",
      body: `${firstName}'s back on your site. Might be worth a call.`,
      url: `/contacts/${contactId}`,
      tag: `return-${contactId}`,
    }),
    emailAgent(agentId, 'return_visit', contactName, contactId),
  ])

  await logAlert(agentId, contactId, 'alert_return_visit')
}
