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
  return postToWebhook('SLACK_ALERT_VOLUME_WEBHOOK_URL', process.env.SLACK_ALERT_VOLUME_WEBHOOK_URL, text)
}

export async function postToSignupsChannel(text: string): Promise<void> {
  return postToWebhook('SLACK_SIGNUPS_WEBHOOK_URL', process.env.SLACK_SIGNUPS_WEBHOOK_URL, text)
}
