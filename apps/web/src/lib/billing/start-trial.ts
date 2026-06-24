import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripe } from '@/lib/stripe/client'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

export type Plan = 'pro_monthly' | 'pro_annual'

const PRICE_ENV: Record<Plan, string> = {
  pro_monthly: 'STRIPE_PRICE_PRO_MONTHLY',
  pro_annual: 'STRIPE_PRICE_PRO_ANNUAL',
}

export type StartTrialResult =
  | { ok: true; subscription_id: string; status: string }
  | { ok: false; code: 'no_workspace' | 'plan_not_configured' | 'already_active'; message: string; subscription_status?: string }

/**
 * Starts a 14-day Pro trial without collecting a payment method.
 *
 * - Creates (or reuses) a Stripe Customer for the workspace.
 * - Creates a Stripe Subscription with trial_period_days=14 and
 *   trial_settings.end_behavior.missing_payment_method='cancel'.
 * - At trial end, Stripe auto-cancels; webhook syncs subscription_status.
 *
 * Idempotent: if the workspace already has a trialing/active/past_due
 * subscription, returns { ok: false, code: 'already_active' } without
 * mutating Stripe.
 *
 * No automatic_tax: requires billing address (collected later via portal).
 * Prices are tax-inclusive.
 */
export async function startTrialForUser({
  admin,
  userId,
  email,
  plan,
}: {
  admin: SupabaseClient
  userId: string
  email: string | null
  plan: Plan
}): Promise<StartTrialResult> {
  const priceId = process.env[PRICE_ENV[plan]]
  if (!priceId) {
    return { ok: false, code: 'plan_not_configured', message: 'Plan not configured' }
  }

  const agent = await resolvePrimaryAgent(admin, userId, { requireWorkspace: true })
  if (!agent || !agent.workspace_id) {
    return { ok: false, code: 'no_workspace', message: 'No workspace found' }
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('stripe_customer_id, stripe_subscription_id, subscription_status')
    .eq('id', agent.workspace_id)
    .single()

  if (
    workspace?.stripe_subscription_id &&
    workspace.subscription_status &&
    ['trialing', 'active', 'past_due'].includes(workspace.subscription_status)
  ) {
    return {
      ok: false,
      code: 'already_active',
      message: 'Subscription already active',
      subscription_status: workspace.subscription_status,
    }
  }

  const stripe = getStripe()

  let customerId = workspace?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: email ?? undefined,
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

  return { ok: true, subscription_id: subscription.id, status: subscription.status }
}
