import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/client'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

const bodySchema = z.object({
  plan: z.enum(['pro_monthly', 'pro_annual']),
})

const PRICE_ENV: Record<'pro_monthly' | 'pro_annual', string> = {
  pro_monthly: 'STRIPE_PRICE_PRO_MONTHLY',
  pro_annual: 'STRIPE_PRICE_PRO_ANNUAL',
}

/**
 * Starts a 14-day Pro trial WITHOUT collecting a payment method.
 * - Creates (or reuses) a Stripe Customer for the workspace.
 * - Creates a Stripe Subscription with trial_period_days=14 and
 *   trial_settings.end_behavior.missing_payment_method='cancel'.
 * - At trial end, Stripe auto-cancels the subscription (no card to charge),
 *   our customer.subscription.deleted webhook sets subscription_status='canceled'
 *   and the dashboard gate redirects to /pricing?expired=1. The workspace's
 *   plan field is left as-is so reactivation knows the prior tier.
 * - During the trial, the user can add a card via the Customer Portal
 *   (POST /api/billing/portal) to convert to a paid subscription.
 *
 * No automatic_tax: requires a billing address. We don't collect one at signup
 * (it's collected by the Customer Portal when the user adds a card later).
 * Prices are tax-inclusive ($149 includes GST), so this is acceptable for v1.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let parsed
  try {
    parsed = bodySchema.safeParse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const priceId = process.env[PRICE_ENV[parsed.data.plan]]
  if (!priceId) {
    return NextResponse.json({ error: 'Plan not configured' }, { status: 500 })
  }

  const admin = createAdminClient()

  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })

  if (!agent || !agent.workspace_id) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('stripe_customer_id, stripe_subscription_id, subscription_status')
    .eq('id', agent.workspace_id)
    .single()

  // Idempotency: if there's already an active or trialing subscription, don't create another.
  if (workspace?.stripe_subscription_id && workspace.subscription_status &&
      ['trialing', 'active', 'past_due'].includes(workspace.subscription_status)) {
    return NextResponse.json({
      error: 'Subscription already active',
      subscription_status: workspace.subscription_status,
    }, { status: 409 })
  }

  const stripe = getStripe()

  // Create or reuse Stripe customer for this workspace
  let customerId = workspace?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { workspace_id: agent.workspace_id },
    })
    customerId = customer.id
    await admin
      .from('workspaces')
      .update({ stripe_customer_id: customerId })
      .eq('id', agent.workspace_id)
  }

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    trial_period_days: 14,
    trial_settings: {
      end_behavior: { missing_payment_method: 'cancel' },
    },
    payment_settings: {
      save_default_payment_method: 'on_subscription',
    },
    metadata: { workspace_id: agent.workspace_id },
  })

  // Webhook (customer.subscription.created) will sync the workspace row.
  // We return the subscription id for client-side reference; nothing to redirect to.
  return NextResponse.json({
    subscription_id: subscription.id,
    status: subscription.status,
  })
}
