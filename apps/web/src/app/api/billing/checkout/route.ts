import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/client'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

const bodySchema = z.object({
  plan: z.enum(['pro_monthly', 'pro_annual']),
  // HOR-295 — expired/lapsed users buy outright (no second free trial).
  noTrial: z.boolean().optional(),
})

const PRICE_ENV: Record<'pro_monthly' | 'pro_annual', string> = {
  pro_monthly: 'STRIPE_PRICE_PRO_MONTHLY',
  pro_annual: 'STRIPE_PRICE_PRO_ANNUAL',
}

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

  // HOR-377: billing is Admin-only.
  if (agent.role !== 'admin') {
    return NextResponse.json({ error: 'Billing is managed by an admin.' }, { status: 403 })
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('stripe_customer_id')
    .eq('id', agent.workspace_id)
    .single()

  const stripe = getStripe()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

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

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      // Omit the trial for expired/lapsed buyers — they pay now (HOR-295).
      ...(parsed.data.noTrial ? {} : { trial_period_days: 14 }),
      metadata: { workspace_id: agent.workspace_id },
    },
    payment_method_collection: 'always',
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    tax_id_collection: { enabled: true },
    allow_promotion_codes: true,
    metadata: { workspace_id: agent.workspace_id },
    success_url: `${appUrl}/dashboard?billing=success`,
    cancel_url: `${appUrl}/pricing?billing=cancelled`,
  })

  if (!session.url) {
    return NextResponse.json({ error: 'Stripe did not return a checkout URL' }, { status: 500 })
  }

  return NextResponse.json({ url: session.url })
}
