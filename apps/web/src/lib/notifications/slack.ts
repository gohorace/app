async function postToWebhook(envKey: string, url: string | undefined, text: string): Promise<void> {
  if (!url) {
    console.warn(`[slack] ${envKey} not set — skipping`)
    return
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[slack] post failed:', res.status, body)
    }
  } catch (err) {
    console.error('[slack] post threw:', err)
  }
}

export async function postToAlertVolumeChannel(text: string): Promise<void> {
  return postToWebhook(
    'SLACK_ALERT_VOLUME_WEBHOOK_URL',
    process.env.SLACK_ALERT_VOLUME_WEBHOOK_URL,
    text,
  )
}

export async function postToSignupsChannel(text: string): Promise<void> {
  return postToWebhook('SLACK_SIGNUPS_WEBHOOK_URL', process.env.SLACK_SIGNUPS_WEBHOOK_URL, text)
}

// HOR-385 · Background-job failures (crawler etc.) → ops channel. Best-effort,
// skips silently when the webhook isn't configured.
export async function postToOpsChannel(text: string): Promise<void> {
  return postToWebhook('SLACK_OPS_WEBHOOK_URL', process.env.SLACK_OPS_WEBHOOK_URL, text)
}

// HOR-325 · CRM connection requests → #connection-requests. Internal ops
// message (not Horace's agent-facing voice) — everything the team needs to
// wire the connection up by hand without a follow-up.
export interface ConnectionRequestPayload {
  agencyName: string
  agencyId: string
  agentName: string
  agentEmail: string
  crm: string
  inbound: boolean
  outbound: boolean
}

export function formatConnectionRequest(p: ConnectionRequestPayload): string {
  const intent =
    p.inbound && p.outbound
      ? 'Contacts in + Doorstep leads out'
      : p.inbound
        ? 'Pull contacts in'
        : p.outbound
          ? 'Send Doorstep leads out'
          : 'Not specified'
  return [
    '*New connection request*',
    `Agency: ${p.agencyName} (\`${p.agencyId}\`)`,
    `Requested by: ${p.agentName} <${p.agentEmail}>`,
    `CRM: ${p.crm}`,
    `Intent: ${intent}`,
  ].join('\n')
}

export async function postConnectionRequest(p: ConnectionRequestPayload): Promise<void> {
  return postToWebhook(
    'SLACK_CONNECTION_REQUESTS_WEBHOOK_URL',
    process.env.SLACK_CONNECTION_REQUESTS_WEBHOOK_URL,
    formatConnectionRequest(p),
  )
}
