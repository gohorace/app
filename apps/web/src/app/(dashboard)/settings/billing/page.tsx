import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SectionHeading } from '@/components/ui/section-heading'
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

  // HOR-203: support seats can't manage billing.
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
          <div className="p-4 md:p-8 max-w-[660px] space-y-5">
            <SectionHeading title="Plan & billing" description="Your plan, the card on file, and what renews when." />
            <p className="text-sm text-[var(--fg-secondary)]">
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
      <div className="p-4 md:p-8 max-w-[660px] space-y-5">
        <SectionHeading
          title="Plan & billing"
          description="Your plan, the card on file, and what renews when."
        />
        <BillingSettings
          plan={workspace?.plan ?? 'free'}
          subscriptionStatus={workspace?.subscription_status ?? 'active'}
          hasStripeCustomer={!!workspace?.stripe_customer_id}
          currentPeriodEnd={workspace?.current_period_end ?? null}
        />
      </div>
    </div>
  )
}
