import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type AdminClient = SupabaseClient<Database>

const SMS_DEDUP_HOURS = 24

/** Templates */
export const SMS_TEMPLATES = {
  score_threshold: (name: string, score: number, contactId: string, appUrl: string) =>
    `Hot lead alert: ${name} just hit a score of ${score}. View: ${appUrl}/contacts/${contactId}`,
  form_submit: (name: string, formName: string | null, contactId: string, appUrl: string) =>
    `${name} submitted${formName ? ` "${formName}"` : ' a form'} on your website. ${appUrl}/contacts/${contactId}`,
  return_visit: (name: string, contactId: string, appUrl: string) =>
    `${name} is back on your website right now. ${appUrl}/contacts/${contactId}`,
  /**
   * HOR-56 mobile pair: the SMS body that delivers the signed install
   * URL to the agent's phone. Voice and sign-off match the alerts
   * copy standards (first-person Horace, "Seize the moment" sign-off).
   */
  pairing_link: (url: string) => `Take Horace with you: ${url} — Seize the moment.`,
}

/**
 * HOR-56: dispatch a pairing SMS to the agent's own phone. Auth and
 * rate-limit guards live on the calling route (per-token accounting
 * on `pairing_tokens`); this helper does the bare Twilio send.
 *
 * Does NOT log to `notification_log` — pairing accounting belongs on
 * the pairing_tokens row, not the alerts/notifications surface.
 * Throws on Twilio failure so the caller can keep the row's
 * rate-limit budget unchanged (fail-closed accounting).
 */
export async function sendPairingLinkSms(to: string, url: string): Promise<void> {
  await sendSms(to, SMS_TEMPLATES.pairing_link(url))
}

/** Send an SMS via Twilio. Only call server-side. */
async function sendSms(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER

  if (!accountSid || !authToken || !from || accountSid === 'ACxxx') {
    console.log(`[SMS stub] To: ${to}\n${body}`)
    return
  }

  const { default: Twilio } = await import('twilio')
  const client = Twilio(accountSid, authToken)
  await client.messages.create({ from, to, body })
}

/**
 * Check if an SMS of this type was already sent recently (dedup guard).
 */
async function isRecentlySent(
  supabase: AdminClient,
  agentId: string,
  contactId: string,
  type: 'sms_threshold' | 'sms_form' | 'sms_return',
): Promise<boolean> {
  const since = new Date(Date.now() - SMS_DEDUP_HOURS * 3600 * 1000).toISOString()
  const { count } = await supabase
    .from('notification_log')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('contact_id', contactId)
    .eq('type', type)
    .gte('sent_at', since)

  return (count ?? 0) > 0
}

async function logNotification(
  supabase: AdminClient,
  agentId: string,
  contactId: string,
  type: 'sms_threshold' | 'sms_form' | 'sms_return',
): Promise<void> {
  await supabase.from('notification_log').insert({ agent_id: agentId, contact_id: contactId, type })
}

/**
 * Fires an SMS to the agent if the contact's score just crossed the configured threshold.
 */
export async function sendSmsIfThresholdCrossed(
  supabase: AdminClient,
  agentId: string,
  contactId: string,
  scoreBefore: number,
  scoreAfter: number,
): Promise<void> {
  const { data: settings } = await supabase
    .from('agent_settings')
    .select('sms_enabled, sms_threshold_score, agent_phone')
    .eq('agent_id', agentId)
    .single()

  if (!settings?.sms_enabled || !settings.agent_phone) return

  const threshold = settings.sms_threshold_score
  if (!(scoreBefore < threshold && scoreAfter >= threshold)) return

  if (await isRecentlySent(supabase, agentId, contactId, 'sms_threshold')) return

  const { data: contact } = await supabase
    .from('contacts')
    .select('first_name, last_name, email')
    .eq('id', contactId)
    .single()

  const name =
    [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') ||
    contact?.email ||
    'A lead'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  await sendSms(settings.agent_phone, SMS_TEMPLATES.score_threshold(name, scoreAfter, contactId, appUrl))
  await logNotification(supabase, agentId, contactId, 'sms_threshold')
}

/**
 * Fires an SMS when a known contact submits a form.
 */
export async function sendFormSubmitSms(
  supabase: AdminClient,
  agentId: string,
  contactId: string,
  formName: string | null,
): Promise<void> {
  const { data: settings } = await supabase
    .from('agent_settings')
    .select('sms_enabled, agent_phone')
    .eq('agent_id', agentId)
    .single()

  if (!settings?.sms_enabled || !settings.agent_phone) return
  if (await isRecentlySent(supabase, agentId, contactId, 'sms_form')) return

  const { data: contact } = await supabase
    .from('contacts')
    .select('first_name, last_name, email')
    .eq('id', contactId)
    .single()

  const name =
    [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') ||
    contact?.email ||
    'A lead'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  await sendSms(settings.agent_phone, SMS_TEMPLATES.form_submit(name, formName, contactId, appUrl))
  await logNotification(supabase, agentId, contactId, 'sms_form')
}

/**
 * Fires an SMS when a hot lead returns to the website.
 */
export async function sendReturnVisitSms(
  supabase: AdminClient,
  agentId: string,
  contactId: string,
  contactScore: number,
): Promise<void> {
  const { data: settings } = await supabase
    .from('agent_settings')
    .select('sms_enabled, agent_phone, sms_threshold_score')
    .eq('agent_id', agentId)
    .single()

  if (!settings?.sms_enabled || !settings.agent_phone) return

  // Only alert for contacts that have already crossed the threshold
  if (contactScore < settings.sms_threshold_score) return
  if (await isRecentlySent(supabase, agentId, contactId, 'sms_return')) return

  const { data: contact } = await supabase
    .from('contacts')
    .select('first_name, last_name, email')
    .eq('id', contactId)
    .single()

  const name =
    [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') ||
    contact?.email ||
    'A lead'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  await sendSms(settings.agent_phone, SMS_TEMPLATES.return_visit(name, contactId, appUrl))
  await logNotification(supabase, agentId, contactId, 'sms_return')
}
