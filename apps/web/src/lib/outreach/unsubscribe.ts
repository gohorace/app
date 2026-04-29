import { createHmac, timingSafeEqual } from 'crypto'

function unsubSecret(): string {
  // Prefer a dedicated secret; fall back to the service role key so the app
  // works without extra env config. Rotating either invalidates existing
  // unsubscribe URLs — that's an acceptable failure mode (links re-send).
  return process.env.UNSUB_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY!
}

export function signUnsubscribeToken(contactId: string): string {
  return createHmac('sha256', unsubSecret())
    .update(contactId)
    .digest('base64url')
    .slice(0, 32)
}

export function verifyUnsubscribeToken(contactId: string, token: string): boolean {
  const expected = signUnsubscribeToken(contactId)
  if (expected.length !== token.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
}

export function unsubscribeUrl(appUrl: string, contactId: string): string {
  const token = signUnsubscribeToken(contactId)
  return `${appUrl}/u/${contactId}/${token}`
}
