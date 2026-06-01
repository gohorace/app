import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const stripe = getStripe()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret)
  } catch (err) {
    console.error('Stripe signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Idempotency: Stripe redelivers the same event.id (retries / at-least-once).
  // Record it first and skip if already handled, so a replay — or a stale
  // `subscription.updated` arriving after a `subscription.deleted` is replayed —
  // can't re-apply and resurrect a canceled subscription. Fail OPEN on any
  // non-duplicate error (e.g. the table not yet existing during rollout) so the
  // idempotency ledger can never drop a real billing event.
  const { error: dedupeErr } = await admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('stripe_webhook_events' as any)
    .insert({ event_id: event.id, event_type: event.type } as never)
  if (dedupeErr) {
    if (dedupeErr.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error('stripe webhook: idempotency insert failed (continuing):', dedupeErr)
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (typeof session.subscription === 'string') {
          const sub = await stripe.subscriptions.retrieve(session.subscription)
          await syncSubscription(admin, sub)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await syncSubscription(admin, event.data.object as Stripe.Subscription)
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const workspaceId = sub.metadata?.workspace_id
        if (workspaceId) {
          await admin
            .from('workspaces')
            .update({
              stripe_subscription_id: null,
              subscription_status: 'canceled',
              current_period_end: null,
            })
            .eq('id', workspaceId)
        }
        break
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId)
          await syncSubscription(admin, sub)
        }
        break
      }
      case 'invoice.payment_succeeded':
      case 'invoice.paid': {
        // Recovery: a failed-then-recovered payment doesn't always emit a fresh
        // subscription.updated, so re-sync here to flip `past_due` back to active
        // rather than leaving the workspace stuck past_due indefinitely.
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId)
          await syncSubscription(admin, sub)
        }
        break
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function syncSubscription(
  admin: ReturnType<typeof createAdminClient>,
  sub: Stripe.Subscription,
) {
  const workspaceId = sub.metadata?.workspace_id
  if (!workspaceId) {
    console.error('Subscription missing workspace_id metadata:', sub.id)
    return
  }

  const item = sub.items.data[0]
  const plan = item?.price?.lookup_key ?? item?.price?.id ?? 'unknown'
  // current_period_end is item-level on newer API shapes but subscription-level
  // on others; fall back so we don't null out the period on an active sub.
  const periodEndUnix =
    item?.current_period_end ??
    (sub as { current_period_end?: number }).current_period_end ??
    null

  await admin
    .from('workspaces')
    .update({
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
      plan,
      current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
    })
    .eq('id', workspaceId)
}
