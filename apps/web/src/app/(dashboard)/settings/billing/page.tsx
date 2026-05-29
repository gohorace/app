import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreditCard } from 'lucide-react'
import { BillingSettings } from '@/components/settings/billing-settings'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from('agents')
    .select('id, workspace_id')
    .eq('user_id', user!.id)
    .maybeSingle()

  // HOR-203: seat_type isn't in generated types yet — fetch separately
  // and refuse access for support seats.
  if (agent) {
    const { data: seatRow } = await admin
      .from('agents')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('seat_type' as any)
      .eq('id', agent.id)
      .maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((seatRow as any)?.seat_type === 'support') {
      return (
        <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <div className="p-8 max-w-3xl">
            <h1 className="text-2xl font-bold tracking-tight">Plan &amp; billing</h1>
            <p className="text-muted-foreground mt-2">
              Billing is managed by the workspace owner.
            </p>
          </div>
        </div>
      )
    }
  }

  const { data: workspace } = agent?.workspace_id
    ? await admin
        .from('workspaces')
        .select('plan, subscription_status, stripe_customer_id, stripe_subscription_id, current_period_end')
        .eq('id', agent.workspace_id)
        .maybeSingle()
    : { data: null }

  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-8 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Plan & billing</h1>
          <p className="text-muted-foreground">
            Manage your Horace subscription, payment method, and invoices.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Your plan
            </CardTitle>
            <CardDescription>
              Billing is managed through Stripe — you&apos;ll be redirected to a
              secure portal to update your card or download invoices.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BillingSettings
              plan={workspace?.plan ?? 'free'}
              subscriptionStatus={workspace?.subscription_status ?? 'active'}
              hasStripeCustomer={!!workspace?.stripe_customer_id}
              currentPeriodEnd={workspace?.current_period_end ?? null}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
