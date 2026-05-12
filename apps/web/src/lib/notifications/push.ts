import { createAdminClient } from '@/lib/supabase/admin'
import { postToAlertVolumeChannel } from '@/lib/notifications/slack'

const DEDUP_MINUTES = 30
const VOLUME_CAP_PER_24H = 8
const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000

export type AlertType = 'alert_score_threshold' | 'alert_form_submit' | 'alert_return_visit'

const PUSH_ALERT_TYPES: AlertType[] = [
  'alert_score_threshold',
  'alert_form_submit',
  'alert_return_visit',
]

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

async function logAlert(
  agentId: string,
  contactId: string | null,
  type: AlertType,
  display?: { title: string; body: string; url: string },
): Promise<void> {
  const admin = createAdminClient()
  await admin.from('notification_log').insert({
    agent_id: agentId,
    contact_id: contactId,
    type,
    title: display?.title ?? null,
    body: display?.body ?? null,
    url: display?.url ?? null,
  })
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

async function pushesInLast24h(agentId: string): Promise<number> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - REVIEW_WINDOW_MS).toISOString()
  const { count } = await admin
    .from('notification_log')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .in('type', PUSH_ALERT_TYPES)
    .gte('sent_at', since)
  return count ?? 0
}

async function alreadyFlaggedForReview(agentId: string): Promise<boolean> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - REVIEW_WINDOW_MS).toISOString()
  const { count } = await admin
    .from('notification_log')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('type', 'volume_review')
    .gte('sent_at', since)
  return (count ?? 0) > 0
}

async function emitVolumeReview(agentId: string, countAfter: number): Promise<void> {
  if (await alreadyFlaggedForReview(agentId)) return

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('first_name, last_name, workspaces(name)')
    .eq('id', agentId)
    .maybeSingle<{ first_name: string | null; last_name: string | null; workspaces: { name: string | null } | null }>()

  const agentName = agent
    ? [agent.first_name, agent.last_name].filter(Boolean).join(' ').trim() || agentId
    : agentId
  const workspaceName = agent?.workspaces?.name ?? 'unknown workspace'

  const text =
    `Alert volume cap hit — *${agentName}* (${workspaceName}) has had *${countAfter} pushes* ` +
    `in the last 24h (cap is ${VOLUME_CAP_PER_24H}). The alert design is likely mis-tuned for this agent. ` +
    `<https://linear.app/gohorace/project/alerts-and-notifications-02f66872bea5|Alerts & Notifications>`

  await postToAlertVolumeChannel(text)

  await admin.from('notification_log').insert({
    agent_id: agentId,
    contact_id: null,
    type: 'volume_review',
  })
}

async function dispatchPushAlert(args: {
  agentId: string
  contactId: string
  type: AlertType
  payload: PushPayload
}): Promise<void> {
  const { agentId, contactId, type, payload } = args

  if (await isRecentlySent(agentId, contactId, type)) return

  await pushToAgent(agentId, payload)
  await logAlert(agentId, contactId, type, {
    title: payload.title,
    body: payload.body,
    url: payload.url,
  })

  const countAfter = await pushesInLast24h(agentId)
  if (countAfter > VOLUME_CAP_PER_24H) {
    await emitVolumeReview(agentId, countAfter)
  }
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

  const firstName = contactName.split(' ')[0]
  await dispatchPushAlert({
    agentId,
    contactId,
    type: 'alert_score_threshold',
    payload: {
      title: `${firstName} is gathering momentum`,
      body: `Horace's been watching ${firstName} — the signal just got stronger. Worth a look.`,
      url: `/leads/${contactId}`,
      tag: `score-${contactId}`,
    },
  })
}

export async function sendFormSubmitAlert(
  agentId: string,
  contactId: string,
  contactName: string,
  formName: string | null,
): Promise<void> {
  const firstName = contactName.split(' ')[0]
  const title = formName
    ? `${firstName} just submitted "${formName}"`
    : `${firstName} just got in touch`
  await dispatchPushAlert({
    agentId,
    contactId,
    type: 'alert_form_submit',
    payload: {
      title,
      body: `Horace has ${firstName}'s details now. Worth a call while it's warm.`,
      url: `/leads/${contactId}`,
      tag: `form-${contactId}`,
    },
  })
}

export async function sendReturnVisitAlert(
  agentId: string,
  contactId: string,
  contactName: string,
): Promise<void> {
  const firstName = contactName.split(' ')[0]
  await dispatchPushAlert({
    agentId,
    contactId,
    type: 'alert_return_visit',
    payload: {
      title: `${firstName} is back on your site`,
      body: `Horace just spotted ${firstName} returning. Worth a quick hello.`,
      url: `/leads/${contactId}`,
      tag: `return-${contactId}`,
    },
  })
}
