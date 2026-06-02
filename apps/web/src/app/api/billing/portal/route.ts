import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/client'
import { getActor } from '@/lib/auth/capabilities'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // HOR-377: billing is Admin-only.
  const actor = await getActor(admin, user.id, { requireWorkspace: true })
  if (!actor?.workspaceId) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 400 })
  }
  if (!actor.isAdmin) {
    return NextResponse.json({ error: 'Billing is managed by an admin.' }, { status: 403 })
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('stripe_customer_id')
    .eq('id', actor.workspaceId)
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
