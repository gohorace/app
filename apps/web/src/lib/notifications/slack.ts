export async function postToAlertVolumeChannel(text: string): Promise<void> {
  const url = process.env.SLACK_ALERT_VOLUME_WEBHOOK_URL
  if (!url) {
    console.warn('[slack] SLACK_ALERT_VOLUME_WEBHOOK_URL not set — skipping')
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
