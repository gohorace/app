import { redirect } from 'next/navigation'

const ACTIVE_STATUSES = new Set(['trialing', 'active', 'past_due'])

export function isSubscriptionActive(status: string | null | undefined): boolean {
  return !!status && ACTIVE_STATUSES.has(status)
}

export function requireActiveSubscription(status: string | null | undefined): void {
  if (!isSubscriptionActive(status)) {
    redirect('/pricing?expired=1')
  }
}
