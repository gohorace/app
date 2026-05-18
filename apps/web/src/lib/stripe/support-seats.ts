/**
 * HOR-203 — Stripe support-seat helpers.
 *
 * Single source of truth for adding/removing support-seat quantity on a
 * workspace's Stripe subscription. Used by:
 *   - POST /api/billing/seats/support       (explicit add/remove)
 *   - POST /api/workspaces/:id/invites      (auto-bump on invite send)
 *   - DELETE /api/workspaces/:id/invites/:inviteId  (decrement on revoke)
 *   - DELETE /api/workspaces/:id/members/:userId    (decrement on remove)
 *
 * Stripe quantity tracks invite-sent count, not redeemed count. Matches
 * the brief's "Support seat added. $39/mo, billed with your plan" toast
 * at invite-send time. Trialing subscriptions accrue line items but
 * don't bill until the trial ends — Stripe handles this natively when
 * the subscription has trial_end set.
 *
 * Price IDs come from env. Operator creates the prices in Stripe with
 * tax-inclusive AUD pricing; the 17% annual discount mirrors agent
 * seats.
 *
 * @returns the updated subscription, OR null when the workspace has no
 * stripe_subscription_id (e.g. on the free plan / not yet trialed).
 * Callers can treat null as a no-op: the workspace just doesn't have a
 * subscription to attach a line item to yet, and the invite still
 * succeeds — when they later start the trial, the support-seat quantity
 * is computed from the agents table.
 */

import type Stripe from 'stripe'
import { getStripe } from './client'
import { createAdminClient } from '@/lib/supabase/admin'

const PRICE_ENV: Record<'monthly' | 'annual', string> = {
  monthly: 'STRIPE_PRICE_SUPPORT_SEAT_MONTHLY',
  annual: 'STRIPE_PRICE_SUPPORT_SEAT_ANNUAL',
}

export interface SupportSeatChangeResult {
  /** New total quantity of support seats on the subscription. 0 when removed entirely. */
  quantity: number
  /** Stripe subscription item id (created if needed, returned for callers that want to log it). */
  subscriptionItemId: string | null
}

function priceIdForPlan(plan: string | null | undefined): string | null {
  if (!plan) return null
  const period = plan.endsWith('_annual') ? 'annual' : 'monthly'
  return process.env[PRICE_ENV[period]] ?? null
}

/**
 * Adjusts the support-seat quantity on the workspace's existing
 * subscription by `delta`. Idempotent: caller computes the target by
 * passing a positive (add) or negative (remove) delta.
 *
 * No-ops (returns null) when:
 *   - workspace has no stripe_subscription_id (free plan / pre-trial)
 *   - workspace has no plan field set
 *   - the support-seat price isn't configured in env
 *
 * The trial behaviour: Stripe accepts quantity changes on trialing
 * subscriptions. The amount accrues to the first non-trial invoice.
 * No need to special-case trialing here.
 */
export async function adjustSupportSeats(
  workspaceId: string,
  delta: number,
): Promise<SupportSeatChangeResult | null> {
  if (delta === 0) return { quantity: 0, subscriptionItemId: null }

  const admin = createAdminClient()

  const { data: workspace } = await admin
    .from('workspaces')
    .select('stripe_subscription_id, plan')
    .eq('id', workspaceId)
    .single()

  if (!workspace?.stripe_subscription_id) return null

  const priceId = priceIdForPlan(workspace.plan)
  if (!priceId) {
    console.warn('adjustSupportSeats: no support price configured for plan', {
      workspaceId,
      plan: workspace.plan,
    })
    return null
  }

  const stripe = getStripe()
  const subscription = await stripe.subscriptions.retrieve(
    workspace.stripe_subscription_id,
    { expand: ['items.data'] },
  )

  // Find an existing support-seat line item (by price_id), if any.
  const existing = subscription.items.data.find(
    (item: Stripe.SubscriptionItem) => item.price.id === priceId,
  )

  const currentQty = existing?.quantity ?? 0
  const targetQty = Math.max(0, currentQty + delta)

  if (targetQty === currentQty) {
    return { quantity: currentQty, subscriptionItemId: existing?.id ?? null }
  }

  // Three paths:
  //   (a) no existing item, target > 0 → create item
  //   (b) existing item, target > 0    → update quantity
  //   (c) existing item, target === 0  → delete item
  if (!existing && targetQty > 0) {
    const item = await stripe.subscriptionItems.create({
      subscription: subscription.id,
      price: priceId,
      quantity: targetQty,
      proration_behavior: 'create_prorations',
    })
    return { quantity: targetQty, subscriptionItemId: item.id }
  }

  if (existing && targetQty > 0) {
    const item = await stripe.subscriptionItems.update(existing.id, {
      quantity: targetQty,
      proration_behavior: 'create_prorations',
    })
    return { quantity: targetQty, subscriptionItemId: item.id }
  }

  if (existing && targetQty === 0) {
    await stripe.subscriptionItems.del(existing.id, {
      proration_behavior: 'create_prorations',
    })
    return { quantity: 0, subscriptionItemId: null }
  }

  // delta < 0 from zero — nothing to do.
  return { quantity: 0, subscriptionItemId: null }
}

/**
 * Reconciles Stripe support-seat quantity against the source of truth
 * in our database. Idempotent — safe to call after any mutation that
 * could change the seat count (invite send, revoke, member remove,
 * member depart). Avoids the bookkeeping bugs that come with passing
 * +1/-1 deltas through every call site.
 *
 * Target quantity = active support-seat agents + outstanding support
 * invites. Outstanding = unaccepted, unrevoked, unexpired.
 *
 * Returns the new quantity, or null if there's nothing to bill against
 * yet (no subscription, free plan, etc.).
 */
export async function reconcileSupportSeats(
  workspaceId: string,
): Promise<SupportSeatChangeResult | null> {
  const admin = createAdminClient()

  const [{ count: activeCount }, { count: pendingCount }] = await Promise.all([
    admin
      .from('agents')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .eq('seat_type' as any, 'support')
      .neq('status', 'departed'),
    admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('workspace_invites' as any)
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('role', 'support')
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString()),
  ])

  const target = (activeCount ?? 0) + (pendingCount ?? 0)
  const current = await getSupportSeatQuantity(workspaceId)
  const delta = target - current
  if (delta === 0) {
    return { quantity: target, subscriptionItemId: null }
  }
  return await adjustSupportSeats(workspaceId, delta)
}

/**
 * Returns the current support-seat quantity on a workspace's subscription.
 * Returns 0 when there's no subscription or no support-seat line item.
 *
 * Read-only — for display in settings UI and pre-action checks. Heavy
 * Stripe call; cache caller-side if needed in tight loops.
 */
export async function getSupportSeatQuantity(workspaceId: string): Promise<number> {
  const admin = createAdminClient()
  const { data: workspace } = await admin
    .from('workspaces')
    .select('stripe_subscription_id, plan')
    .eq('id', workspaceId)
    .single()

  if (!workspace?.stripe_subscription_id) return 0

  const priceId = priceIdForPlan(workspace.plan)
  if (!priceId) return 0

  const stripe = getStripe()
  const subscription = await stripe.subscriptions.retrieve(
    workspace.stripe_subscription_id,
    { expand: ['items.data'] },
  )

  const item = subscription.items.data.find(
    (i: Stripe.SubscriptionItem) => i.price.id === priceId,
  )
  return item?.quantity ?? 0
}
