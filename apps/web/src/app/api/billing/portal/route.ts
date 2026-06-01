import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/client'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const agent = await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true })

  if (!agent?.workspace_id) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('stripe_customer_id')
    .eq('id', agent.workspace_id)
    .single()

  if (!workspace?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 })
  }

  const stripe = getStripe()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const session = await stripe.billingPortal.sessions.create({
    customer: workspace.stripe_customer_id,
    return_url: `${appUrl}/dashboard`,
  })

  return NextResponse.json({ url: session.url })
}
