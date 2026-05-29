/**
 * HOR-323 · Public API v1 — webhook signing + retry schedule.
 *
 * Signature: `X-Horace-Signature: t=<unix>,v1=<hmac>` where hmac is
 * HMAC-SHA256 over `{timestamp}.{body}` with the endpoint's signing secret.
 * Receivers recompute it and reject timestamps more than 5 minutes old.
 */
import { createHmac, randomBytes } from 'crypto'

export const WEBHOOK_EVENTS = [
  'contact.created',
  'contact.updated',
  'relationship.created',
  'relationship.updated',
] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

// Retry delays (minutes) applied after attempts 1..5. A 6th failure exhausts.
export const WEBHOOK_BACKOFF_MINUTES = [1, 5, 30, 120, 720]
export const WEBHOOK_MAX_ATTEMPTS = 6

export function signWebhookBody(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function webhookSignatureHeader(
  secret: string,
  body: string,
  now: number = Date.now(),
): string {
  const t = Math.floor(now / 1000)
  return `t=${t},v1=${signWebhookBody(secret, t, body)}`
}

/**
 * Delay (ms) before the next retry, given how many attempts have already been
 * made (the claim increments `attempts` before the attempt runs). Returns null
 * when retries are exhausted.
 */
export function nextBackoffMs(attemptsMade: number): number | null {
  if (attemptsMade >= WEBHOOK_MAX_ATTEMPTS) return null
  const minutes = WEBHOOK_BACKOFF_MINUTES[attemptsMade - 1]
  return minutes != null ? minutes * 60_000 : null
}

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value)
}

/** A webhook signing secret, shown once. Stored in Vault, used by both sides
 *  to compute the HMAC. */
export function mintWebhookSecret(): string {
  return 'whsec_' + randomBytes(24).toString('base64url')
}
