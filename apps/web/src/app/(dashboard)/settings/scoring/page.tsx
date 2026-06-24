import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePrimaryAgent } from '@/lib/seats/resolve-agent'
import { SectionHeading } from '@/components/ui/section-heading'
import { SensitivityForm } from '@/components/settings/sensitivity-form'
import { DEFAULT_SENSITIVITY, type Sensitivity } from '@/lib/sensitivity/thresholds'

export default async function SensitivityPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const agent = user ? await resolvePrimaryAgent(admin, user.id, { requireWorkspace: true }) : null

  let initial: Sensitivity = DEFAULT_SENSITIVITY
  if (agent?.workspace_id) {
    const { data } = await admin
      .from('workspaces')
      .select('sensitivity')
      .eq('id', agent.workspace_id)
      .maybeSingle()
    const raw = data?.sensitivity
    if (raw === 'low' || raw === 'medium' || raw === 'high') initial = raw
  }

  // Own scroll container — dashboard <main> delegates scrolling per page (HOR-297).
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8">
        <div className="max-w-[660px]">
          <SectionHeading
            title="Sensitivity"
            description="How readily I tap you when a visitor breaks their normal pattern."
          />
          <SensitivityForm initial={initial} />
        </div>
      </div>
    </div>
  )
}
